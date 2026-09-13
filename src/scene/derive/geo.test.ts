import { describe, expect, it } from 'vitest'
import {
  normalizeDegrees,
  pointInPolygon,
  polygonAreaM2,
  polygonCentroid,
  toLocalMeters,
  vectorBearingDeg,
} from './geo'

/**
 * Reference values for `toLocalMeters` below are computed independently
 * (by hand, with a calculator, from the documented equirectangular
 * projection formula: `x = deltaLon(rad) * cos(originLat) * R`,
 * `y = deltaLat(rad) * R`, with `R = 6371000`), not copied from the
 * implementation.
 */
describe('toLocalMeters', () => {
  it('a 0.001 degree northward offset at the equator is ~111.19m north', () => {
    const origin = { lat: 0, lon: 0 }
    const point = { lat: 0.001, lon: 0 }
    const result = toLocalMeters(point, origin)
    expect(result.y).toBeCloseTo(111.195, 2)
    expect(result.x).toBeCloseTo(0, 6)
  })

  it('a 0.002 degree eastward offset at 60N is ~111.19m east (longitude scaled by cos(lat))', () => {
    const origin = { lat: 60, lon: 0 }
    const point = { lat: 60, lon: 0.002 }
    const result = toLocalMeters(point, origin)
    expect(result.x).toBeCloseTo(111.195, 2)
    expect(result.y).toBeCloseTo(0, 6)
  })

  it('the origin itself maps to (0, 0)', () => {
    const origin = { lat: 37.5, lon: -122.1 }
    const result = toLocalMeters(origin, origin)
    expect(result.x).toBeCloseTo(0, 9)
    expect(result.y).toBeCloseTo(0, 9)
  })

  it('a southward/westward offset produces negative y/x', () => {
    const origin = { lat: 10, lon: 10 }
    const result = toLocalMeters({ lat: 9.999, lon: 9.999 }, origin)
    expect(result.x).toBeLessThan(0)
    expect(result.y).toBeLessThan(0)
  })
})

describe('polygonCentroid', () => {
  it('averages vertex lat/lon', () => {
    const centroid = polygonCentroid([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 2 },
      { lat: 2, lon: 2 },
      { lat: 2, lon: 0 },
    ])
    expect(centroid).toEqual({ lat: 1, lon: 1 })
  })

  it('throws on an empty polygon', () => {
    expect(() => polygonCentroid([])).toThrow()
  })
})

describe('polygonAreaM2', () => {
  it('computes the area of a simple square', () => {
    const area = polygonAreaM2([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ])
    expect(area).toBeCloseTo(100, 9)
  })

  it('returns the same area regardless of winding order', () => {
    const clockwise = polygonAreaM2([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ])
    expect(clockwise).toBeCloseTo(100, 9)
  })

  it('computes the area of a right triangle', () => {
    const area = polygonAreaM2([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ])
    expect(area).toBeCloseTo(8, 9)
  })
})

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]

  it('a point in the middle is inside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true)
  })

  it('a point well outside is outside', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(false)
  })

  it('a point outside on one axis only is outside', () => {
    expect(pointInPolygon({ x: 5, y: -1 }, square)).toBe(false)
  })
})

describe('vectorBearingDeg', () => {
  it('due north is 0 degrees', () => {
    expect(vectorBearingDeg({ x: 0, y: 1 })).toBeCloseTo(0, 9)
  })

  it('due east is 90 degrees', () => {
    expect(vectorBearingDeg({ x: 1, y: 0 })).toBeCloseTo(90, 9)
  })

  it('due south is 180 degrees', () => {
    expect(vectorBearingDeg({ x: 0, y: -1 })).toBeCloseTo(180, 9)
  })

  it('due west is 270 degrees', () => {
    expect(vectorBearingDeg({ x: -1, y: 0 })).toBeCloseTo(270, 9)
  })
})

describe('normalizeDegrees', () => {
  it('leaves in-range values unchanged', () => {
    expect(normalizeDegrees(90)).toBe(90)
  })

  it('wraps values above 360', () => {
    expect(normalizeDegrees(370)).toBeCloseTo(10, 9)
  })

  it('wraps negative values into range', () => {
    expect(normalizeDegrees(-10)).toBeCloseTo(350, 9)
  })
})
