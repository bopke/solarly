import { describe, expect, it } from 'vitest'
import { polygonToExtrusionGeometry } from './polygonToExtrusionGeometry'
import type { Vec3 } from './polygonToExtrusionGeometry'

/**
 * The square polygon below is constructed the same way as the module's
 * own `toLocalMeters` projection (equirectangular, centered on the
 * square's own centroid at lat=45, lon=10), by hand, so it projects back
 * to an (almost exactly, up to floating point) 20m x 20m square centered
 * at the local origin — see the inline derivation in each corner's
 * comment. This gives hand-checkable expected values for area and the
 * tilted-plane normal at specific tilt/azimuth combinations, rather than
 * just re-testing the implementation against itself.
 */
const SQUARE_20M: { lat: number; lon: number }[] = [
  { lat: 44.99991006783941, lon: 9.999872816718797 }, // SW
  { lat: 44.99991006783941, lon: 10.000127183281203 }, // SE
  { lat: 45.00008993216059, lon: 10.000127183281203 }, // NE
  { lat: 45.00008993216059, lon: 9.999872816718797 }, // NW
]

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function normalize(v: Vec3): Vec3 {
  const magnitude = Math.hypot(v.x, v.y, v.z)
  return { x: v.x / magnitude, y: v.y / magnitude, z: v.z / magnitude }
}

/**
 * Cross-checks the returned `normal` against a normal computed
 * independently from the returned `vertices`' own edges (via the first
 * two edges' cross product) — see issue #1 in the PR #64 review: the
 * `normal` and `vertices` previously described two different planes,
 * off by an exact 180-degree horizontal flip, and no existing test
 * caught it because every test checked `normal` and `vertices` in
 * isolation rather than their relationship.
 */
function geometricNormalFromVertices(vertices: Vec3[]): Vec3 {
  const edge1 = subtract(vertices[1], vertices[0])
  const edge2 = subtract(vertices[2], vertices[1])
  return normalize(cross(edge1, edge2))
}

