import { describe, expect, it } from 'vitest'
import {
  buildPanelsGeometry,
  buildPlaneGeometry,
  computeBounds,
  liftToPlane,
  mergeBounds,
  offsetToSceneOrigin,
  translateVertices,
} from './geometryBuilders'
import { polygonToExtrusionGeometry } from '../derive'
import type { PanelPlacement } from '../derive'

describe('buildPlaneGeometry', () => {
  it('builds a geometry with one vertex per input point and a triangulated index', () => {
    const geometry = polygonToExtrusionGeometry(
      [
        { lat: 52.0, lon: 13.0 },
        { lat: 52.0001, lon: 13.0 },
        { lat: 52.0001, lon: 13.0002 },
        { lat: 52.0, lon: 13.0002 },
      ],
      30,
      180,
    )
    const buffer = buildPlaneGeometry(geometry.vertices)
    expect(buffer.getAttribute('position').count).toBe(4)
    // A convex quad triangulates into exactly 2 triangles (6 indices).
    expect(buffer.getIndex()?.count).toBe(6)
  })

  it('preserves the real (tilted) z values, not a flattened z=0 plane', () => {
    const geometry = polygonToExtrusionGeometry(
      [
        { lat: 52.0, lon: 13.0 },
        { lat: 52.001, lon: 13.0 },
        { lat: 52.001, lon: 13.002 },
        { lat: 52.0, lon: 13.002 },
      ],
      35,
      180,
    )
    const buffer = buildPlaneGeometry(geometry.vertices)
    const position = buffer.getAttribute('position')
    const zValues = geometry.vertices.map((_, i) => position.getZ(i))
    // At 35deg tilt, a shape this size should have real elevation spread.
    expect(Math.max(...zValues) - Math.min(...zValues)).toBeGreaterThan(0.1)
    zValues.forEach((z, i) => {
      // position is a Float32Array under the hood, so only float32 precision.
      expect(z).toBeCloseTo(geometry.vertices[i].z, 4)
    })
  })
})

describe('liftToPlane', () => {
  it('returns 0 at the origin regardless of tilt/azimuth', () => {
    expect(liftToPlane({ x: 0, y: 0 }, 40, 123)).toBeCloseTo(0, 9)
  })

  it('matches polygonToExtrusionGeometry z for the same (x, y)', () => {
    const geometry = polygonToExtrusionGeometry(
      [
        { lat: 52.0, lon: 13.0 },
        { lat: 52.0005, lon: 13.0 },
        { lat: 52.0005, lon: 13.001 },
        { lat: 52.0, lon: 13.001 },
      ],
      25,
      90,
    )
    for (const v of geometry.vertices) {
      expect(liftToPlane({ x: v.x, y: v.y }, 25, 90)).toBeCloseTo(v.z, 9)
    }
  })

  it('is flat (always 0) when tiltDeg is 0', () => {
    // tan(0) * -s can yield -0 rather than 0 depending on s's sign; both
    // are numerically "flat", so compare with a tolerant assertion.
    expect(liftToPlane({ x: 12, y: -7 }, 0, 200)).toBeCloseTo(0, 12)
  })
})

describe('buildPanelsGeometry', () => {
  const makePanel = (
    row: number,
    col: number,
    cx: number,
    cy: number,
  ): PanelPlacement => ({
    row,
    col,
    center: { x: cx, y: cy },
    corners: [
      { x: cx - 0.5, y: cy - 0.5 },
      { x: cx + 0.5, y: cy - 0.5 },
      { x: cx + 0.5, y: cy + 0.5 },
      { x: cx - 0.5, y: cy + 0.5 },
    ],
  })

  it('produces 8 vertices and 12 triangles (36 indices) per panel', () => {
    const panels = [makePanel(0, 0, 0, 0), makePanel(0, 1, 2, 0)]
    const buffer = buildPanelsGeometry(panels, 0, 180, { x: 0, y: 0, z: 1 })
    expect(buffer.getAttribute('position').count).toBe(8 * panels.length)
    expect(buffer.getIndex()?.count).toBe(36 * panels.length)
  })

  it('returns an empty geometry for zero panels', () => {
    const buffer = buildPanelsGeometry([], 10, 180, { x: 0, y: 0, z: 1 })
    expect(buffer.getAttribute('position').count).toBe(0)
    expect(buffer.getIndex()?.count).toBe(0)
  })

  it('offsets the bottom face from the top face along the surface normal', () => {
    const panels = [makePanel(0, 0, 0, 0)]
    const thickness = 0.1
    const buffer = buildPanelsGeometry(
      panels,
      0,
      180,
      { x: 0, y: 0, z: 1 },
      thickness,
    )
    const position = buffer.getAttribute('position')
    // Vertex 0 is a top corner, vertex 4 is the corresponding bottom corner.
    expect(position.getZ(0) - position.getZ(4)).toBeCloseTo(thickness, 6)
    expect(position.getX(0)).toBeCloseTo(position.getX(4), 9)
    expect(position.getY(0)).toBeCloseTo(position.getY(4), 9)
  })
})

describe('computeBounds / mergeBounds', () => {
  it('computes min/max over a set of points', () => {
    const bounds = computeBounds([
      { x: -1, y: 2, z: 0 },
      { x: 5, y: -3, z: 4 },
      { x: 0, y: 0, z: -2 },
    ])
    expect(bounds.min).toEqual({ x: -1, y: -3, z: -2 })
    expect(bounds.max).toEqual({ x: 5, y: 2, z: 4 })
  })

  it('merges multiple bounds into their union', () => {
    const merged = mergeBounds([
      { min: { x: -1, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      { min: { x: 0, y: -5, z: -1 }, max: { x: 2, y: 0, z: 0 } },
    ])
    expect(merged.min).toEqual({ x: -1, y: -5, z: -1 })
    expect(merged.max).toEqual({ x: 2, y: 1, z: 1 })
  })

  it('returns a degenerate zero bounds for an empty list', () => {
    expect(mergeBounds([])).toEqual({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
    })
  })
})

describe('offsetToSceneOrigin / translateVertices', () => {
  it('is zero when the shape origin equals the scene origin', () => {
    const origin = { lat: 52.5, lon: 13.4 }
    expect(offsetToSceneOrigin(origin, origin)).toEqual({ x: 0, y: 0 })
  })

  it('produces a non-zero eastward offset for a shape origin further east', () => {
    const sceneOrigin = { lat: 52.5, lon: 13.4 }
    const shapeOrigin = { lat: 52.5, lon: 13.401 }
    const offset = offsetToSceneOrigin(shapeOrigin, sceneOrigin)
    expect(offset.x).toBeGreaterThan(0)
    expect(offset.y).toBeCloseTo(0, 6)
  })

  it('translateVertices shifts x/y and leaves z untouched', () => {
    const translated = translateVertices(
      [
        { x: 0, y: 0, z: 5 },
        { x: 1, y: 2, z: -3 },
      ],
      { x: 10, y: -4 },
    )
    expect(translated).toEqual([
      { x: 10, y: -4, z: 5 },
      { x: 11, y: -2, z: -3 },
    ])
  })
})
