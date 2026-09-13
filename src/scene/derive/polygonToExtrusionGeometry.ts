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
 * surface's normal points toward, horizontally.
 *
 * ## How the flat footprint becomes a tilted plane
 *
 * The traced polygon has no elevation data — it's a flat, top-down
 * footprint. To turn it into a tilted plane, this function hinges the
 * footprint upward about an axis through the polygon's centroid,
 * perpendicular to the given azimuth direction, by the tilt angle. This
 * is a **rigid rotation**: it preserves every edge length and the total
 * surface area (verified in this module's tests), so the tilted plane is
 * a physically sensible "what if this footprint were tilted" shape.
 *
 * Simplification: real roofs hinge at an eave (an edge), not through the
 * centroid — but the traced footprint carries no information about which
 * edge that is (no elevation data, see module scope), and issue #55 is
 * explicit that azimuth's edge-vs-edge ambiguity is a known limitation
 * (see `suggestAzimuth.ts`). Hinging through the centroid keeps the
 * output centered on the same point the local coordinate system is
 * already centered on, and requires no extra assumption about which edge
 * is "downhill" — the resulting plane has the correct tilt, azimuth, and
 * footprint shape/area, just not necessarily the same ground-contact edge
 * a real roof would have. Good enough for M2's geometry-only scope (no
 * shadow-casting or eave alignment needed until M3).
 */

import type { LatLon, Point2D } from './geo'
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
   * Surface area in square meters. Equal to the flat footprint's area
   * (shoelace formula) since tilting is a rigid rotation — see module doc.
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

  const { origin, points } = projectPolygonToLocalMeters(polygon)
  const flatAreaM2 = polygonAreaM2(points)

  const tiltRad = (tiltDeg * Math.PI) / 180
  const azimuthRad = (azimuthDeg * Math.PI) / 180
  const cosTilt = Math.cos(tiltRad)
  const sinTilt = Math.sin(tiltRad)

  // Horizontal unit vector pointing toward the given azimuth (the "slope"
  // direction the surface tilts up away from) and its perpendicular (the
  // hinge axis, unaffected by the rotation).
  const slope = { x: Math.sin(azimuthRad), y: Math.cos(azimuthRad) }
  const hinge = { x: slope.y, y: -slope.x }

  const vertices: Vec3[] = points.map((p) => {
    const s = p.x * slope.x + p.y * slope.y
    const h = p.x * hinge.x + p.y * hinge.y
    return {
      x: h * hinge.x + s * cosTilt * slope.x,
      y: h * hinge.y + s * cosTilt * slope.y,
      z: s * sinTilt,
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
    areaM2: flatAreaM2,
    tiltDeg,
    azimuthDeg,
  }
}

// Re-exported for convenience so consumers of this module don't also need
// to import `Point2D` from `./geo` just to type intermediate values.
export type { Point2D }
