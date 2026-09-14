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
 * See `suggestAzimuth.ts`'s module doc for the hemisphere-based
 * disambiguation convention these expected values follow, and for why the
 * longest-edge choice is inherently ambiguous (hence picking test cases
 * with an unambiguous, hand-reasoned expected direction).
 */

/** All cyclic rotations of a vertex list, in both winding orders. */
function allTracingOrders(
  polygon: { lat: number; lon: number }[],
): { lat: number; lon: number }[][] {
  const reversed = [...polygon].reverse()
  const orders: { lat: number; lon: number }[][] = []
  for (const base of [polygon, reversed]) {
    for (let start = 0; start < base.length; start++) {
      orders.push([...base.slice(start), ...base.slice(0, start)])
    }
  }
  return orders
}

describe('suggestAzimuth', () => {
  it('rejects a degenerate polygon (fewer than 3 vertices)', () => {
    expect(() =>
      suggestAzimuth([
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
      ]),
    ).toThrow()
  })

  it('a wide (E-W) rectangle at the equator suggests south (180 degrees), regardless of which corner tracing started from or winding order', () => {
    // Long edges (0.04 deg lon) run east-west; perpendicular to them is
    // due north/south. In the northern hemisphere (including the equator,
    // lat=0), the equator-facing choice is south.
    const rectangle = [
      { lat: 0.01, lon: -0.02 }, // NW
      { lat: 0.01, lon: 0.02 }, // NE
      { lat: -0.01, lon: 0.02 }, // SE
      { lat: -0.01, lon: -0.02 }, // SW
    ]
    for (const polygon of allTracingOrders(rectangle)) {
      expect(suggestAzimuth(polygon)).toBeCloseTo(180, 3)
    }
  })

  it('the same wide rectangle in the southern hemisphere suggests north (0 degrees)', () => {
    const rectangle = [
      { lat: -30.01, lon: -0.02 },
      { lat: -30.01, lon: 0.02 },
      { lat: -30.03, lon: 0.02 },
      { lat: -30.03, lon: -0.02 },
    ]
    for (const polygon of allTracingOrders(rectangle)) {
      expect(suggestAzimuth(polygon)).toBeCloseTo(0, 3)
    }
  })

  it('a tall (N-S) rectangle at the equator suggests a consistent azimuth regardless of tracing order (exact bilateral symmetry, no hemisphere cue)', () => {
    // Long edges (0.04 deg lat) run north-south; both perpendiculars (east
    // and west) are equally equator-facing, so this exercises the
    // extent/fixed tiebreak rather than the hemisphere rule. The point of
    // this test isn't which of east/west gets picked (genuinely
    // arbitrary for an exactly symmetric shape) — it's that the pick is
    // the SAME for every tracing order.
    const rectangle = [
      { lat: -0.02, lon: 0.01 }, // SE
      { lat: 0.02, lon: 0.01 }, // NE
      { lat: 0.02, lon: -0.01 }, // NW
      { lat: -0.02, lon: -0.01 }, // SW
    ]
    const results = allTracingOrders(rectangle).map((polygon) =>
      suggestAzimuth(polygon),
    )
    const [first, ...rest] = results
    for (const result of rest) {
      expect(result).toBeCloseTo(first, 3)
    }
    expect(first === 90 || first === 270).toBe(true)
  })

  it('densifying one edge with extra collinear points does not change the suggested azimuth', () => {
    const rectangle = [
      { lat: 0.01, lon: -0.02 }, // NW
      { lat: 0.01, lon: 0.02 }, // NE
      { lat: -0.01, lon: 0.02 }, // SE
      { lat: -0.01, lon: -0.02 }, // SW
    ]
    const densified = [
      { lat: 0.01, lon: -0.02 }, // NW
      { lat: 0.01, lon: 0.02 }, // NE
      { lat: -0.01, lon: 0.02 }, // SE
      // Extra collinear points along the south edge — same shape, denser trace.
      { lat: -0.01, lon: 0.01 },
      { lat: -0.01, lon: 0 },
      { lat: -0.01, lon: -0.01 },
      { lat: -0.01, lon: -0.02 }, // SW
    ]
    expect(suggestAzimuth(densified)).toBeCloseTo(suggestAzimuth(rectangle), 3)
    expect(suggestAzimuth(densified)).toBeCloseTo(180, 3)
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

  it('never returns negative zero for a due-north suggestion in the southern hemisphere (issue #94 item 1)', () => {
    // A wide (E-W) rectangle in the southern hemisphere suggests due
    // north (0deg) — see the test above. `Object.is(-0, 0)` is `false`
    // even though they're `===` and print identically, so a plain
    // `toBe(0)` alone wouldn't catch a `-0` regression here.
    const rectangle = [
      { lat: -30.01, lon: -0.02 },
      { lat: -30.01, lon: 0.02 },
      { lat: -30.03, lon: 0.02 },
      { lat: -30.03, lon: -0.02 },
    ]
    for (const polygon of allTracingOrders(rectangle)) {
      const azimuth = suggestAzimuth(polygon)
      expect(azimuth).toBe(0)
      expect(Object.is(azimuth, -0)).toBe(false)
    }
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
