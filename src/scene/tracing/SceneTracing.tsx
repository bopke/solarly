import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import type { Feature } from 'geojson'
import { polygonAreaM2, validatePolygon } from './geometry'
import type { LatLon } from './geometry'
import {
  buildMapboxSatelliteStyle,
  FALLBACK_STYLE_URL,
  readMapboxApiKey,
} from './mapboxSatellite'
import type { TracedShape, TracedShapeKind } from './types'
import styles from './SceneTracing.module.css'

export interface SceneTracingProps {
  /** Where to center the map — the already-resolved location from the location picker. */
  center: LatLon
  /**
   * Called with the current set of *valid* traced shapes whenever the set
   * changes (add, edit, or delete). Shapes with a validation problem
   * (self-intersecting or near-zero area) are held back from this
   * callback until fixed or deleted — see the module doc comment below —
   * but stay visible/editable in the UI so fixing one shape never loses
   * the others.
   */
  onShapesChange: (shapes: TracedShape[]) => void
  /** Initial zoom, centered on `center`. Defaults to building-level (19). */
  initialZoom?: number
  /**
   * Overrides the Mapbox API key otherwise read from
   * `import.meta.env.VITE_MAPBOX_API_KEY`. Mainly for tests — real
   * callers should just set the env var (see `.env.example`).
   */
  mapboxApiKey?: string
}

const DEFAULT_ZOOM = 19

const NO_KEY_NOTICE =
  'Satellite imagery isn’t available: no Mapbox API key is configured ' +
  '(VITE_MAPBOX_API_KEY). Showing the plain map instead — drawing still ' +
  'works, but you’ll need to trace from memory or another reference. ' +
  'See .env.example for how to add a key.'

const TILE_ERROR_NOTICE =
  'Satellite imagery failed to load (the Mapbox API key may be invalid, ' +
  'rate-limited, or a network request failed). Showing the plain map ' +
  'instead — drawing still works.'

/**
 * The subset of MapLibre's `IControl` interface `MapboxDraw` actually
 * implements. `@mapbox/mapbox-gl-draw`'s published types are written
 * against `mapbox-gl`'s `Map`/`IControl`, not `maplibre-gl`'s — the two
 * libraries are API-compatible at runtime (this is exactly why the M2
 * design spec picked mapbox-gl-draw for a MapLibre-based app), but their
 * type declarations don't structurally unify enough for a direct
 * `map.addControl(draw)`. This local, minimal type plus a cast at the one
 * call site is narrower and clearer than suppressing the type error.
 */
interface MapLibreControlLike {
  onAdd(map: MapLibreMap): HTMLElement
  onRemove(map: MapLibreMap): void
}

/**
 * `mapbox-gl-draw` fires its own custom `draw.*` events on the map
 * (`draw.create`/`draw.update`/`draw.delete`) — MapLibre's own typed
 * `MapEventType` naturally has no idea these exist, so `map.on`/`map.off`
 * need a narrow, explicitly-typed escape hatch for just these three
 * rather than losing type safety on the event payload entirely.
 */
interface DrawEventMap {
  'draw.create': { features: Feature[] }
  'draw.update': { features: Feature[] }
  'draw.delete': { features: Feature[] }
}
interface MapWithDrawEvents {
  on<K extends keyof DrawEventMap>(
    type: K,
    listener: (event: DrawEventMap[K]) => void,
  ): void
  off<K extends keyof DrawEventMap>(
    type: K,
    listener: (event: DrawEventMap[K]) => void,
  ): void
}

/**
 * Reads the outer ring of a drawn polygon feature as `LatLon[]`, dropping
 * GeoJSON's closing duplicate vertex (a Polygon ring's first and last
 * positions are always identical, per the GeoJSON spec) since it's
 * redundant for our purposes (area/self-intersection math, and the
 * output shape's contract).
 */
function extractPolygon(feature: Feature): LatLon[] {
  if (feature.geometry.type !== 'Polygon') return []
  // mapbox-gl-draw creates its own transient "in-progress" feature the
  // instant `draw_polygon` mode starts, and while the user is still
  // drawing (has placed some vertices but hasn't finished the polygon):
  // `coordinates` itself can be `null`/absent right at mode-start, and
  // once drawing begins its ring can contain a `null` entry standing in
  // for whichever vertex is currently following the mouse cursor,
  // alongside real `[lon, lat]` tuples for already-placed vertices. Guard
  // against both rather than crashing on them.
  const rawRing = feature.geometry.coordinates?.[0] ?? []
  const ring = rawRing.filter((point): point is [number, number] =>
    Array.isArray(point),
  )
  const isClosed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  const openRing = isClosed ? ring.slice(0, -1) : ring
  return openRing.map(([lon, lat]) => ({ lat, lon }))
}

function featureKind(feature: Feature): TracedShapeKind {
  const raw = feature.properties?.kind
  return raw === 'ground-array' ? 'ground-array' : 'roof-face'
}

