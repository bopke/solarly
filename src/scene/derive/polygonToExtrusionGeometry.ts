/**
 * Traced polygon -> tilted-plane 3D geometry.
 *
 * Turns a traced footprint (lat/lon vertices, as drawn flat over satellite
 * imagery) plus a tilt/azimuth into the vertex positions and surface
 * normal of the corresponding tilted plane, in a local meters coordinate
 * system a renderer (R3F, in issue #57) can consume directly: x = east,
 * y = north, z = up, all in meters, relative to the polygon's centroid.
 *
 * Tilt/azimuth convention (matches `solar-physics/poaIrradiance`'s
 * tilt/azimuth inputs): `tiltDeg` is measured from horizontal (0 = flat,
 * facing straight up; 90 = vertical, like a wall). `azimuthDeg` is the
 * compass direction (clockwise from true north, 0-360) the tilted
 * surface's normal points toward, horizontally. A surface facing
 * `azimuthDeg` slopes *down* toward that direction (its high side/ridge is
 * on the opposite side) — e.g. a south-facing (`azimuthDeg = 180`) roof's
 * ridge is on its north side, sloping down toward the south.
 *
 * ## Plan-view assumption: the traced polygon is NOT the true roof surface
 *
 * The traced polygon comes from top-down satellite imagery, so it is a
 * **plan-view (orthographically projected) footprint** of the roof, not
 * the roof's true on-slope shape — exactly the way a photo of a tilted
 * roof from directly overhead foreshortens it along the slope direction.
 * This matters for two things this function must get right:
 *
 * 1. **Registration with the imagery.** The 3D scene (issue #57) renders
 *    these vertices over/near the same map the polygon was traced on. If
 *    this function treated the traced polygon as the true surface and
 *    rigid-rotated it about the centroid, the *plan-view extent* of the
 *    result would shrink by `cos(tiltDeg)` (e.g. a traced 20m x 20m square
 *    at 40 deg tilt would only span +-7.66m in plan, not +-10m) — the
 *    rendered roof would no longer line up with the traced outline or the
 *    building beneath it.
 * 2. **True surface area.** `areaM2` should report the real, on-slope roof
 *    area, not the plan-view (satellite-trace) area. A tilted surface
 *    always has *more* true area than its plan-view projection, by a
 *    factor of `1 / cos(tiltDeg)`.
 *
 * So rather than rigidly rotating the traced polygon (which would treat it
 * as already being the true surface), this function computes, for each
 * traced (plan-view) vertex, the point on the tilted plane whose
 * *horizontal projection* (dropping z) lands back exactly on that traced
 * vertex. Concretely: decompose each point into a coordinate `h` along the
 * hinge axis (unaffected by tilt) and `s` along the slope direction (the
 * horizontal direction the surface faces and slopes down toward); the
 * true-surface point keeps the same `(x, y)` as the traced point — by
 * construction, projecting it straight down recovers the trace exactly —
 * and is lifted to `z = -s * tan(tiltDeg)`. This is an inverse
 * projection, not a rigid rotation: it does NOT preserve edge lengths (a
 * plan-view trace is foreshortened along the slope axis by design, so the
 * true surface is correspondingly longer there), but it does preserve the
 * plan-view outline, which is what registration with the imagery needs.
 * `areaM2` is accordingly the plan-view (shoelace) area divided by
 * `cos(tiltDeg)`.
 *
 * This inverse projection is undefined at `tiltDeg = 90` (a vertical
 * wall's plan-view footprint degenerates to a zero-width line, so there's
 * no unique way to recover a wall's true shape from a top-down trace) —
 * see the `tiltDeg` range this function accepts below.
 *
 * Simplification: real roofs hinge at an eave (an edge), not through the
 * centroid — but the traced footprint carries no information about which
 * edge that is (no elevation data, see module scope), and issue #55 is
 * explicit that azimuth's edge-vs-edge ambiguity is a known limitation
 * (see `suggestAzimuth.ts`). Using the centroid as the hinge-axis's
 * reference point keeps the output centered on the same point the local
 * coordinate system is already centered on, and requires no extra
 * assumption about which edge is "downhill" — the resulting plane has the
 * correct tilt, azimuth, and plan-view footprint, just not necessarily the
 * same ground-contact edge a real roof would have. Good enough for M2's
 * geometry-only scope (no shadow-casting or eave alignment needed until
 * M3).
 */

