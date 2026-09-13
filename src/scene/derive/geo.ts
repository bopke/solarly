/**
 * Shared geometry helpers for `scene/derive/`.
 *
 * Traced shapes come in as lists of `{ lat, lon }` vertices. Everything in
 * this module works in a *local flat-earth projection*: an equirectangular
 * projection centered on the polygon's centroid, converting lat/lon degrees
 * to meters-east/meters-north. This is a standard simplification for
 * small-scale geometry (a roof face or plot is, at most, a few hundred
 * meters across) — over that range, the error versus a true geodesic
 * projection is a few millimeters at most, far below the precision this
 * tracing/CAD-like workflow needs or a satellite trace could even supply.
 * It would NOT be appropriate for shapes spanning kilometers+, but nothing
 * in this project's scope does.
 *
 * Pure functions — no I/O, no dependency on any other module.
 */

/** A traced polygon vertex, or any geographic point. */
export interface LatLon {
  lat: number
  lon: number
}

/** A point in the local flat-earth projection, in meters. */
export interface Point2D {
  /** Meters east of the projection origin. */
  x: number
  /** Meters north of the projection origin. */
  y: number
}

/** Mean Earth radius, in meters (IUGG mean radius, same value used across `solar-physics/`-adjacent geo math). */
const EARTH_RADIUS_M = 6371000

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

/** Normalizes an angle in degrees to the [0, 360) range. */
export function normalizeDegrees(deg: number): number {
  const wrapped = deg % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

/**
 * Arithmetic mean of a polygon's vertex lat/lon. Used as the local
 * projection origin.
 *
 * This is NOT the true area-weighted centroid of an irregular polygon
 * (which would require the shoelace-weighted formula) — it's a simpler
 * vertex average. For choosing a projection origin, the difference is
 * negligible at roof/plot scale and doesn't affect correctness of any
 * downstream calculation (which all work in the projected meters frame,
 * not relative to "the true centroid").
 */
export function polygonCentroid(polygon: LatLon[]): LatLon {
  if (polygon.length === 0) {
    throw new Error('polygonCentroid: polygon must have at least one vertex')
  }
  const sum = polygon.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lon: acc.lon + p.lon }),
    { lat: 0, lon: 0 },
  )
  return { lat: sum.lat / polygon.length, lon: sum.lon / polygon.length }
}

/**
 * Converts a lat/lon point to local meters-east/meters-north relative to
 * `origin`, via an equirectangular projection (longitude scaled by
 * `cos(origin.lat)` to account for meridian convergence). See module doc
 * for the flat-earth simplification this relies on.
 */
export function toLocalMeters(point: LatLon, origin: LatLon): Point2D {
  const originLatRad = toRad(origin.lat)
  const x =
    toRad(point.lon - origin.lon) * Math.cos(originLatRad) * EARTH_RADIUS_M
  const y = toRad(point.lat - origin.lat) * EARTH_RADIUS_M
  return { x, y }
}

/**
 * Projects an entire polygon into local meters. Defaults the projection
 * origin to the polygon's own centroid (`polygonCentroid`) when `origin`
 * isn't given, which is what every `scene/derive/` function does — this
 * lets multiple derived quantities (geometry, azimuth, panel grid) share
 * the same local frame when called with the same polygon.
 */
export function projectPolygonToLocalMeters(
  polygon: LatLon[],
  origin: LatLon = polygonCentroid(polygon),
): { origin: LatLon; points: Point2D[] } {
  return { origin, points: polygon.map((p) => toLocalMeters(p, origin)) }
}

/**
 * Signed planform (footprint) area of a polygon already in local meters,
 * via the shoelace formula. Always returns a non-negative area regardless
 * of vertex winding order.
 */
export function polygonAreaM2(points: Point2D[]): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

/**
 * Point-in-polygon test (standard ray-casting / even-odd rule) on points
 * already in local meters. Points exactly on an edge may resolve either
 * way (standard ray-casting caveat); irrelevant for this module's use
 * (deciding whether a panel grid cell's center falls inside a traced
 * shape), where exact-edge coincidence is a measure-zero case.
 */
export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const vi = polygon[i]
    const vj = polygon[j]
    const intersects =
      vi.y > point.y !== vj.y > point.y &&
      point.x < ((vj.x - vi.x) * (point.y - vi.y)) / (vj.y - vi.y) + vi.x
    if (intersects) inside = !inside
  }
  return inside
}

/**
 * Compass bearing (clockwise from true north, 0-360°) of a local-meters
 * direction vector `(x = east, y = north)`. Used to turn an in-plane
 * direction (e.g. a polygon edge, or a perpendicular to one) into a
 * real-world azimuth.
 */
export function vectorBearingDeg(v: Point2D): number {
  return normalizeDegrees(toDeg(Math.atan2(v.x, v.y)))
}
