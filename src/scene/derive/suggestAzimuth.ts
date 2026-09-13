/**
 * Azimuth auto-suggestion from a traced polygon's longest edge.
 *
 * Used to prefill the roof-face azimuth field in M2's "configure each
 * traced shape" step (see docs/superpowers/specs/2026-09-13-solarly-m2-design.md),
 * on the assumption that the longest edge of a traced roof-face polygon is
 * usually its ridge or eave line, and the panel/roof slope runs
 * perpendicular to it.
 *
 * ## The ambiguity, and this function's convention
 *
 * A ridge/eave line is a *line*, not an arrow — it doesn't by itself say
 * which of its two perpendicular directions the roof actually slopes
 * toward. (Two roof faces sharing a ridge slope in opposite directions,
 * and a traced single-face polygon carries no elevation to disambiguate
 * which face was traced.) This is a genuinely ambiguous case; there is no
 * way to derive the "correct" answer from a flat traced outline alone.
 *
 * This function's convention, in order:
 *
 * 1. **Hemisphere-based disambiguation.** Prefer whichever of the two
 *    perpendicular directions is closer to equator-facing — due south
 *    (180 deg) in the northern hemisphere, due north (0 deg) in the
 *    southern hemisphere, with the hemisphere determined from the
 *    midpoint of the polygon's latitude bounding box (not a vertex-mean
 *    centroid, which extra vertices along one edge could drag across the
 *    equator). Rationale: a panel-bearing roof face is, in the
 *    overwhelming majority of real cases, oriented to face generally
 *    toward the equator (more sun exposure) rather than away from it, so
 *    this is a better prior than any property of the traced shape itself
 *    — and unlike a shape-derived tiebreak, it's completely independent of
 *    vertex trace order, winding direction, or how densely one edge was
 *    traced (it only depends on which of the two fixed compass directions
 *    is closer, which is a property of the edge's own orientation, not of
 *    the polygon's vertex list).
 * 2. **Extent-based fallback**, only reached when the two perpendiculars
 *    are *equally* equator-facing (an exactly east/west-facing ridge, the
 *    one case hemisphere alone can't break): prefer whichever direction
 *    the polygon's own shape extends farther toward, using the true
 *    area-weighted centroid (`polygonAreaCentroidLocal`, not a vertex
 *    mean — see that function's doc for why) and each vertex's extreme
 *    projection onto the candidate direction, rather than any single
 *    edge's position (which would reintroduce trace-order dependence,
 *    since which of the two tied-length longest edges is "first
 *    encountered" is itself an artifact of vertex order).
 * 3. **Fixed final tiebreak**, only reached for a shape with *exact*
 *    bilateral symmetry across the ridge axis (e.g. a plain rectangle
 *    whose long edge runs exactly north-south) — a case with no
 *    geometric asymmetry left to resolve it by. Deterministically prefers
 *    east (90 deg) over west (270 deg). This is genuinely arbitrary, but
 *    it's a single fixed rule rather than one that depends on vertex
 *    order, so the same shape always gets the same suggestion.
 *
 * Together, these make the suggested azimuth a pure function of the
 * polygon's *shape*, never of the order or density it happened to be
 * traced in — see this module's tests for the same rectangle traced
 * starting from each of its four corners, in both winding orders.
 *
 * Flat-earth simplification: bearings are computed in the same local
 * equirectangular meters projection as `geo.ts` (see its module doc),
 * accurate enough at roof/plot scale.
 */

import type { LatLon } from './geo'
import {
  normalizeDegrees,
  polygonAreaCentroidLocal,
  projectPolygonToLocalMeters,
  vectorBearingDeg,
  type Point2D,
} from './geo'

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Smallest angle (0-180) between two compass bearings. */
function angularDistanceDeg(a: number, b: number): number {
  const diff = Math.abs(normalizeDegrees(a) - normalizeDegrees(b)) % 360
  return diff > 180 ? 360 - diff : diff
}

