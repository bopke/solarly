import type { LatLon } from './geometry'

/** The two kinds of shape a user can trace, per the M2 design spec. */
export type TracedShapeKind = 'roof-face' | 'ground-array'

/**
 * One completed, tagged polygon traced over the map. This is the module's
 * output shape (see `SceneTracingProps.onShapesChange`) — consumed by the
 * "configure each shape" and 3D scene steps downstream (issues #59/#60).
 */
export interface TracedShape {
  id: string
  kind: TracedShapeKind
  polygon: LatLon[]
}
