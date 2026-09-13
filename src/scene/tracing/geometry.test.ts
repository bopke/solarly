import { describe, expect, it } from 'vitest'
import {
  isSelfIntersecting,
  MIN_POLYGON_AREA_M2,
  polygonAreaM2,
  validatePolygon,
} from './geometry'
import type { LatLon } from './geometry'

// A roughly 100m x 100m square near the equator, where 1 degree of
// longitude is close to 1 degree of latitude in real-world distance —
// makes the expected area easy to reason about.
const SQUARE_100M: LatLon[] = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 0.0009 }, // ~100m east
  { lat: 0.0009, lon: 0.0009 }, // ~100m north-east
  { lat: 0.0009, lon: 0 }, // ~100m north
]

// A bowtie: connecting the vertices in this order crosses the two
// "diagonal" edges over each other.
const BOWTIE: LatLon[] = [
  { lat: 0, lon: 0 },
  { lat: 0.001, lon: 0.001 },
  { lat: 0, lon: 0.001 },
  { lat: 0.001, lon: 0 },
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
    expect(polygonAreaM2([{ lat: 0, lon: 0 }])).toBe(0)
    expect(
      polygonAreaM2([
        { lat: 0, lon: 0 },
        { lat: 1, lon: 1 },
      ]),
    ).toBe(0)
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
      isSelfIntersecting([
        { lat: 0, lon: 0 },
        { lat: 0, lon: 0.001 },
        { lat: 0.001, lon: 0 },
      ]),
    ).toBe(false)
  })

  it('does not flag adjacent edges sharing an endpoint as intersecting', () => {
    // A concave (L-shaped) but still simple polygon — adjacent-edge
    // sharing should never be mistaken for self-intersection.
    const lShape: LatLon[] = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.002 },
      { lat: 0.001, lon: 0.002 },
      { lat: 0.001, lon: 0.001 },
      { lat: 0.002, lon: 0.001 },
      { lat: 0.002, lon: 0 },
    ]
    expect(isSelfIntersecting(lShape)).toBe(false)
  })
})

describe('validatePolygon', () => {
  it('returns null for a valid polygon', () => {
    expect(validatePolygon(SQUARE_100M)).toBeNull()
  })

  it('flags too few vertices', () => {
    const result = validatePolygon([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.001 },
    ])
    expect(result?.kind).toBe('too-few-vertices')
  })

  it('flags self-intersecting polygons', () => {
    const result = validatePolygon(BOWTIE)
    expect(result?.kind).toBe('self-intersecting')
  })

  it('flags near-zero-area polygons', () => {
    const tiny: LatLon[] = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.0000001 },
      { lat: 0.0000001, lon: 0.0000001 },
      { lat: 0.0000001, lon: 0 },
    ]
    expect(polygonAreaM2(tiny)).toBeLessThan(MIN_POLYGON_AREA_M2)
    const result = validatePolygon(tiny)
    expect(result?.kind).toBe('near-zero-area')
  })
})
