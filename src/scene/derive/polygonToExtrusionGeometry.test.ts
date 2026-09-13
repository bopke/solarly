import { describe, expect, it } from 'vitest'
import { polygonToExtrusionGeometry } from './polygonToExtrusionGeometry'

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

  it('tilting preserves area (a rigid rotation) at tilt=30, azimuth=180', () => {
    const geometry = polygonToExtrusionGeometry(SQUARE_20M, 30, 180)
    expect(geometry.areaM2).toBeCloseTo(400, 1)

    // Reconstruct the tilted plane's own area from its 3D vertices via the
    // shoelace formula projected onto the plane (equivalently: the
    // polygon is planar and congruent to the flat footprint, so summing
    // 3D edge cross products and taking the magnitude gives the true
    // surface area — a simpler equivalent check here is that every edge
    // length matches the flat footprint's edge lengths, since a rigid
    // rotation preserves distances).
    const flat = polygonToExtrusionGeometry(SQUARE_20M, 0)
    for (let i = 0; i < geometry.vertices.length; i++) {
      const a = geometry.vertices[i]
      const b = geometry.vertices[(i + 1) % geometry.vertices.length]
      const flatA = flat.vertices[i]
      const flatB = flat.vertices[(i + 1) % flat.vertices.length]
      const tiltedEdgeLength = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
      const flatEdgeLength = Math.hypot(
        flatB.x - flatA.x,
        flatB.y - flatA.y,
        flatB.z - flatA.z,
      )
      expect(tiltedEdgeLength).toBeCloseTo(flatEdgeLength, 3)
    }
  })

  it('the surface normal is always a unit vector', () => {
    for (const [tilt, azimuth] of [
      [0, 0],
      [15, 45],
      [30, 180],
      [45, 270],
      [90, 90],
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

  it('tilt=90 (a vertical wall) facing south (azimuth=180): normal is horizontal, pointing south', () => {
    const geometry = polygonToExtrusionGeometry(SQUARE_20M, 90, 180)
    expect(geometry.normal.x).toBeCloseTo(0, 6)
    expect(geometry.normal.y).toBeCloseTo(-1, 6)
    expect(geometry.normal.z).toBeCloseTo(0, 6)

    // For a 90-degree hinge about the centroid, the southmost point of the
    // flat 20m square (10m south of centroid) ends up raised to z ~= 10m,
    // and the northmost point (10m north of centroid) ends up at z ~= -10m
    // (a hand-checkable consequence of the hinge-rotation formula: z = s *
    // sin(tilt), where s is the point's coordinate along the south-facing
    // slope direction, and sin(90deg) = 1).
    const zValues = geometry.vertices.map((v) => v.z).sort((a, b) => a - b)
    expect(zValues[0]).toBeCloseTo(-10, 1)
    expect(zValues[zValues.length - 1]).toBeCloseTo(10, 1)
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