function formatArea(areaM2: number): string {
  if (areaM2 >= 1000) return `${(areaM2 / 1000).toFixed(1)}k m²`
  return `${Math.round(areaM2)} m²`
}

/**
 * Trace roof/ground-array outlines over satellite imagery (module doc —
 * see `docs/superpowers/specs/2026-09-13-solarly-m2-design.md`'s "Trace"
 * step).
 *
 * **Shape tagging UX** (the spec left this to implementer judgment): a
 * "next shape" toggle above the map sets the kind applied to whatever
 * polygon the user draws next, PLUS every completed shape in the list
 * below can have its kind changed after the fact via a dropdown. The
 * toggle covers the common case (tracing several roof faces in a row, or
 * several ground-array plots in a row) without an extra click per shape;
 * the per-shape dropdown covers "forgot to switch it" or "changed my
 * mind" without having to redraw. See
 * docs/decisions/0090-scene-tracing-shape-tagging.md.
 *
 * **Mapbox Satellite tiles are the project's first API-keyed dependency**
 * (`VITE_MAPBOX_API_KEY`, no built-in default — see `.env.example`). No
 * key, or a failing tile request (401/403/rate-limit/network), falls back
 * to the same plain MapLibre vector style `LocationPicker` uses, with an
 * inline notice — the drawing tool itself keeps working either way. This
 * fallback path is the one thing about tile loading verifiable in this
 * environment (no real Mapbox key available); see the PR description.
 */
