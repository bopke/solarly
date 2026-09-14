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
  /**
   * Called whenever the user picks a location (search pick, pin drag, or map
   * click) — the resolved value, not yet reflected in the picker's own
   * display. In controlled mode (see `location` below) the parent decides
   * whether the pick "sticks": call back with the same `location` value (or
   * a rejected pick's prior value) to make the picker's pin/readout revert.
   */
  onLocationChange: (location: ResolvedLocation) => void
  /**
   * Optional starting location — shows an initial pin/coords without
   * requiring a search first. Ignored after mount if `location` (below) is
   * also supplied.
   */
  initialLocation?: ResolvedLocation
  /**
   * Makes the displayed pin/coords controlled by the parent (issue #87 /
   * PR #95 review): when supplied, the picker's rendered readout and map
   * marker always reflect this value rather than the last value the user
   * picked. This is what lets a parent reject a pick (e.g. the user
   * cancels a "discard scene?" confirm in `App.tsx`) and have the picker's
   * own UI snap back to the prior location instead of silently disagreeing
   * with app state — see docs `handleLocationChange` in `App.tsx` and the
   * PR #95 review's "blocking finding". Omit (leave `undefined` for the
   * whole component lifetime) to keep the picker fully uncontrolled, as
   * before — matches the optional-controlled-prop-pair convention used by
   * `AppShell`'s `mode`/`onModeChange`, except here the single prop doubles
   * as both value and "is this controlled" signal since `undefined` is
   * already the picker's own "no location yet" state.
   */
  location?: ResolvedLocation
  /** Debounce delay, in ms, between the user typing and firing a geocode search. Default 350. */
  debounceMs?: number
  /** Free vector tile style URL. Defaults to OpenFreeMap's "liberty" style (no API key required). */
  mapStyleUrl?: string
  /**
   * When `true`, renders large/prominent (covering the main content area
   * on desktop, and tall within its normal sidebar flow on narrow
   * viewports) with the search box overlaid on the map, instead of the
   * default compact sidebar presentation. Driven by the caller from
   * `!hasLocation` — see docs/decisions/0012-location-picker.md and the
   * module doc comment below for why this is a CSS-only size/position
   * change rather than a remount. Defaults to `false` (compact).
   */
  isHero?: boolean
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
// Individual-building level: the tool exists so users can identify their
// own house/plot, not just their neighborhood, so we zoom in close enough
// to see buildings rather than stopping at a city/district-level view.
const RESOLVED_ZOOM = 17

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

/**
 * Search box + MapLibre map for picking a location, rendered in one of two
 * visual presentations depending on `isHero`:
 *
 * - `isHero: false` (default, "compact") — the small sidebar presentation:
 *   search box above a `mapContainer` height, as it's always looked.
 * - `isHero: true` ("hero") — large and prominent: on desktop, `position:
 *   fixed` visually relocates the map to cover the main content area
 *   (offset by `--shell-sidebar-width` so it doesn't cover the sidebar
 *   itself); on narrow viewports (below `SIDEBAR_BREAKPOINT_PX`, where the
 *   sidebar is a stacked accordion rather than a side column) it instead
 *   just grows taller in its normal document-flow position. Either way the
 *   search box is absolutely positioned as an overlay on top of the map
 *   rather than stacked above it. See `LocationPicker.module.css` for the
 *   class definitions.
 *
 * `App.tsx` drives `isHero` from `!hasLocation` and never unmounts this
 * component across that toggle — see the map-setup effect below and
 * docs/decisions/0012-location-picker.md for why that matters (tearing
 * down and recreating the MapLibre `Map` instance would lose the WebGL
 * context and any in-progress state). Only CSS classes change; the
 * `mapContainerRef` div stays mounted continuously, and a `ResizeObserver`
 * on it calls `map.resize()` whenever hero/compact toggling changes its
 * on-screen size, so the canvas keeps redrawing correctly.
 */
