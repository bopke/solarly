/**
 * Pure geometry helpers for validating traced polygons.
 *
 * `src/scene/derive/` (issue #55, polygon → 3D extrusion geometry etc.) has
 * not landed on `main` yet as of this module's creation, so these are a
 * minimal, self-contained implementation scoped to exactly what tracing's
 * validation needs (area + self-intersection) rather than a dependency on
 * that not-yet-existing module. If/when `derive/` lands with equivalent
 * helpers, this file is a reasonable candidate to consolidate into it.
 */

/** A single vertex of a traced polygon, in WGS84 degrees. */
export interface LatLon {
  lat: number
  lon: number
}

/** Meters per degree of latitude — constant everywhere (WGS84 sphere approx). */
const METERS_PER_DEG_LAT = 111_320

/**
 * A polygon's real-world area is near-zero below this threshold (m²) —
 * flags degenerate shapes like a mis-click producing a sliver or a
 * polygon whose vertices are all nearly coincident. Real roof faces and
 * ground arrays are always many square meters, so this is a generous
 * floor, not a physical limit.
 */
export const MIN_POLYGON_AREA_M2 = 1

/**
 * Projects lat/lon degrees to a local flat-earth approximation in meters,
 * anchored at the polygon's own centroid-ish first vertex. Fine for the
 * small (building/plot-scale) extents this module deals with — not meant
 * for anything spanning a meaningful fraction of the globe.
 */
function toLocalMeters(polygon: LatLon[]): { x: number; y: number }[] {
  const originLat = polygon[0].lat
  const metersPerDegLon =
    METERS_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180)
  return polygon.map((point) => ({
    x: point.lon * metersPerDegLon,
    y: point.lat * METERS_PER_DEG_LAT,
  }))
}

/**
 * Signed area of a polygon (already projected to flat meters) via the
 * shoelace formula. Positive for counter-clockwise vertex order, negative
 * for clockwise — callers that only care about magnitude should
 * `Math.abs()` the result.
 */
function shoelaceSignedArea(points: { x: number; y: number }[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

/** Real-world area of a traced polygon, in square meters. */
export function polygonAreaM2(polygon: LatLon[]): number {
  if (polygon.length < 3) return 0
  return Math.abs(shoelaceSignedArea(toLocalMeters(polygon)))
}

/**
 * `true` if segments `p1->p2` and `p3->p4` properly intersect (crossing at
 * a single interior point), using the standard orientation-based test.
 * Segments that merely touch at a shared endpoint are NOT considered
 * intersecting — that's normal for adjacent polygon edges.
 */
function segmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): boolean {
  function orientation(
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
  ): number {
    const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
    if (Math.abs(val) < 1e-9) return 0
    return val > 0 ? 1 : 2
  }

  function onSegment(
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
  ): boolean {
    return (
      b.x <= Math.max(a.x, c.x) &&
      b.x >= Math.min(a.x, c.x) &&
      b.y <= Math.max(a.y, c.y) &&
      b.y >= Math.min(a.y, c.y)
    )
  }

  const o1 = orientation(p1, p2, p3)
  const o2 = orientation(p1, p2, p4)
  const o3 = orientation(p3, p4, p1)
  const o4 = orientation(p3, p4, p2)

  if (o1 !== o2 && o3 !== o4) return true

  // Collinear special cases — a segment's endpoint lying exactly on the
  // other segment.
  if (o1 === 0 && onSegment(p1, p3, p2)) return true
  if (o2 === 0 && onSegment(p1, p4, p2)) return true
  if (o3 === 0 && onSegment(p3, p1, p4)) return true
  if (o4 === 0 && onSegment(p3, p2, p4)) return true

  return false
}

/**
 * `true` if any two non-adjacent edges of `polygon` cross. Adjacent edges
 * (which always share exactly one endpoint) are excluded from the check —
 * sharing an endpoint is normal, not a self-intersection.
 */
export function isSelfIntersecting(polygon: LatLon[]): boolean {
  if (polygon.length < 4) return false
  const points = toLocalMeters(polygon)
  const n = points.length

  for (let i = 0; i < n; i++) {
    const a1 = points[i]
    const a2 = points[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      // Skip the edge itself and edges adjacent to it (sharing a vertex).
      if (j === i) continue
      const isAdjacent = j === i || (j + 1) % n === i || (i + 1) % n === j
      if (isAdjacent) continue

      const b1 = points[j]
      const b2 = points[(j + 1) % n]
      if (segmentsIntersect(a1, a2, b1, b2)) return true
    }
  }
  return false
}

/** A validation problem with one traced polygon, plus a human-readable message. */
export type PolygonValidationError =
  | { kind: 'too-few-vertices'; message: string }
  | { kind: 'self-intersecting'; message: string }
  | { kind: 'near-zero-area'; message: string }

/**
 * Validates a traced polygon, returning `null` if it's fine or a
 * validation error describing the first problem found (checked in the
 * order: too few vertices, self-intersection, near-zero area).
 */
export function validatePolygon(
  polygon: LatLon[],
): PolygonValidationError | null {
  if (polygon.length < 3) {
    return {
      kind: 'too-few-vertices',
      message: 'A shape needs at least 3 points to form a polygon.',
    }
  }
  if (isSelfIntersecting(polygon)) {
    return {
      kind: 'self-intersecting',
      message:
        "This shape's edges cross themselves — redraw it so the outline doesn't overlap itself.",
    }
  }
  const area = polygonAreaM2(polygon)
  if (area < MIN_POLYGON_AREA_M2) {
    return {
      kind: 'near-zero-area',
      message:
        'This shape is too small to be a real roof face or plot — its traced area is nearly zero.',
    }
  }
  return null
}
