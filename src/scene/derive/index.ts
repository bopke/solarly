/**
 * scene/derive
 *
 * Pure geometry functions for M2's 3D plot scene editor: turning a traced
 * lat/lon polygon into tilted-plane 3D geometry, suggesting an azimuth
 * from the polygon's shape, and auto-filling a panel grid within a
 * footprint. No dependency on React, Three.js/R3F, or MapLibre — see each
 * module's doc comment for the math and the simplifications taken.
 *
 * See docs/superpowers/specs/2026-09-13-solarly-m2-design.md's
 * architecture section for how this module fits into `scene/`.
 */

export type { LatLon, Point2D } from './geo'
export {
  normalizeDegrees,
  pointInPolygon,
  polygonAreaCentroidLocal,
  polygonAreaM2,
  polygonCentroid,
  projectPolygonToLocalMeters,
  toLocalMeters,
  vectorBearingDeg,
} from './geo'

export type { ExtrusionGeometry, Vec3 } from './polygonToExtrusionGeometry'
export { polygonToExtrusionGeometry } from './polygonToExtrusionGeometry'

export { suggestAzimuth } from './suggestAzimuth'

export type {
  GridCell,
  PanelAutoFillOptions,
  PanelAutoFillResult,
  PanelDimensions,
  PanelPlacement,
} from './panelAutoFillGrid'
export { panelAutoFillGrid } from './panelAutoFillGrid'
