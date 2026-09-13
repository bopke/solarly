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
 * this function picks one shared `sceneOrigin` (the first shape's own
 * `ExtrusionGeometry.origin`, in traced-shape order, among shapes with
 * resolvable geometry) and translates every shape's vertices into that
 * one frame via `geometryBuilders.ts`'s `offsetToSceneOrigin` — the *same*
 * translation `Scene3DView.tsx` uses, reused here rather than
 * reimplemented, so a `SceneGeometry` shape lines up with what the user
 * actually saw rendered. `Obstruction.position` and each panel's
 * `PanelPlacement.center` are already recorded in that same scene-local
 * frame at the point they're created/computed (ground clicks resolve
 * directly into it, and `panelAutoFillGrid` runs against a shape's own
 * `ExtrusionGeometry.vertices`, which needs the same per-shape offset
 * applied to land in the shared frame) — so obstructions need no further
 * translation, and panel positions need the same per-shape offset as their
 * owning shape's vertices.
 *
 * A shape with no traced shapes at all has no natural `sceneOrigin`; this
 * function falls back to `{ lat: 0, lon: 0 }` in that case, matching
 * `Scene3DView`'s own fallback — harmless, since there's nothing to
 * translate relative to it either way.
 */

import type { PanelPlacement } from '../derive'
import { polygonToExtrusionGeometry } from '../derive'
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

interface ResolvedShapeGeometry {
  id: string
  origin: { lat: number; lon: number }
  offset: { x: number; y: number }
  vertices: Vec3[]
  tiltDeg: number
  azimuthDeg: number
}

/** Lifts a panel's plan-view center onto its shape's tilted plane, then translates into the shared scene-local frame. */
function panelPosition(
  panel: PanelPlacement,
  shape: ResolvedShapeGeometry,
): Vec3 {
  return {
    x: panel.center.x + shape.offset.x,
    y: panel.center.y + shape.offset.y,
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
      if (!config) return []
      const safeTilt = Math.min(config.tiltDeg, MAX_GEOMETRY_TILT_DEG)
      try {
        const geometry = polygonToExtrusionGeometry(
          shape.polygon,
          safeTilt,
          config.azimuthDeg,
        )
        return [
          {
            id: shape.id,
            origin: geometry.origin,
            // Offset assigned below, once sceneOrigin is known.
            offset: { x: 0, y: 0 },
            vertices: geometry.vertices,
            tiltDeg: config.tiltDeg,
            azimuthDeg: config.azimuthDeg,
          },
        ]
      } catch {
        return []
      }
    },
  )

  const sceneOrigin = resolvedShapes[0]?.origin ?? { lat: 0, lon: 0 }

  for (const shape of resolvedShapes) {
    shape.offset = offsetToSceneOrigin(shape.origin, sceneOrigin)
  }

  const shapesById = new Map(resolvedShapes.map((s) => [s.id, s]))

  const shapes: SceneGeometry['shapes'] = resolvedShapes.map((shape) => ({
    id: shape.id,
    vertices: translateVertices(shape.vertices, shape.offset),
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
      return layout.panels.map((panel) => ({
        shapeId: layout.shapeId,
        position: panelPosition(panel, shape),
      }))
    },
  )

  return { shapes, obstructions, panels }
}
