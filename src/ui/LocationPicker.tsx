import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Map as MapLibreMap, Marker, NavigationControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { geocode, type GeocodeResult } from '../data-sources/nominatim'
import { approximateTimezone, formatUtcOffset } from './timezone'
import styles from './LocationPicker.module.css'

/** The location resolved by the picker, handed back via `onLocationChange`. */
export interface ResolvedLocation {
  lat: number
  lon: number
  /**
   * A rough whole-hour UTC offset derived from longitude alone — see
   * `approximateTimezone` and docs/decisions/0012-location-picker.md for
   * why this isn't a real IANA timezone lookup. Format it for display
   * with `formatUtcOffset` rather than treating it as an IANA id.
   */
  utcOffsetHours?: number
}

export interface LocationPickerProps {
  /** Called whenever the resolved location changes (search pick, pin drag, or map click). */
  onLocationChange: (location: ResolvedLocation) => void
  /** Optional starting location — shows an initial pin/coords without requiring a search first. */
  initialLocation?: ResolvedLocation
  /** Debounce delay, in ms, between the user typing and firing a geocode search. Default 350. */
  debounceMs?: number
  /** Free vector tile style URL. Defaults to OpenFreeMap's "liberty" style (no API key required). */
  mapStyleUrl?: string
}

const DEFAULT_DEBOUNCE_MS = 350
const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
// Fallback map center/zoom used until a location is resolved: a low zoom,
// roughly-world-centered view rather than defaulting to any one place.
const DEFAULT_CENTER: [number, number] = [10, 20]
const DEFAULT_ZOOM = 1.5
// Only used when the user had no prior map context (a search pick, or the
// initial mount) — jumping to a reasonable zoom makes sense there. Map
// clicks and pin drags intentionally do NOT use this: the user is already
// looking at the area they want, so forcing a recenter/zoom on every click
// or drag fights the user (see docs/decisions/0012-location-picker.md).
const RESOLVED_ZOOM = 11

function resolveFromCoords(lat: number, lon: number): ResolvedLocation {
  return { lat, lon, utcOffsetHours: approximateTimezone(lon) }
}

/** Creates a draggable marker on `map` and wires its `dragend` handler. */
function createPin(
  map: MapLibreMap,
  lat: number,
  lon: number,
  onDragEnd: (lat: number, lon: number) => void,
): Marker {
  const marker = new Marker({ draggable: true })
    .setLngLat([lon, lat])
    .addTo(map)
  marker.on('dragend', () => {
    const lngLat = marker.getLngLat()
    onDragEnd(lngLat.lat, lngLat.lng)
  })
  return marker
}

