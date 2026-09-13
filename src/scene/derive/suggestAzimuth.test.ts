import { describe, expect, it } from 'vitest'
import { suggestAzimuth } from './suggestAzimuth'

/**
 * Test polygons below are rectangles at the equator (lat=0), where the
 * equirectangular projection has no longitude scaling distortion
 * (cos(0) = 1), so 1 degree of lon and 1 degree of lat both map to the
 * same ~111.2km — making "long edge runs exactly east-west" and "long
 * edge runs exactly north-south" hand-verifiable by construction: the
 * edges' lat/lon deltas alone (without needing to account for scaling)
 * determine which pair of edges is longer.
 *
 * See `suggestAzimuth.ts`'s module doc for the "perpendicular pointing
 * away from the polygon's centroid" convention these expected values
 * follow, and for why the longest-edge choice is inherently ambiguous
 * (hence picking test cases with an unambiguous, hand-reasoned expected
 * direction).
 */

describe('suggestAzimuth', () => {
  it('rejects a degenerate polygon (fewer than 3 vertices)', () => {
    expect(() =>
      suggestAzimuth([
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
      ]),
    ).toThrow()
  })

  it('a wide (E-W) rectangle whose north edge comes first suggests north (0 degrees)', () => {
    // Vertices in order NW, NE, SE, SW: the first edge (NW->NE) is the
    // north edge, longer (0.04 deg lon) than the side edges (0.02 deg
    // lat) — so it's picked as the longest edge. Its perpendicular
    // pointing away from the centroid (which sits south of this edge) is
    // due north.
    const polygon = [
      { lat: 0.01, lon: -0.02 }, // NW
      { lat: 0.01, lon: 0.02 }, // NE
      { lat: -0.01, lon: 0.02 }, // SE
      { lat: -0.01, lon: -0.02 }, // SW
    ]
    expect(suggestAzimuth(polygon)).toBeCloseTo(0, 3)
  })

  it('the same rectangle, but with the south edge listed first, suggests south (180 degrees)', () => {
    // Vertices in order SW, SE, NE, NW: the first edge (SW->SE) is the
    // south edge — same length as the north edge (a tie), but encountered
    // first, so it's the one picked. Its perpendicular pointing away from
    // the centroid (north of this edge) is due south.
    const polygon = [
      { lat: -0.01, lon: -0.02 }, // SW
      { lat: -0.01, lon: 0.02 }, // SE
      { lat: 0.01, lon: 0.02 }, // NE
      { lat: 0.01, lon: -0.02 }, // NW
    ]
    expect(suggestAzimuth(polygon)).toBeCloseTo(180, 3)
  })

  it('a tall (N-S) rectangle whose east edge comes first suggests east (90 degrees)', () => {
    // Vertices in order SE, NE, NW, SW: the first edge (SE->NE) is the
    // east edge, longer (0.04 deg lat) than the top/bottom edges (0.02
    // deg lon) — its perpendicular pointing away from the centroid (west
    // of this edge) is due east.
    const polygon = [
      { lat: -0.02, lon: 0.01 }, // SE
      { lat: 0.02, lon: 0.01 }, // NE
      { lat: 0.02, lon: -0.01 }, // NW
      { lat: -0.02, lon: -0.01 }, // SW
    ]
    expect(suggestAzimuth(polygon)).toBeCloseTo(90, 3)
  })

  it('always returns a value in [0, 360)', () => {
    const polygon = [
      { lat: 51.5, lon: -0.13 },
      { lat: 51.5008, lon: -0.129 },
      { lat: 51.5006, lon: -0.128 },
      { lat: 51.4999, lon: -0.1295 },
    ]
    const azimuth = suggestAzimuth(polygon)
    expect(azimuth).toBeGreaterThanOrEqual(0)
    expect(azimuth).toBeLessThan(360)
  })

  it('is a pure function: repeated calls with the same input return the same result', () => {
    const polygon = [
      { lat: 51.5, lon: -0.13 },
      { lat: 51.5008, lon: -0.129 },
      { lat: 51.5006, lon: -0.128 },
      { lat: 51.4999, lon: -0.1295 },
    ]
    expect(suggestAzimuth(polygon)).toBe(suggestAzimuth(polygon))
  })
})