export function LocationPicker({
  onLocationChange,
  initialLocation,
  location: controlledLocation,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  mapStyleUrl = DEFAULT_MAP_STYLE_URL,
  isHero = false,
}: LocationPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [searchState, setSearchState] = useState<
    'idle' | 'loading' | 'no-results' | 'error'
  >('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // Tracked even in controlled mode (see `resolvedLocation` below) so the
  // component keeps working exactly as before when the caller never
  // supplies `location` — see the `LocationPickerProps.location` doc
  // comment.
  const [uncontrolledLocation, setUncontrolledLocation] = useState<
    ResolvedLocation | undefined
  >(initialLocation)
  // The value actually rendered (readout text + map marker position).
  // Once a parent supplies `location`, it — not the last value the user
  // picked — is authoritative; this is what lets a rejected pick (parent
  // declines to update its own `location` state) show up here as a
  // revert rather than a silent desync. See PR #95 review.
  const resolvedLocation =
    controlledLocation !== undefined ? controlledLocation : uncontrolledLocation
  // Bumped on every user-initiated pick (search result, map click, pin
  // drag), independently of whether `resolvedLocation` above actually
  // changes as a result. In controlled mode, a *rejected* pick leaves
  // `resolvedLocation` unchanged (the parent didn't update `location`) —
  // without this counter, the marker-sync effect below (keyed only on
  // `resolvedLocation`) would have no signal to re-run and snap the
  // marker back, since its dependency wouldn't have changed either.
  const [pickNonce, setPickNonce] = useState(0)
  // Which kind of pick is pending a sync (read by the marker-sync effect
  // to decide whether to `flyTo` — search picks recenter/zoom, map
  // clicks/drags deliberately don't, see `selectFromSearch`/
  // `selectFromMap` below). A ref, not state: it's only ever read
  // alongside a `pickNonce` bump, never needs to trigger a render itself.
  const pendingPickKindRef = useRef<'search' | 'map'>('map')
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
  // place name), so flying to a reasonable zoom is the right call — but
  // only once the pick actually sticks (see the marker-sync effect below,
  // which is what actually calls `flyTo`/moves the pin now). In
  // uncontrolled mode a pick always "sticks" immediately, so this behaves
  // exactly as before.
  function selectFromSearch(lat: number, lon: number) {
    const next = resolveFromCoords(lat, lon)
    setUncontrolledLocation(next)
    pendingPickKindRef.current = 'search'
    setPickNonce((n) => n + 1)
    onLocationChangeRef.current(next)
  }

  // Map click / pin drag: the user is already looking at the area they
  // want (they clicked or dragged within the current view), so the camera
  // is left exactly where it is — no flyTo, no forced zoom.
  function selectFromMap(lat: number, lon: number) {
    const next = resolveFromCoords(lat, lon)
    setUncontrolledLocation(next)
    pendingPickKindRef.current = 'map'
    setPickNonce((n) => n + 1)
    onLocationChangeRef.current(next)
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

  // Keeps the map marker (and, via `resolvedLocation` feeding the JSX
  // below, the coords readout) in sync with whatever is actually
  // authoritative — see `resolvedLocation`'s doc comment above. Runs after
  // every user pick (`pickNonce`) even when `resolvedLocation` itself
  // didn't change, which is exactly the case that matters: a controlled
  // parent rejecting a pick (PR #95 review's blocking finding — cancelling
  // the "discard scene?" confirm in `App.tsx` must not leave the pin/
  // readout showing the rejected location). `flyTo` only fires for a
  // search-originated pick that actually stuck (mirrors the old
  // `selectFromSearch` behavior); a rejected search pick or any map-
  // originated pick just repositions the pin in place, matching
  // `selectFromMap`'s original no-camera-move behavior.
  useEffect(() => {
    if (!resolvedLocation) return
    placePin(resolvedLocation.lat, resolvedLocation.lon)
    if (pendingPickKindRef.current === 'search' && mapRef.current) {
      mapRef.current.flyTo({
        center: [resolvedLocation.lon, resolvedLocation.lat],
        zoom: RESOLVED_ZOOM,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedLocation, pickNonce])

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

    // Prefer a controlled `location` over `initialLocation` if the caller
    // somehow supplies both (documented on `LocationPickerProps.location`)
    // — mount-time only, per the effect's own "intentionally created once"
    // note below.
    const start = controlledLocation ?? initialLocation
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

    // The container's on-screen size changes purely via CSS when `isHero`
    // toggles (see the hero/compact classes below) — the map's own DOM
    // node never unmounts, so MapLibre never re-reads the container's new
    // dimensions on its own. A `ResizeObserver` on the container is what
    // notices the CSS-driven resize and tells the canvas to redraw at the
    // new size; without this, toggling hero/compact leaves the WebGL
    // canvas stretched/cropped to whatever size it was created at. Set up
    // once here (not keyed on `isHero`) so it keeps working for any future
    // reason the container might resize, not just this one.
    const resizeObserver = new ResizeObserver(() => {
      map.resize()
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      markerRef.current?.remove()
      markerRef.current = null
      map.remove()
      mapRef.current = null
    }
    // Map is intentionally created once; style/initialLocation/location
    // changes after mount are out of scope here — later `location` changes
    // are instead picked up by the marker-sync effect above (which only
    // moves the existing marker/camera, not the map instance itself).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeDescendantId =
    activeIndex >= 0 && activeIndex < results.length
      ? `${listboxId}-option-${activeIndex}`
      : undefined

  const containerClassName = isHero
    ? `${styles.container} ${styles.containerHero}`
    : styles.container
  const mapWrapperClassName = isHero
    ? `${styles.mapWrapper} ${styles.mapWrapperHero}`
    : styles.mapWrapper
  const searchBoxClassName = isHero
    ? `${styles.searchBox} ${styles.searchBoxHero}`
    : styles.searchBox
  // Deliberately NOT toggled on `isHero`: this is the exact DOM node
  // MapLibre is constructed against (`new MapLibreMap({ container })`
  // below), and MapLibre adds its own `maplibregl-map` class to it
  // imperatively. React rewrites the whole `class` attribute whenever
  // `className` changes, so making this conditional would wipe out
  // MapLibre's class (and the `position: relative` it provides for the
  // canvas) on every hero/compact toggle. Hero sizing for the map is
  // instead driven from the `.mapWrapperHero` ancestor class above, which
  // MapLibre never touches — see LocationPicker.module.css.

  return (
    <div className={containerClassName}>
      {/*
       * `mapWrapper` holds both the search box and the map DOM node in
       * both hero and compact mode — only its CSS classes (and those of
       * its children) change between them. The map's own container div
       * below is never removed/recreated across that toggle, which is
       * exactly what keeps the MapLibre `Map` instance (created in the
       * effect above) alive: see the module's map-setup effect and its
       * `ResizeObserver`, which notices the CSS-driven size change and
       * tells the canvas to redraw. See also
       * docs/decisions/0012-location-picker.md.
       */}
      <div className={mapWrapperClassName}>
        <div className={searchBoxClassName}>
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
      </div>

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