export function SceneTracing({
  center,
  onShapesChange,
  initialZoom = DEFAULT_ZOOM,
  mapboxApiKey,
}: SceneTracingProps) {
  const [shapes, setShapes] = useState<TracedShape[]>([])
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({})
  const [nextKind, setNextKind] = useState<TracedShapeKind>('roof-face')
  const [satelliteNotice, setSatelliteNotice] = useState<string | null>(null)

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const drawRef = useRef<MapboxDraw | null>(null)
  const onShapesChangeRef = useRef(onShapesChange)
  onShapesChangeRef.current = onShapesChange
  const nextKindRef = useRef(nextKind)
  nextKindRef.current = nextKind

  // --- Notify caller whenever the *valid* shape set changes --------------

  useEffect(() => {
    const valid = shapes.filter((shape) => !validationErrors[shape.id])
    onShapesChangeRef.current(valid)
  }, [shapes, validationErrors])

  // --- Map + draw setup ---------------------------------------------------

  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) return

    const apiKey = (mapboxApiKey ?? readMapboxApiKey()).trim()
    const usingSatellite = apiKey.length > 0
    setSatelliteNotice(usingSatellite ? null : NO_KEY_NOTICE)

    const map = new MapLibreMap({
      container,
      style: usingSatellite
        ? buildMapboxSatelliteStyle(apiKey)
        : FALLBACK_STYLE_URL,
      center: [center.lon, center.lat],
      zoom: initialZoom,
    })
    map.addControl(new NavigationControl(), 'top-right')
    mapRef.current = map

    // Any tile-load failure while the satellite style is active is
    // attributed to the satellite source, since it's the map's only
    // source in that style. Falls back once, not in a retry loop.
    let fellBack = !usingSatellite
    function handleMapError() {
      if (fellBack) return
      fellBack = true
      map.setStyle(FALLBACK_STYLE_URL)
      setSatelliteNotice(TILE_ERROR_NOTICE)
    }
    if (usingSatellite) {
      map.on('error', handleMapError)
    }

    // `suppressAPIEvents` isn't in `@mapbox/mapbox-gl-draw`'s published
    // types, but it's a real constructor option (see the installed
    // package's `lib/constants.js` default options / `lib/api.js`) that
    // defaults to `true` — meaning `draw.delete()`/`draw.set()`/etc, called
    // programmatically (as `handleDeleteShape` and `handleChangeKind`
    // below do), stay silent and do NOT fire `draw.delete`/`draw.update`
    // by default, only user mouse/keyboard interaction does. Set to
    // `false` so this component's own programmatic calls funnel through
    // the exact same `draw.create`/`draw.update`/`draw.delete` handlers as
    // direct user interaction — one path to keep in sync, not two.
    const drawOptions: MapboxDraw.MapboxDrawOptions & {
      suppressAPIEvents?: boolean
    } = {
      displayControlsDefault: false,
      controls: {},
      suppressAPIEvents: false,
    }
    const draw = new MapboxDraw(drawOptions)
    drawRef.current = draw
    map.addControl(draw as unknown as MapLibreControlLike)

    function upsertShape(feature: Feature) {
      const id = String(feature.id)
      const kind = featureKind(feature)
      const polygon = extractPolygon(feature)
      if (polygon.length === 0) {
        // mapbox-gl-draw fires the same draw.create/draw.update events for
        // its own transient "in-progress" feature (created the instant
        // draw_polygon mode starts, before the user has placed a single
        // vertex) as it does for a real shape — surfacing that as a
        // "too few vertices" list entry on every click of "Draw polygon"
        // would be pure UI noise, so it's ignored until there's an actual
        // outline to show.
        return
      }
      const shape: TracedShape = { id, kind, polygon }

      setShapes((prev) => {
        const index = prev.findIndex((existing) => existing.id === id)
        if (index === -1) return [...prev, shape]
        const next = [...prev]
        next[index] = shape
        return next
      })

      const problem = validatePolygon(polygon)
      setValidationErrors((prev) => {
        const next = { ...prev }
        if (problem) next[id] = problem.message
        else delete next[id]
        return next
      })
    }

    function removeShapes(ids: string[]) {
      setShapes((prev) => prev.filter((shape) => !ids.includes(shape.id)))
      setValidationErrors((prev) => {
        const next = { ...prev }
        for (const id of ids) delete next[id]
        return next
      })
    }

    function handleCreate(event: { features: Feature[] }) {
      for (const feature of event.features) {
        const id = String(feature.id)
        draw.setFeatureProperty(id, 'kind', nextKindRef.current)
        upsertShape(draw.get(id) ?? feature)
      }
    }

    function handleUpdate(event: { features: Feature[] }) {
      for (const feature of event.features) upsertShape(feature)
    }

    function handleDelete(event: { features: Feature[] }) {
      removeShapes(event.features.map((feature) => String(feature.id)))
    }

    const drawEvents = map as unknown as MapWithDrawEvents
    drawEvents.on('draw.create', handleCreate)
    drawEvents.on('draw.update', handleUpdate)
    drawEvents.on('draw.delete', handleDelete)

    return () => {
      map.off('error', handleMapError)
      drawEvents.off('draw.create', handleCreate)
      drawEvents.off('draw.update', handleUpdate)
      drawEvents.off('draw.delete', handleDelete)
      map.remove()
      mapRef.current = null
      drawRef.current = null
    }
    // The map is intentionally created once (see LocationPicker's
    // identical convention/rationale) — center/initialZoom/mapboxApiKey
    // changes after mount are out of scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleChangeKind(id: string, kind: TracedShapeKind) {
    drawRef.current?.setFeatureProperty(id, 'kind', kind)
    setShapes((prev) =>
      prev.map((shape) => (shape.id === id ? { ...shape, kind } : shape)),
    )
  }

  function handleDeleteShape(id: string) {
    // Triggers this component's own `draw.delete` handler (registered
    // above), which removes the shape from state — no need to duplicate
    // that removal here.
    drawRef.current?.delete(id)
  }

  function handleStartDrawing() {
    drawRef.current?.changeMode('draw_polygon')
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <fieldset className={styles.kindToggle}>
          <legend className={styles.kindToggleLegend}>Next shape</legend>
          <label className={styles.kindOption}>
            <input
              type="radio"
              name="next-shape-kind"
              value="roof-face"
              checked={nextKind === 'roof-face'}
              onChange={() => setNextKind('roof-face')}
            />
            Roof face
          </label>
          <label className={styles.kindOption}>
            <input
              type="radio"
              name="next-shape-kind"
              value="ground-array"
              checked={nextKind === 'ground-array'}
              onChange={() => setNextKind('ground-array')}
            />
            Ground array
          </label>
        </fieldset>
        <button
          type="button"
          className={styles.drawButton}
          onClick={handleStartDrawing}
        >
          Draw polygon
        </button>
      </div>

      {satelliteNotice && (
        <p className={styles.notice} role="status">
          {satelliteNotice}
        </p>
      )}

      <div
        ref={mapContainerRef}
        className={styles.mapContainer}
        data-testid="scene-tracing-map"
        aria-label="Map for tracing roof and ground-array shapes"
      />

      <ul className={styles.shapeList} aria-label="Traced shapes">
        {shapes.length === 0 && (
          <li className={styles.emptyState}>
            No shapes traced yet — pick a kind above, then Draw polygon.
          </li>
        )}
        {shapes.map((shape) => (
          <li
            key={shape.id}
            className={styles.shapeItem}
            data-testid={`shape-${shape.id}`}
          >
            <select
              aria-label={`Kind for shape ${shape.id}`}
              value={shape.kind}
              onChange={(event) =>
                handleChangeKind(
                  shape.id,
                  event.target.value as TracedShapeKind,
                )
              }
            >
              <option value="roof-face">Roof face</option>
              <option value="ground-array">Ground array</option>
            </select>
            <span className={styles.shapeArea}>
              {formatArea(polygonAreaM2(shape.polygon))}
            </span>
            <button
              type="button"
              className={styles.deleteButton}
              onClick={() => handleDeleteShape(shape.id)}
              aria-label={`Delete shape ${shape.id}`}
            >
              Delete
            </button>
            {validationErrors[shape.id] && (
              <p className={styles.shapeError} role="alert">
                {validationErrors[shape.id]}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
