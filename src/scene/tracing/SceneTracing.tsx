import { useEffect, useId, useRef, useState } from 'react'
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
  MAPBOX_SATELLITE_SOURCE_ID,
  readMapboxApiKey,
} from './mapboxSatellite'
import type { TracedShape, TracedShapeKind } from './types'
import { DRAW_STYLES } from './drawStyles'
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
   *
   * `hasInvalidShapes` distinguishes "the user hasn't drawn anything yet"
   * (`shapes: []`, `hasInvalidShapes: false`) from "everything drawn so
   * far is invalid" (`shapes: []`, `hasInvalidShapes: true`) — the M2
   * spec requires the latter to block proceeding to the next step, which
   * an empty `shapes` array alone can't signal. `true` whenever at least
   * one currently-drawn shape has an unresolved validation error,
   * regardless of how many valid shapes also exist.
   */
  onShapesChange: (shapes: TracedShape[], hasInvalidShapes: boolean) => void
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
 * The shape of a MapLibre `error` event actually needed here. MapLibre's
 * own `ErrorEvent` type only declares `error: ErrorLike` — but at runtime,
 * when an error originates from (or bubbles up through) a source, the
 * event also carries a `sourceId` (see `setEventedParent`'s data-merging
 * in maplibre-gl's `Source`/`Style` internals), which isn't reflected in
 * the published types. This is the only field `handleMapError` needs to
 * tell a genuine satellite-source failure apart from unrelated `error`
 * events (see its doc comment).
 */
interface MapErrorEventLike {
  error?: { message?: string }
  sourceId?: string
}

/**
 * `map.on('error', ...)`'s published type only knows about `ErrorEvent`'s
 * typed fields, not the extra `sourceId` MapLibre merges onto it at
 * runtime (see `MapErrorEventLike` above) — this narrow escape hatch
 * mirrors `MapWithDrawEvents` just above for the same reason.
 */
interface MapWithTypedErrorEvent {
  on(type: 'error', listener: (event: MapErrorEventLike) => void): void
  off(type: 'error', listener: (event: MapErrorEventLike) => void): void
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
  // Unique per instance (issue #93) — a hardcoded `name` would make two
  // `SceneTracing` instances on one page share native radio-group state,
  // even though not currently the case anywhere in the app.
  const nextShapeKindGroupName = useId()

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
    const hasInvalidShapes = shapes.some((shape) => validationErrors[shape.id])
    onShapesChangeRef.current(valid, hasInvalidShapes)
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

    // MapLibre's `error` event fires for far more than tile/auth
    // failures — notably, `@mapbox/mapbox-gl-draw`'s bundled layer styles
    // (e.g. `gl-draw-lines`'s `line-dasharray`) fail MapLibre's stricter
    // style-spec validation and emit `error`-severity (not warning) map
    // `error` events the moment `map.addControl(draw)` adds its layers —
    // completely unrelated to whether satellite tiles loaded. Those
    // validation errors are fired directly on the map/style and carry no
    // `sourceId`. Only an error that actually traces back to the
    // satellite source (auth failure, tile fetch failure, source not
    // found) carries `sourceId === MAPBOX_SATELLITE_SOURCE_ID` — that's
    // the only case that should trigger the fallback. Anything else is
    // ignored here (left for MapLibre's own console warning/error
    // logging), so a valid API key's satellite imagery isn't discarded
    // because of unrelated draw-layer noise.
    //
    // This `sourceId`-carrying-on-source-failure behavior isn't part of
    // MapLibre's published `ErrorEvent` type (see `MapErrorEventLike`
    // above) — it's observed runtime behavior, verified against the
    // installed `maplibre-gl` (currently `^6.9.0`, see `package.json`).
    // A future maplibre-gl bump that changes how/whether source errors
    // are tagged would silently break this fallback path rather than fail
    // loudly — nothing currently guards against that beyond this comment.
    let fellBack = !usingSatellite
    function handleMapError(event: MapErrorEventLike) {
      if (fellBack) return
      if (event.sourceId !== MAPBOX_SATELLITE_SOURCE_ID) return
      fellBack = true
      map.setStyle(FALLBACK_STYLE_URL)
      setSatelliteNotice(TILE_ERROR_NOTICE)
    }
    const mapWithTypedError = map as unknown as MapWithTypedErrorEvent
    if (usingSatellite) {
      mapWithTypedError.on('error', handleMapError)
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
      // `DRAW_STYLES` is a copy of mapbox-gl-draw's own default theme
      // with one fix: `gl-draw-lines`'s `line-dasharray` paint value
      // wrapped in `['literal', ...]`. The bundled default theme's bare
      // numeric array fails MapLibre's stricter style-spec validation,
      // which makes `map.addLayer` silently skip adding that layer
      // entirely — so polygon edge outlines and the in-progress
      // rubber-band line while drawing never rendered (fills and vertex
      // handles did, since their layers don't use `line-dasharray`). See
      // `drawStyles.ts`'s doc comment for the full story.
      styles: DRAW_STYLES,
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
      mapWithTypedError.off('error', handleMapError)
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
              name={nextShapeKindGroupName}
              value="roof-face"
              checked={nextKind === 'roof-face'}
              onChange={() => setNextKind('roof-face')}
            />
            Roof face
          </label>
          <label className={styles.kindOption}>
            <input
              type="radio"
              name={nextShapeKindGroupName}
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
