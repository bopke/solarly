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
