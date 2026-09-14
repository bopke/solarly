/**
 * scene/apply — the M3 "SceneGeometry" derivation (issue #75, see
 * `docs/superpowers/specs/2026-09-13-solarly-m3-design.md`'s "New type:
 * `SceneGeometry`" and "Data flow" sections).
 *
 * Turns a `SceneDesignState` (traced shapes + step-2 tilt/azimuth configs,
 * placed obstructions, and step-3 panel layouts) into the `SceneGeometry`
 * issue #75 added to `simulation/types.ts` — the geometric scene M3's
 * shadow-casting (issue #77) will iterate at simulation time. Sibling to
 * `deriveSystemConfig.ts`, which derives the (unrelated, pre-existing)
 * `SystemConfig` from the same `SceneDesignState`; kept as a separate
 * function/file rather than folded into that one since the two outputs
 * have independent consumers and neither needs the other's result.
 *
 * ## Shared scene-local coordinate frame
 *
 * Every traced shape's `ExtrusionGeometry` (from `scene/derive`'s
 * `polygonToExtrusionGeometry`) is independently centered on its own
 * polygon's centroid (that module's doc comment) — so, exactly like
 * `Scene3DView.tsx` already does when rendering multiple shapes together,
 * this function picks one shared `sceneOrigin` and translates every
 * shape's vertices into that one frame via `geometryBuilders.ts`'s
 * `offsetToSceneOrigin` — the *same* translation `Scene3DView.tsx` uses,
 * reused here rather than reimplemented, so a `SceneGeometry` shape lines
 * up with what the user actually saw rendered. `Obstruction.position` and
 * each panel's `PanelPlacement.center` are already recorded in that same
 * scene-local frame at the point they're created/computed (ground clicks
 * resolve directly into it, and `panelAutoFillGrid` runs against a shape's
 * own `ExtrusionGeometry.vertices`, which needs the same per-shape offset
 * applied to land in the shared frame) — so obstructions need no further
 * translation, and panel positions need the same per-shape offset as their
 * owning shape's vertices.
 *
 * ### Anchor stability (issue #84)
 *
 * `sceneOrigin` is `sceneAnchorOrigin`'s **first traced shape's own
 * polygon centroid, in trace order** — computed straight from the
 * polygon, deliberately WITHOUT regard to whether that shape's step-2
 * config is resolvable yet. A polygon's centroid (`polygonCentroid`,
 * `scene/derive/geo.ts`) doesn't depend on tilt/azimuth at all, so this
 * can be computed even for a shape that hasn't been configured (or can't
 * produce valid geometry) yet.
 *
 * This used to instead be "the first shape's `ExtrusionGeometry.origin`,
 * among shapes with *resolvable* geometry" — which silently changed
 * anchor shape whenever the user configured shapes out of trace order:
 * if shape A (traced first) was configured after shape B (traced second),
 * the anchor would be B while A was unconfigured, then silently jump to A
 * once A's config landed. `Obstruction.position` and `SceneGeometry`'s
 * translated vertices/panels are frozen data computed once (ground clicks
 * resolve directly into whatever frame is live at click time — see
 * `Scene3DView.tsx`'s own `sceneOrigin`) rather than continuously
 * re-derived, so an anchor that moves *after* an obstruction was placed
 * left that obstruction's position silently wrong relative to the shapes
 * around it — a real, unbounded (tens-of-meters-scale) misalignment once
 * M3 wired obstructions into actual shading math. Anchoring on trace
 * order alone (never on which shapes currently resolve) keeps the anchor
 * fixed for as long as the first-traced shape stays first-traced,
 * regardless of the order shapes get configured in. `Scene3DView.tsx`'s
 * `sceneOrigin` and `SceneEditorFlow.tsx`'s obstruction-list bookkeeping
 * use this exact same `sceneAnchorOrigin` function, so the live 3D view a
 * user places obstructions in and this derivation always agree.
 *
 * A scene with no traced shapes at all has no natural `sceneOrigin`; this
 * function falls back to `{ lat: 0, lon: 0 }` in that case, matching
 * `Scene3DView`'s own fallback — harmless, since there's nothing to
 * translate relative to it either way.
 */

import type { LatLon, PanelPlacement, Point2D } from '../derive'
import { polygonCentroid, polygonToExtrusionGeometry } from '../derive'
import {
  liftToPlane,
  offsetToSceneOrigin,
  translateVertices,
} from '../scene/geometryBuilders'
import type { SceneDesignState } from '../flow/types'
import type { SceneGeometry, Vec3 } from '../../simulation'

