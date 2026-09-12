import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, Marker, NavigationControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { geocode, type GeocodeResult } from '../data-sources/nominatim'
import { approximateTimezone } from './timezone'
import styles from './LocationPicker.module.css'

/** The location resolved by the picker, handed back via `onLocationChange`. */
export interface ResolvedLocation {
  lat: number
  lon: number
  /**
   * A rough "UTC±N" approximation derived from longitude — see
   * `approximateTimezone` and docs/decisions/0012-location-picker.md for
   * why this isn't a real IANA timezone lookup.
   */
  timezone?: string
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
const RESOLVED_ZOOM = 11

function resolveFromCoords(lat: number, lon: number): ResolvedLocation {
  return { lat, lon, timezone: approximateTimezone(lon) }
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

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const onLocationChangeRef = useRef(onLocationChange)
  onLocationChangeRef.current = onLocationChange
  // Set right before a programmatic setQuery() (picking a result) so the
  // search effect below doesn't immediately re-search for the text we
  // just filled in ourselves.
  const skipNextSearchRef = useRef(false)

  // --- Debounced search -----------------------------------------------

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false
      return
    }

    if (!query.trim()) {
      setResults([])
      setSearchState('idle')
      setErrorMessage(null)
      return
    }

    const controller = new AbortController()
    setSearchState('loading')

    const timer = setTimeout(() => {
      geocode(query, { signal: controller.signal })
        .then((matches) => {
          setResults(matches)
          setSearchState(matches.length === 0 ? 'no-results' : 'idle')
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
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

  function selectLocation(lat: number, lon: number) {
    const next = resolveFromCoords(lat, lon)
    setResolvedLocation(next)
    onLocationChangeRef.current(next)

    if (mapRef.current) {
      mapRef.current.flyTo({ center: [lon, lat], zoom: RESOLVED_ZOOM })
    }
    if (markerRef.current) {
      markerRef.current.setLngLat([lon, lat])
    } else if (mapRef.current) {
      markerRef.current = new Marker({ draggable: true })
        .setLngLat([lon, lat])
        .addTo(mapRef.current)
      markerRef.current.on('dragend', () => {
        const lngLat = markerRef.current?.getLngLat()
        if (lngLat) selectLocation(lngLat.lat, lngLat.lng)
      })
    }
  }

  function handleSelectResult(result: GeocodeResult) {
    skipNextSearchRef.current = true
    setQuery(result.displayName)
    setResults([])
    setSearchState('idle')
    selectLocation(result.lat, result.lon)
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
    map.on('click', (event) => {
      selectLocation(event.lngLat.lat, event.lngLat.lng)
    })

    if (start) {
      const marker = new Marker({ draggable: true })
        .setLngLat([start.lon, start.lat])
        .addTo(map)
      marker.on('dragend', () => {
        const lngLat = marker.getLngLat()
        selectLocation(lngLat.lat, lngLat.lng)
      })
      markerRef.current = marker
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

  return (
    <div className={styles.container}>
      <div className={styles.searchBox}>
        <input
          type="text"
          className={styles.input}
          placeholder="Search for an address or place…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search for a location"
        />
        {results.length > 0 && (
          <ul className={styles.resultsList}>
            {results.map((result, index) => (
              <li
                key={`${result.lat}-${result.lon}-${index}`}
                className={styles.resultItem}
                role="option"
                aria-selected={false}
                tabIndex={0}
                onClick={() => handleSelectResult(result)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    handleSelectResult(result)
                  }
                }}
              >
                {result.displayName}
              </li>
            ))}
          </ul>
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
        role="application"
        aria-label="Map for selecting a location"
      />

      {resolvedLocation && (
        <p className={styles.coords}>
          Selected: {resolvedLocation.lat.toFixed(5)},{' '}
          {resolvedLocation.lon.toFixed(5)}
          {resolvedLocation.timezone ? ` (${resolvedLocation.timezone})` : ''}
        </p>
      )}
    </div>
  )
}