export function LocationPicker({
  onLocationChange,
  initialLocation,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  mapStyleUrl = DEFAULT_MAP_STYLE_URL,
}: LocationPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [searchState, setSearchState] = useState<
    'idle' | 'loading' | 'no-results' | 'error'
  >('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [resolvedLocation, setResolvedLocation] = useState<
    ResolvedLocation | undefined
  >(initialLocation)
  const [activeIndex, setActiveIndex] = useState<number>(-1)

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const onLocationChangeRef = useRef(onLocationChange)
  onLocationChangeRef.current = onLocationChange
  const listboxId = useId()

  // Tracks the display name most recently written into `query` by
  // `handleSelectResult` (a programmatic setQuery, not user typing). The
  // search effect below bails out when `query` still equals this value,
  // rather than relying on a "skip the next effect run" boolean: a plain
  // one-shot flag is only consumed when the effect actually re-runs, which
  // requires `query` to change. If the typed text already equalled the
  // display name being set, `setQuery` is a no-op, React never re-runs the
  // effect, and the flag would stay set — silently swallowing the *next*
  // genuine search. Comparing against the last-selected value instead is
  // idempotent and self-correcting: it only skips while `query` still
  // matches what was just selected, and stops the moment the user types
  // anything else.
  const lastProgrammaticQueryRef = useRef<string | null>(null)

  // --- Debounced search -----------------------------------------------

  useEffect(() => {
    if (query === lastProgrammaticQueryRef.current) {
      return
    }

    if (!query.trim()) {
      setResults([])
      setSearchState('idle')
      setErrorMessage(null)
      setActiveIndex(-1)
      return
    }

    const controller = new AbortController()
    setSearchState('loading')

    const timer = setTimeout(() => {
      geocode(query, { signal: controller.signal })
        .then((matches) => {
          // geocode() may resolve synchronously-ish from its cache, but
          // this callback can still run after a newer effect run has
          // already superseded this one (e.g. cache resolves, but a
          // cleanup-triggered abort raced it) — guard here too, not just
          // in .catch, so a stale response can never overwrite fresher
          // results/state.
          if (controller.signal.aborted) return
          setResults(matches)
          setSearchState(matches.length === 0 ? 'no-results' : 'idle')
          setActiveIndex(-1)
        })
        .catch((error: unknown) => {
          // The Nominatim client normalizes both its own request timeout
          // and a caller-provided abort to `err.name === 'AbortError'`
          // (see src/data-sources/nominatim.ts) — check that contract
          // directly rather than `controller.signal.aborted`, which is
          // only true for *our* abort and would otherwise let a timeout
          // fall through and render a raw DOM error message.
          if (error instanceof Error && error.name === 'AbortError') return
          setResults([])
          setSearchState('error')
          setErrorMessage(
            error instanceof Error ? error.message : 'Search failed.',
          )
        })
    }, debounceMs)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, debounceMs])

  // --- Resolve + notify --------------------------------------------------

  // Search selection: the user had no prior map context (they typed a
  // place name), so flying to a reasonable zoom is the right call.
  function selectFromSearch(lat: number, lon: number) {
    const next = resolveFromCoords(lat, lon)
    setResolvedLocation(next)
    onLocationChangeRef.current(next)

    if (mapRef.current) {
      mapRef.current.flyTo({ center: [lon, lat], zoom: RESOLVED_ZOOM })
    }
    placePin(lat, lon)
  }

  // Map click / pin drag: the user is already looking at the area they
  // want (they clicked or dragged within the current view), so the camera
  // is left exactly where it is — no flyTo, no forced zoom.
  function selectFromMap(lat: number, lon: number) {
    const next = resolveFromCoords(lat, lon)
    setResolvedLocation(next)
    onLocationChangeRef.current(next)
    placePin(lat, lon)
  }

  // NOTE: both `selectFromSearch` and `selectFromMap` are re-created every
  // render, but the `map.on('click')` / marker `dragend` handlers wired up
  // in the map-setup effect below capture whichever copy existed at mount
  // and hold it for the component's lifetime. That's safe today only
  // because these functions read nothing but refs and setters (state
  // setters are stable, `onLocationChangeRef`/`mapRef`/`markerRef` are
  // refs) — no prop or state value is read directly. If a future change
  // makes either function read a prop/state value directly, it will
  // silently close over a stale one; route it through a ref instead.
  function placePin(lat: number, lon: number) {
    if (markerRef.current) {
      markerRef.current.setLngLat([lon, lat])
    } else if (mapRef.current) {
      markerRef.current = createPin(mapRef.current, lat, lon, selectFromMap)
    }
  }

  function handleSelectResult(result: GeocodeResult) {
    lastProgrammaticQueryRef.current = result.displayName
    setQuery(result.displayName)
    setResults([])
    setSearchState('idle')
    setActiveIndex(-1)
    selectFromSearch(result.lat, result.lon)
  }

  function closeResults() {
    setResults([])
    setActiveIndex(-1)
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((index) => (index + 1) % results.length)
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1))
        break
      case 'Enter':
        if (activeIndex >= 0 && activeIndex < results.length) {
          event.preventDefault()
          handleSelectResult(results[activeIndex])
        }
        break
      case 'Escape':
        event.preventDefault()
        closeResults()
        break
      default:
        break
    }
  }

  // --- Map setup -----------------------------------------------------

  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) return

    const start = initialLocation
    const map = new MapLibreMap({
      container,
      style: mapStyleUrl,
      center: start ? [start.lon, start.lat] : DEFAULT_CENTER,
      zoom: start ? RESOLVED_ZOOM : DEFAULT_ZOOM,
    })
    map.addControl(new NavigationControl(), 'top-right')
    mapRef.current = map

    // Fallback interaction per the spec's error-handling section: clicking
    // the map places/moves the pin even if search fails or isn't used.
    // Uses selectFromMap (not selectFromSearch) so a coarse exploratory
    // click doesn't yank the camera to zoom 11 — see selectFromMap above.
    map.on('click', (event) => {
      selectFromMap(event.lngLat.lat, event.lngLat.lng)
    })

    if (start) {
      markerRef.current = createPin(map, start.lat, start.lon, selectFromMap)
    }

    return () => {
      markerRef.current?.remove()
      markerRef.current = null
      map.remove()
      mapRef.current = null
    }
    // Map is intentionally created once; style/initialLocation changes
    // after mount are out of scope for M1.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeDescendantId =
    activeIndex >= 0 && activeIndex < results.length
      ? `${listboxId}-option-${activeIndex}`
      : undefined

  return (
    <div className={styles.container}>
      <div className={styles.searchBox}>
        <input
          type="text"
          className={styles.input}
          placeholder="Search for an address or place…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          onBlur={closeResults}
          aria-label="Search for a location"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={activeDescendantId}
          autoComplete="off"
        />
        {results.length > 0 && (
          <ul id={listboxId} className={styles.resultsList} role="listbox">
            {results.map((result, index) => (
              <li
                key={`${result.lat}-${result.lon}-${index}`}
                id={`${listboxId}-option-${index}`}
                className={`${styles.resultItem} ${
                  index === activeIndex ? styles.resultItemActive : ''
                }`}
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                // onMouseDown (not onClick) fires before the input's
                // onBlur, so clicking a result selects it rather than the
                // blur handler clearing the list first.
                onMouseDown={(event) => {
                  event.preventDefault()
                  handleSelectResult(result)
                }}
              >
                {result.displayName}
              </li>
            ))}
          </ul>
        )}
        {results.length > 0 && (
          <p className={styles.attribution}>
            Search results © OpenStreetMap contributors, via Nominatim
          </p>
        )}
        {searchState === 'no-results' && (
          <p className={`${styles.message} ${styles.noResults}`}>
            No results found. You can also click the map to pick a location.
          </p>
        )}
        {searchState === 'error' && (
          <p className={`${styles.message} ${styles.error}`} role="alert">
            {errorMessage ?? 'Search failed.'} You can also click the map to
            pick a location.
          </p>
        )}
      </div>

      <div
        ref={mapContainerRef}
        className={styles.mapContainer}
        data-testid="location-picker-map"
        aria-label="Map for selecting a location"
      />

      {resolvedLocation && (
        <p className={styles.coords}>
          Selected: {resolvedLocation.lat.toFixed(5)},{' '}
          {resolvedLocation.lon.toFixed(5)}
          {resolvedLocation.utcOffsetHours !== undefined
            ? ` (${formatUtcOffset(resolvedLocation.utcOffsetHours)})`
            : ''}
        </p>
      )}
    </div>
  )
}