/**
 * Suggests a compass azimuth (0-360°, clockwise from true north) for a
 * traced polygon, from its longest edge's real-world bearing.
 *
 * @param polygon Traced footprint vertices (lat/lon), at least 3.
 * @returns Suggested azimuth in degrees, 0-360.
 */
export function suggestAzimuth(polygon: LatLon[]): number {
  if (polygon.length < 3) {
    throw new Error('suggestAzimuth: polygon must have at least 3 vertices')
  }

  const { points } = projectPolygonToLocalMeters(polygon)

  // Find the longest edge (the presumed ridge/eave line). Ties between the
  // two parallel long edges of a rectangle-like shape resolve to whichever
  // is encountered first in vertex order — but that choice doesn't affect
  // the final answer, because both parallel edges share the same axis
  // (and therefore the same pair of candidate perpendicular directions,
  // see below), so which one gets picked here is immaterial.
  let longestLength = -Infinity
  let edgeStart: Point2D = points[0]
  let edgeEnd: Point2D = points[1]
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const length = distance(a, b)
    if (length > longestLength) {
      longestLength = length
      edgeStart = a
      edgeEnd = b
    }
  }

  const edge = { x: edgeEnd.x - edgeStart.x, y: edgeEnd.y - edgeStart.y }
  // The two horizontal directions perpendicular to the edge.
  const perpendicularA: Point2D = { x: edge.y, y: -edge.x }
  const perpendicularB: Point2D = { x: -edge.y, y: edge.x }
  const bearingA = vectorBearingDeg(perpendicularA)
  const bearingB = vectorBearingDeg(perpendicularB)

  // 1. Hemisphere-based disambiguation — see module doc. Which hemisphere
  // the shape is in is taken from the midpoint of its latitude bounding
  // box, not a vertex-mean centroid: the bounding box only depends on the
  // extreme vertices, so — unlike a vertex mean — it can't be dragged
  // across the equator just because one edge was traced more densely
  // than another.
  const minLat = Math.min(...polygon.map((p) => p.lat))
  const maxLat = Math.max(...polygon.map((p) => p.lat))
  const equatorFacingBearing = (minLat + maxLat) / 2 >= 0 ? 180 : 0
  const distA = angularDistanceDeg(bearingA, equatorFacingBearing)
  const distB = angularDistanceDeg(bearingB, equatorFacingBearing)
  if (distA !== distB) {
    return distA < distB ? bearingA : bearingB
  }

  // 2. Extent-based fallback (exactly east/west-facing ridge only) — pick
  // whichever direction the polygon's own vertices extend farther toward,
  // relative to the true area-weighted centroid. Using each direction's
  // farthest vertex (not a specific edge's midpoint) keeps this
  // independent of which tied-length edge happened to be "first
  // encountered" above.
  const areaCentroid = polygonAreaCentroidLocal(points)
  const maxExtent = (direction: Point2D): number =>
    Math.max(
      ...points.map(
        (p) =>
          (p.x - areaCentroid.x) * direction.x +
          (p.y - areaCentroid.y) * direction.y,
      ),
    )
  const extentA = maxExtent(perpendicularA)
  const extentB = maxExtent(perpendicularB)
  // Treat near-equal extents as tied (falling through to step 3) rather
  // than requiring bit-exact equality: for a genuinely symmetric shape,
  // floating-point summation order (which itself can vary with vertex
  // trace order) could otherwise nudge extentA/extentB to differ in the
  // last bit or two and make the pick depend on trace order again.
  const extentEpsilon = 1e-6 * Math.max(1, Math.abs(extentA), Math.abs(extentB))
  if (Math.abs(extentA - extentB) > extentEpsilon) {
    return extentA > extentB ? bearingA : bearingB
  }

  // 3. Fixed final tiebreak (exact bilateral symmetry) — see module doc.
  return angularDistanceDeg(bearingA, 90) <= angularDistanceDeg(bearingB, 90)
    ? bearingA
    : bearingB
}
