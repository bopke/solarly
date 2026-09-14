/**
 * Pure ray/ground-plane intersection math for click-to-place obstructions
 * (issue #58). Kept free of any React/R3F/Three.js import (only structural
 * `{x,y,z}` shapes) so it's directly unit-testable under Vitest, mirroring
 * `geometryBuilders.ts`'s split of pure vertex math from the component
 * that renders it.
 *
 * R3F's pointer events (`ThreeEvent<MouseEvent>`) expose the underlying
 * `THREE.Raycaster`'s ray as `event.ray` (a `{ origin, direction }` pair,
 * both `THREE.Vector3`, which structurally satisfy `Vec3` here). This
 * module intersects that ray against the scene's ground plane (z = 0, per
 * `scene/derive`'s x=east/y=north/z=up convention) directly, rather than
 * relying on the invisible ground mesh's own raycast hit point — the
 * result doesn't depend on that mesh's size or subdivision, only on the
 * ray itself, so a click just past the mesh's edge (or a differently-sized
 * mesh in a future revision) still resolves to the same, exact point.
 */

import type { Vec3 } from '../derive'
import type { Point2D } from '../derive'
import { pointInPolygon } from '../derive'

export interface Ray3 {
  origin: Vec3
  direction: Vec3
}

/**
 * Finds where `ray` crosses the ground plane (z = 0), returning the
 * intersection's `(x, y)` in the same scene-local meters frame the ray is
 * defined in.
 *
 * Returns `null` when the ray can't usefully define a ground point:
 * - it's (near-)parallel to the ground (`direction.z` ~ 0 — an
 *   effectively edge-on ray, e.g. a camera looking exactly along the
 *   horizon), which would otherwise require dividing by ~0, or
 * - the plane is behind the ray's origin (`t < 0` — the ray points away
 *   from the ground, e.g. the camera is below ground level looking up,
 *   which shouldn't happen with this app's orbit camera but is guarded
 *   against defensively).
 */
export function intersectGroundPlane(ray: Ray3): Point2D | null {
  const { origin, direction } = ray
  const PARALLEL_EPSILON = 1e-9
  if (Math.abs(direction.z) < PARALLEL_EPSILON) {
    return null
  }
  const t = -origin.z / direction.z
  if (t < 0) {
    return null
  }
  return {
    x: origin.x + t * direction.x,
    y: origin.y + t * direction.y,
  }
}

/**
 * True when `point` falls inside any of `footprints`' plan-view polygons
 * (point-in-polygon against each, via `scene/derive`'s `pointInPolygon`).
 *
 * Used to reject obstruction placement at a ground-plane point that's
 * really underneath a traced shape (issue #58 PR #69 review). The
 * invisible ground-plane click-catcher sits at z = 0, but
 * `polygonToExtrusionGeometry` tilts a shape's geometry about its own
 * centroid, so a tilted shape's surface straddles z = 0 — roughly half of
 * a steeply-tilted roof actually sits *below* the ground plane. Because
 * R3F dispatches pointer events nearest-hit-first, a ray aimed at that
 * sunken half can hit the ground-plane mesh before the roof's own plane
 * mesh (whose `onClick` is supposed to `stopPropagation` and block
 * ground-placement), letting a click on the roof fall through and place
 * an obstruction inside the roof's own footprint.
 *
 * This check is deliberately independent of that raycast-ordering/z
 * quirk: it only looks at the *plan-view* (x, y) footprint of each shape,
 * which is well-defined and stable regardless of tilt, viewing angle, or
 * which mesh the raycaster happened to hit first. `footprints` must be in
 * the same scene-local meters frame as `point` (i.e. each shape's own
 * vertices already translated by its `offsetToSceneOrigin` offset — see
 * `Scene3DView`'s `shapeFootprints`).
 *
 * ## Known limitation: a residual gap just outside a footprint (issue #86)
 *
 * This guard only rejects points genuinely *inside* a footprint — it does
 * not, and is not intended to, correct the original raycast-ordering quirk
 * described above for a click that lands just past a shape's edge. In
 * practice a roof click can still resolve to a ground point measured
 * 0.01-4.6m (median ~1.65m, per the #86 investigation) beyond the shape's
 * true edge, because that resolved point is still coming from the same
 * ground-plane raycast rather than the roof surface itself. This never
 * reinstates the original bug (nothing lands *under* a shape — that's
 * exactly what this guard prevents), it's just imprecise near an edge.
 * Tightening this further would need placement to resolve against the
 * roof's own tilted surface (not the flat ground plane) near a shape's
 * boundary — out of scope for this plan-view guard, which only needs to
 * catch the "under the roof" case, not every near-edge case.
 */
export function isInsideAnyFootprint(
  point: Point2D,
  footprints: Point2D[][],
): boolean {
  return footprints.some((footprint) => pointInPolygon(point, footprint))
}