describe('polygonToExtrusionGeometry', () => {
  it('rejects a degenerate polygon (fewer than 3 vertices)', () => {
    expect(() =>
      polygonToExtrusionGeometry(
        [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 1 },
        ],
        0,
      ),
    ).toThrow()
  })

  it('rejects tiltDeg outside [0, 90) — a vertical surface has no well-defined plan-view footprint', () => {
    expect(() => polygonToExtrusionGeometry(SQUARE_20M, 90)).toThrow()
    expect(() => polygonToExtrusionGeometry(SQUARE_20M, 91)).toThrow()
    expect(() => polygonToExtrusionGeometry(SQUARE_20M, -1)).toThrow()
  })

  it('tilt=0 produces a flat plane: all z=0, normal straight up, area = the square footprint (400m^2)', () => {
    const geometry = polygonToExtrusionGeometry(SQUARE_20M, 0)
    for (const v of geometry.vertices) {
      expect(v.z).toBeCloseTo(0, 6)
    }
    expect(geometry.normal.x).toBeCloseTo(0, 9)
    expect(geometry.normal.y).toBeCloseTo(0, 9)
    expect(geometry.normal.z).toBeCloseTo(1, 9)
    expect(geometry.areaM2).toBeCloseTo(400, 1)
  })

  it('the returned normal always agrees with the plane the returned vertices actually describe', () => {
    // Direct regression test for PR #64 review issue #1: cross-product the
    // returned vertices' own edges and confirm it matches the returned
    // `normal`, across several tilt/azimuth combinations (not just the
    // degenerate tilt=90 case, which is excluded now — see the
    // `tiltDeg` range test above — because it made the flip invisible).
    for (const [tilt, azimuth] of [
      [30, 180],
      [30, 0],
      [45, 90],
      [20, 200],
      [60, 45],
    ]) {
      const geometry = polygonToExtrusionGeometry(SQUARE_20M, tilt, azimuth)
      const geometricNormal = geometricNormalFromVertices(geometry.vertices)
      expect(geometricNormal.x).toBeCloseTo(geometry.normal.x, 6)
      expect(geometricNormal.y).toBeCloseTo(geometry.normal.y, 6)
      expect(geometricNormal.z).toBeCloseTo(geometry.normal.z, 6)
    }
  })

  it('a south-facing surface (azimuth=180) slopes down toward the south: southern vertices are lower', () => {
    // The ridge (high side) of a south-facing roof is on its north side.
    const geometry = polygonToExtrusionGeometry(SQUARE_20M, 30, 180)
    const southZ = geometry.vertices
      .filter((_, i) => SQUARE_20M[i].lat < 45)
      .map((v) => v.z)
    const northZ = geometry.vertices
      .filter((_, i) => SQUARE_20M[i].lat > 45)
      .map((v) => v.z)
    for (const z of southZ) {
      for (const northVal of northZ) {
        expect(z).toBeLessThan(northVal)
      }
    }
  })

  it('projecting the tilted vertices back to the xy-plane (dropping z) recovers the original plan-view polygon', () => {
    // The traced polygon is a plan-view footprint (see module doc); the
    // tilted "true surface" vertices must project straight back down onto
    // it, or the rendered roof won't register with the traced outline /
    // satellite imagery it came from.
    const flat = polygonToExtrusionGeometry(SQUARE_20M, 0)
    for (const [tilt, azimuth] of [
      [10, 0],
      [30, 180],
      [45, 90],
      [70, 315],
    ]) {
      const geometry = polygonToExtrusionGeometry(SQUARE_20M, tilt, azimuth)
      for (let i = 0; i < geometry.vertices.length; i++) {
        expect(geometry.vertices[i].x).toBeCloseTo(flat.vertices[i].x, 6)
        expect(geometry.vertices[i].y).toBeCloseTo(flat.vertices[i].y, 6)
      }
    }
  })

  it('areaM2 is the true on-slope surface area: plan-view area divided by cos(tiltDeg)', () => {
    // A 20m x 20m plan-view trace at 40 degrees tilt covers a larger true
    // roof area than its plan-view (satellite-trace) footprint.
    const flat = polygonToExtrusionGeometry(SQUARE_20M, 0)
    const tilted = polygonToExtrusionGeometry(SQUARE_20M, 40, 180)
    const expectedAreaM2 = flat.areaM2 / Math.cos((40 * Math.PI) / 180)
    expect(tilted.areaM2).toBeCloseTo(expectedAreaM2, 3)
    expect(tilted.areaM2).toBeGreaterThan(flat.areaM2)
    expect(tilted.areaM2).toBeCloseTo(400 / Math.cos((40 * Math.PI) / 180), 1)
  })

  it('the surface normal is always a unit vector', () => {
    for (const [tilt, azimuth] of [
      [0, 0],
      [15, 45],
      [30, 180],
      [45, 270],
      [80, 90],
    ]) {
      const geometry = polygonToExtrusionGeometry(SQUARE_20M, tilt, azimuth)
      const magnitude = Math.hypot(
        geometry.normal.x,
        geometry.normal.y,
        geometry.normal.z,
      )
      expect(magnitude).toBeCloseTo(1, 9)
    }
  })

  it('tilt=45 facing east (azimuth=90): normal points east and up in equal measure', () => {
    const geometry = polygonToExtrusionGeometry(SQUARE_20M, 45, 90)
    expect(geometry.normal.x).toBeCloseTo(Math.SQRT1_2, 6)
    expect(geometry.normal.y).toBeCloseTo(0, 6)
    expect(geometry.normal.z).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('defaults azimuth to 180 (south) when not given', () => {
    const withDefault = polygonToExtrusionGeometry(SQUARE_20M, 30)
    const explicit = polygonToExtrusionGeometry(SQUARE_20M, 30, 180)
    expect(withDefault).toEqual(explicit)
  })

  it('is a pure function: repeated calls with the same inputs return the same result', () => {
    const first = polygonToExtrusionGeometry(SQUARE_20M, 20, 200)
    const second = polygonToExtrusionGeometry(SQUARE_20M, 20, 200)
    expect(second).toEqual(first)
  })
})
