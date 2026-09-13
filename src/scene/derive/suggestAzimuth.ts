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
 * This function's convention: **suggest the perpendicular direction that
 * points away from the polygon's own centroid** — i.e. imagine standing
 * at the longest edge's midpoint; the suggested azimuth points outward,
 * away from the bulk of the shape, not back into it. Rationale: for the
 * common case this feature targets (a traced single roof face, where the
 * longest edge is the ridge/eave farthest from the bulk of the polygon,
 * or a simple rectangular-ish plot), "faces away from the shape's own
 * mass" is the more often-correct guess than "faces into it" — a panel
 * facing back into its own roof footprint is the less physically sensible
 * reading of a traced shape. It is still just a starting suggestion:
 * the UI (per the M2 spec) always leaves this editable, precisely because
 * it can't be certain.
 *
 * Flat-earth simplification: bearings are computed in the same local
 * equirectangular meters projection as `geo.ts` (see its module doc),
 * accurate enough at roof/plot scale.
 */

import type { LatLon } from './geo'
import {
  projectPolygonToLocalMeters,
  vectorBearingDeg,
  type Point2D,
} from './geo'

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
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
  const centroidLocal: Point2D = { x: 0, y: 0 } // projection is centered on the centroid

  // Find the longest edge. Ties (e.g. an exact rectangle, where both pairs
  // of opposite sides can tie within a pair) resolve to whichever edge is
  // encountered first while walking the polygon in vertex order — an
  // arbitrary but deterministic tiebreak.
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

  const midpoint: Point2D = {
    x: (edgeStart.x + edgeEnd.x) / 2,
    y: (edgeStart.y + edgeEnd.y) / 2,
  }
  const towardMidpointFromCentroid: Point2D = {
    x: midpoint.x - centroidLocal.x,
    y: midpoint.y - centroidLocal.y,
  }

  // Pick whichever perpendicular points the same general direction as
  // "centroid -> edge midpoint" (i.e. further outward, away from the
  // centroid), per this function's documented convention above.
  const dotA =
    perpendicularA.x * towardMidpointFromCentroid.x +
    perpendicularA.y * towardMidpointFromCentroid.y
  const dotB =
    perpendicularB.x * towardMidpointFromCentroid.x +
    perpendicularB.y * towardMidpointFromCentroid.y
  const outward = dotA >= dotB ? perpendicularA : perpendicularB

  return vectorBearingDeg(outward)
}