import type { LatLon } from './geo'
import { polygonAreaM2, projectPolygonToLocalMeters } from './geo'

/** A point in 3D local meters: x = east, y = north, z = up. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface ExtrusionGeometry {
  /** The lat/lon origin (polygon centroid) the local meters frame is relative to. */
  origin: LatLon
  /**
   * Tilted-plane vertex positions, in local meters, one per input polygon
   * vertex, same order and winding as the input. `z` is up.
   */
  vertices: Vec3[]
  /** Outward-facing unit surface normal, after tilting. */
  normal: Vec3
  /**
   * True on-slope surface area in square meters: the plan-view (traced)
   * footprint's shoelace area divided by `cos(tiltDeg)` — always >= the
   * plan-view area, since a tilted surface is foreshortened in plan view.
   * See module doc's "plan-view assumption" section.
   */
  areaM2: number
  tiltDeg: number
  azimuthDeg: number
}

/**
 * Derives the tilted-plane 3D geometry for a traced polygon.
 *
 * @param polygon Traced footprint vertices (lat/lon), at least 3.
 * @param tiltDeg Tilt from horizontal, in degrees (0 = flat, 90 = vertical).
 * @param azimuthDeg Compass direction the surface faces, clockwise from
 *   true north (0-360). Defaults to 180 (south-facing) — an arbitrary but
 *   harmless default for callers that haven't yet run azimuth suggestion;
 *   real callers should pass `suggestAzimuth(polygon)` or the user's edited value.
 */
export function polygonToExtrusionGeometry(
  polygon: LatLon[],
  tiltDeg: number,
  azimuthDeg = 180,
): ExtrusionGeometry {
  if (polygon.length < 3) {
    throw new Error(
      'polygonToExtrusionGeometry: polygon must have at least 3 vertices',
    )
  }
  if (tiltDeg < 0 || tiltDeg >= 90) {
    throw new Error(
      `polygonToExtrusionGeometry: tiltDeg must be in [0, 90) — a vertical ` +
        `or overhanging surface has no well-defined plan-view footprint to ` +
        `project a top-down trace onto (got ${tiltDeg})`,
    )
  }

  const { origin, points } = projectPolygonToLocalMeters(polygon)
  const planAreaM2 = polygonAreaM2(points)

  const tiltRad = (tiltDeg * Math.PI) / 180
  const azimuthRad = (azimuthDeg * Math.PI) / 180
  const cosTilt = Math.cos(tiltRad)
  const sinTilt = Math.sin(tiltRad)
  const tanTilt = Math.tan(tiltRad)

  // Horizontal unit vector pointing toward the given azimuth (the "slope"
  // direction the surface faces and slopes *down* toward — see module doc).
  const slope = { x: Math.sin(azimuthRad), y: Math.cos(azimuthRad) }

  // The traced polygon is a plan-view projection (see module doc), so the
  // true-surface vertex for each traced point keeps that point's exact
  // (x, y) — dropping z recovers the trace exactly — and is lifted along
  // z in proportion to its position `s` along the slope direction. `s` is
  // negated (rather than the more familiar `s * sinTilt` for a rigid
  // rotation) because the surface slopes *down* toward the azimuth
  // direction it faces: a point further along the slope/azimuth direction
  // is lower, not higher.
  const vertices: Vec3[] = points.map((p) => {
    const s = p.x * slope.x + p.y * slope.y
    return {
      x: p.x,
      y: p.y,
      z: -s * tanTilt,
    }
  })

  const normal: Vec3 = {
    x: sinTilt * slope.x,
    y: sinTilt * slope.y,
    z: cosTilt,
  }

  return {
    origin,
    vertices,
    normal,
    areaM2: planAreaM2 / cosTilt,
    tiltDeg,
    azimuthDeg,
  }
}