/**
 * `polygonToExtrusionGeometry` only accepts `tiltDeg` in `[0, 90)` (a
 * vertical wall's plan-view footprint is degenerate — see that function's
 * own doc comment), while `ConfigureShapes`'s validation allows a
 * configured tilt of exactly 90, matching `SystemConfigForm`'s existing
 * 0-90 range. `SceneEditorFlow`'s 3D preview clamps for the same reason
 * (its own `MAX_RENDER_TILT_DEG`) — this mirrors that clamp so a
 * `tiltDeg: 90` shape still produces geometry here (near-vertical, rather
 * than throwing) instead of silently vanishing from `SceneGeometry.shapes`
 * the way `deriveSystemConfigFromScene`'s shape-skip-on-missing-config
 * path might suggest. This does not alter the configured `tiltDeg` stored
 * in `shapeConfigs`/`SystemConfig` — purely a geometry-derivation safety
 * measure, same as the render-side clamp.
 */
const MAX_GEOMETRY_TILT_DEG = 89.9

export interface ResolvedShapeGeometry {
  id: string
  origin: { lat: number; lon: number }
  vertices: Vec3[]
  tiltDeg: number
  azimuthDeg: number
}

/**
 * Resolves a single traced shape's step-2 config into real geometry, or
 * `undefined` when it can't (yet) produce any — the one place that
 * decision is made, shared by `deriveSceneGeometryFromScene` below and
 * `deriveSystemConfig.ts`'s `isShapeGeometryResolvable` (issue #88, item
 * 4: these two used to independently duplicate an equivalent check —
 * "provably in agreement" only by construction/fuzz-testing, not by
 * sharing code — so a future change to one side's skip conditions could
 * silently reopen the shapeId-correlation gap issue #78 closed).
 *
 * A shape fails to resolve when:
 * - there's no matching `shapeConfigs` entry at all (`config` is
 *   `undefined` — a shape whose step-2 config hasn't been filled in, or
 *   was never visited),
 * - `tiltDeg`/`azimuthDeg` isn't finite (issue #89: `NaN < 0` and
 *   `NaN >= 90` both evaluate to `false`, so a `NaN` value would otherwise
 *   silently pass `polygonToExtrusionGeometry`'s own range check and
 *   produce `NaN` vertices/area rather than being rejected here). Not
 *   reachable via the UI today — `ConfigureShapes`'s own validation gates
 *   advancement before a shape can carry a non-finite value — but this is
 *   the single choke point both derivations flow through, so hardening it
 *   here covers both for free, and for any future caller.
 * - the tilt/polygon combination makes `polygonToExtrusionGeometry` throw
 *   (e.g. a self-intersecting polygon that slipped through step-1
 *   validation with a still-present step-2 config — see that function's
 *   doc comment for what counts as degenerate).
 *
 * `tiltDeg` is clamped to {@link MAX_GEOMETRY_TILT_DEG} before being
 * handed to `polygonToExtrusionGeometry` (which only accepts `[0, 90)` —
 * see that function's own doc comment for why 90 is degenerate) and the
 * *clamped* value is what's returned here, not the raw `config.tiltDeg` —
 * see the inline comment at the call site in `deriveSceneGeometryFromScene`
 * for why a caller must not re-derive geometry from the unclamped value.
 */
export function resolveShapeGeometry(
  shape: { id: string; polygon: LatLon[] },
  config: { tiltDeg: number; azimuthDeg: number } | undefined,
): ResolvedShapeGeometry | undefined {
  if (!config) return undefined
  if (!Number.isFinite(config.tiltDeg) || !Number.isFinite(config.azimuthDeg)) {
    return undefined
  }
  const safeTilt = Math.min(config.tiltDeg, MAX_GEOMETRY_TILT_DEG)
  try {
    const geometry = polygonToExtrusionGeometry(
      shape.polygon,
      safeTilt,
      config.azimuthDeg,
    )
    return {
      id: shape.id,
      origin: geometry.origin,
      vertices: geometry.vertices,
      // Stored clamped (safeTilt), not the raw config.tiltDeg: this value
      // feeds panelPosition's liftToPlane call below, and it must agree
      // with the clamp already applied to `vertices` above (via
      // polygonToExtrusionGeometry) — otherwise a shape and its own panels
      // would be built from two different tilts. For a tiltDeg: 90 shape,
      // tan(90°) is a finite-but-huge float (~1.6e16), not an error, so an
      // unclamped value here produces a panel z off by ~15 orders of
      // magnitude with nothing to catch it downstream.
      tiltDeg: safeTilt,
      azimuthDeg: config.azimuthDeg,
    }
  } catch {
    return undefined
  }
}

/**
 * Whether a traced shape's step-2 config can actually produce geometry —
 * i.e. whether `deriveSceneGeometryFromScene` would include it in
 * `SceneGeometry.shapes`/`panels` rather than silently skipping it. A thin
 * boolean wrapper over `resolveShapeGeometry` (see that function's doc
 * comment for exactly which cases count as unresolvable), exported so
 * `deriveSystemConfig.ts` can decide, per array, whether to populate
 * `PanelArrayConfig.shapeId` — the two derivations must agree on exactly
 * which shapes are "resolvable" (see `PanelArrayConfig.shapeId`'s doc
 * comment on why they used to disagree). Calling `resolveShapeGeometry`
 * from both places, rather than duplicating its checks, is what keeps them
 * in sync going forward.
 */
