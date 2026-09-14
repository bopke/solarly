import { describe, expect, it } from 'vitest'
import {
  isSelfIntersecting,
  MIN_POLYGON_AREA_M2,
  polygonAreaM2,
  validatePolygon,
} from './geometry'
import type { LatLon } from './geometry'

// Fixtures anchored on real-world coordinates (Berlin, ~52.52°N) rather
// than near (0, 0) — see issue #91, item 3: at (0, 0) longitude and
// latitude degrees are both ~111km/degree, which happened to mask a bug
// where the local-meters projection only scaled coordinates (never
// translated them off raw lat/lon degrees), leaving points at ~1e6-1e7 m
// at real-world latitudes and making `segmentsIntersect`'s `1e-9`
// collinearity epsilon effectively dead. `LON_SCALE` corrects longitude
// deltas for meridian convergence at this latitude, so these fixtures
// describe the same real-world distances the old (0, 0)-anchored ones did.
const BERLIN_LAT = 52.52
const BERLIN_LON = 13.405
const LON_SCALE = 1 / Math.cos((BERLIN_LAT * Math.PI) / 180)

function berlin(dLat: number, dLon: number): LatLon {
  return { lat: BERLIN_LAT + dLat, lon: BERLIN_LON + dLon * LON_SCALE }
}

// A roughly 100m x 100m square.
const SQUARE_100M: LatLon[] = [
  berlin(0, 0),
  berlin(0, 0.0009), // ~100m east
  berlin(0.0009, 0.0009), // ~100m north-east
  berlin(0.0009, 0), // ~100m north
]

// A bowtie: connecting the vertices in this order crosses the two
// "diagonal" edges over each other.
const BOWTIE: LatLon[] = [
  berlin(0, 0),
  berlin(0.001, 0.001),
  berlin(0, 0.001),
  berlin(0.001, 0),
]

describe('polygonAreaM2', () => {
  it('computes the area of a roughly-square polygon', () => {
    const area = polygonAreaM2(SQUARE_100M)
    // ~100m x 100m = ~10,000 m^2; generous tolerance for the flat-earth
    // approximation and rounded test coordinates.
    expect(area).toBeGreaterThan(9000)
    expect(area).toBeLessThan(11000)
  })

  it('returns 0 for fewer than 3 points', () => {
    expect(polygonAreaM2([])).toBe(0)
    expect(polygonAreaM2([berlin(0, 0)])).toBe(0)
    expect(polygonAreaM2([berlin(0, 0), berlin(1, 1)])).toBe(0)
  })

  it('is insensitive to winding order (returns a magnitude)', () => {
    const clockwise = [...SQUARE_100M].reverse()
    expect(polygonAreaM2(clockwise)).toBeCloseTo(polygonAreaM2(SQUARE_100M), 5)
  })
})

describe('isSelfIntersecting', () => {
  it('is false for a simple convex polygon', () => {
    expect(isSelfIntersecting(SQUARE_100M)).toBe(false)
  })

  it('is true for a bowtie-shaped polygon', () => {
    expect(isSelfIntersecting(BOWTIE)).toBe(true)
  })

  it('is false for a triangle (too few edges to self-intersect)', () => {
    expect(
      isSelfIntersecting([berlin(0, 0), berlin(0, 0.001), berlin(0.001, 0)]),
    ).toBe(false)
  })

  it('does not flag adjacent edges sharing an endpoint as intersecting', () => {
    // A concave (L-shaped) but still simple polygon — adjacent-edge
    // sharing should never be mistaken for self-intersection.
    const lShape: LatLon[] = [
      berlin(0, 0),
      berlin(0, 0.002),
      berlin(0.001, 0.002),
      berlin(0.001, 0.001),
      berlin(0.002, 0.001),
      berlin(0.002, 0),
    ]
    expect(isSelfIntersecting(lShape)).toBe(false)
  })

  it('detects an overlapping-collinear edge pair at real-world coordinates (regression for issue #91 item 3)', () => {
    // Two non-adjacent edges lie on the same line (y = 0 in local meters,
    // roughly the "south" side of the shape) and overlap: edge (0,1) runs
    // from x=0 to x=200, edge (3,4) runs from x=300 back to x=100. This is
    // only caught by `segmentsIntersect`'s collinear special-case branch
    // (all four orientation tests come back exactly 0), which is exactly
    // the branch whose `1e-9` epsilon went dead when the projection never
    // translated real-world lat/lon degrees down to a small local origin.
    const overlappingCollinear: LatLon[] = [
      berlin(0, 0), // (0, 0) m
      berlin(0, 0.0029505), // (200, 0) m
      berlin(0.00044924, 0.0029505), // (200, 50) m
      berlin(0, 0.0044258), // (300, 0) m
      berlin(0, 0.0014753), // (100, 0) m — overlaps edge (0,1)
      berlin(0.00044924, 0), // (0, 50) m
    ]
    expect(isSelfIntersecting(overlappingCollinear)).toBe(true)
  })
})

describe('validatePolygon', () => {
  it('returns null for a valid polygon', () => {
    expect(validatePolygon(SQUARE_100M)).toBeNull()
  })

  it('flags too few vertices', () => {
    const result = validatePolygon([berlin(0, 0), berlin(0, 0.001)])
    expect(result?.kind).toBe('too-few-vertices')
  })

  it('flags self-intersecting polygons', () => {
    const result = validatePolygon(BOWTIE)
    expect(result?.kind).toBe('self-intersecting')
  })

  it('flags near-zero-area polygons', () => {
    const tiny: LatLon[] = [
      berlin(0, 0),
      berlin(0, 0.0000001),
      berlin(0.0000001, 0.0000001),
      berlin(0.0000001, 0),
    ]
    expect(polygonAreaM2(tiny)).toBeLessThan(MIN_POLYGON_AREA_M2)
    const result = validatePolygon(tiny)
    expect(result?.kind).toBe('near-zero-area')
  })
})
