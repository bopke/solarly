/**
 * Public types for `scene/flow` — the 4-step "Design in 3D" overlay
 * (M2 design spec, issue #60). See `SceneEditorFlow.tsx` for the
 * component itself.
 */

import type { TracedShape } from '../tracing'
import type { ShapeConfig } from '../configure'
import type { Obstruction } from '../scene'

/** Minimal lat/lon location shape, structurally compatible with
 * `ResolvedLocation` (`src/ui/LocationPicker`), `scene/tracing`'s
 * `LatLon`, and `scene/configure`'s `ConfigureShapesLocation` — this
 * module stays self-contained rather than importing any of those,
 * matching the rest of `src/scene/`'s convention. */
export interface SceneFlowLocation {
  lat: number
  lon: number
}

/**
 * The full aggregated state of one scene-design session: every traced
 * shape (issue #56), each shape's tilt/azimuth configuration (issue
 * #59), and every placed obstruction (issue #58) — keyed sensibly (by
 * `TracedShape.id`/`ShapeConfig.shapeId`) so a consumer can join them.
 *
 * This is the shape issue #61 ("Apply") is expected to consume to derive
 * the multi-array `SystemConfig` described in the M2 design spec's "Data
 * flow and the multi-array model" section — deriving that `SystemConfig`
 * itself is explicitly out of scope for this module (issue #60).
 */
export interface SceneDesignState {
  /** Shapes traced in step 1. */
  tracedShapes: TracedShape[]
  /**
   * Whether step 1 currently has at least one unresolved validation
   * error (self-intersecting/near-zero-area polygon) — mirrors
   * `SceneTracing`'s `onShapesChange` `hasInvalidShapes` flag. `#61`
   * shouldn't need this (a `SceneDesignState` handed to `onApply` is
   * only ever reachable once step 1 was valid enough to advance past),
   * but it's included for completeness/defensiveness.
   */
  hasInvalidTracedShapes: boolean
  /** Per-shape tilt/azimuth configuration from step 2, one entry per traced shape. */
  shapeConfigs: ShapeConfig[]
  /** Whether every shape's step-2 configuration currently passes validation. */
  isShapeConfigValid: boolean
  /** Obstructions (trees/buildings) placed in step 3's 3D scene. */
  obstructions: Obstruction[]
}

export const EMPTY_SCENE_DESIGN_STATE: SceneDesignState = {
  tracedShapes: [],
  hasInvalidTracedShapes: false,
  shapeConfigs: [],
  isShapeConfigValid: true,
  obstructions: [],
}