export function isShapeGeometryResolvable(
  shape: { id: string; polygon: LatLon[] },
  config: { tiltDeg: number; azimuthDeg: number } | undefined,
): boolean {
  return resolveShapeGeometry(shape, config) !== undefined
}

/**
 * The scene's shared local-frame anchor (issue #84): the first traced
 * shape's own polygon centroid, in trace order — see the module doc
 * comment's "Anchor stability" section for why this is computed straight
 * from the polygon (via `polygonCentroid`) rather than from any shape's
 * resolved `ExtrusionGeometry.origin` (which, for the *first* traced
 * shape, is exactly the same value anyway — `polygonToExtrusionGeometry`
 * derives its own `origin` this same way — but computing it here works
 * even when the first traced shape's config isn't resolvable yet, which is
 * the whole point).
 *
 * Exported so `Scene3DView.tsx` (the live 3D view a ground click resolves
 * an obstruction's position into) and `SceneEditorFlow.tsx` (which
 * re-projects already-placed obstructions if this anchor ever does move —
 * e.g. the first-traced shape itself gets deleted) use the exact same
 * anchor this derivation does.
 *
 * Falls back to `{ lat: 0, lon: 0 }` not just for an empty `tracedShapes`
 * list but also for a first shape with a degenerate (empty) polygon —
 * `polygonCentroid` throws on that (see its own doc comment) rather than
 * returning a sentinel, and this function has no better anchor to offer in
 * that case either. Shouldn't happen for a shape that made it out of
 * `SceneTracing`'s own step-1 validation, but this keeps the anchor itself
 * from ever being the thing that crashes a scene with unusual input.
 */
export function sceneAnchorOrigin(
  tracedShapes: { polygon: LatLon[] }[],
): LatLon {
  const first = tracedShapes[0]
  if (!first) return { lat: 0, lon: 0 }
  try {
    return polygonCentroid(first.polygon)
  } catch {
    return { lat: 0, lon: 0 }
  }
}

/** Lifts a panel's plan-view center onto its shape's tilted plane, then translates into the shared scene-local frame. */
function panelPosition(
  panel: PanelPlacement,
  shape: ResolvedShapeGeometry,
  offset: Point2D,
): Vec3 {
  return {
    x: panel.center.x + offset.x,
    y: panel.center.y + offset.y,
    z: liftToPlane(panel.center, shape.tiltDeg, shape.azimuthDeg),
  }
}

/**
 * Derives a `SceneGeometry` from a scene-design session — see the module
 * doc comment above for the shared coordinate frame every field is
 * expressed in.
 *
 * A traced shape whose step-2 config is missing, or whose tilt/azimuth
 * can't produce valid geometry (e.g. an edited-but-not-yet-submitted
 * field — `polygonToExtrusionGeometry` throws on a degenerate polygon),
 * is skipped defensively, matching `SceneEditorFlow`'s own 3D-preview
 * skip behavior for the same cases — its panels (if any survived in
 * `state.panelLayouts` from a prior valid computation) are skipped too,
 * since there's no geometry left to place them on. An empty/degenerate
 * `SceneDesignState` (no traced shapes) produces an empty `SceneGeometry`
 * (`{ shapes: [], obstructions: [], panels: [] }` unless obstructions were
 * placed), not an error.
 */
export function deriveSceneGeometryFromScene(
  state: SceneDesignState,
): SceneGeometry {
  const resolvedShapes: ResolvedShapeGeometry[] = state.tracedShapes.flatMap(
    (shape) => {
      const config = state.shapeConfigs.find((c) => c.shapeId === shape.id)
      const resolved = resolveShapeGeometry(shape, config)
      return resolved ? [resolved] : []
    },
  )

  // See the module doc comment's "Anchor stability" section: this is
  // independent of which shapes are resolvable, so it never moves just
  // because shapes got configured in a different order.
  const sceneOrigin = sceneAnchorOrigin(state.tracedShapes)

  const offsetById = new Map(
    resolvedShapes.map((shape) => [
      shape.id,
      offsetToSceneOrigin(shape.origin, sceneOrigin),
    ]),
  )

  const shapesById = new Map(resolvedShapes.map((s) => [s.id, s]))

  const shapes: SceneGeometry['shapes'] = resolvedShapes.map((shape) => ({
    id: shape.id,
    vertices: translateVertices(shape.vertices, offsetById.get(shape.id)!),
  }))

  const obstructions: SceneGeometry['obstructions'] = state.obstructions.map(
    (o) => ({
      kind: o.kind,
      position: { x: o.position.x, y: o.position.y },
      heightM: o.heightM,
      radiusM: o.radiusM,
    }),
  )

  const panels: SceneGeometry['panels'] = state.panelLayouts.flatMap(
    (layout) => {
      const shape = shapesById.get(layout.shapeId)
      if (!shape) return []
      const offset = offsetById.get(shape.id)!
      return layout.panels.map((panel) => ({
        shapeId: layout.shapeId,
        position: panelPosition(panel, shape, offset),
      }))
    },
  )

  return { shapes, obstructions, panels }
}
