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
import type { PanelPlacement, Vec3 } from '../derive'

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

  it('produces 8 vertices and 12 triangles (36 indices) per panel at a non-zero tilt too (issue #85 item 6)', () => {
    // The vertex/index counts are tilt-independent, but this was
    // previously only ever exercised at `tiltDeg: 0` — the exact case
    // that let the panel/roof z-fighting bug through undetected (see the
    // dedicated regression test below).
    const tiltDeg = 28
    const azimuthDeg = 95
    const tiltRad = (tiltDeg * Math.PI) / 180
    const azimuthRad = (azimuthDeg * Math.PI) / 180
    const slope = { x: Math.sin(azimuthRad), y: Math.cos(azimuthRad) }
    const normal = {
      x: Math.sin(tiltRad) * slope.x,
      y: Math.sin(tiltRad) * slope.y,
      z: Math.cos(tiltRad),
    }
    const panels = [makePanel(0, 0, 1, -1), makePanel(0, 1, 3, -1)]
    const buffer = buildPanelsGeometry(panels, tiltDeg, azimuthDeg, normal)
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

  it('at a non-zero tilt, sits the bottom face on the roof plane and lifts the top face above it (regression: z-fighting)', () => {
    // Reproduces the PR #68 review finding: at tilt=0 with normal (0,0,1)
    // the box's "up" axis and the roof's flat plane are indistinguishable,
    // so a bug that makes the visible top face coplanar with the roof
    // (rather than offset above it) doesn't show up in that case. A
    // meaningfully tilted plane (35deg here) is required to catch it.
    const tiltDeg = 35
    const azimuthDeg = 200
    const tiltRad = (tiltDeg * Math.PI) / 180
    const azimuthRad = (azimuthDeg * Math.PI) / 180
    // Mirrors polygonToExtrusionGeometry's own normal formula.
    const slope = { x: Math.sin(azimuthRad), y: Math.cos(azimuthRad) }
    const normal = {
      x: Math.sin(tiltRad) * slope.x,
      y: Math.sin(tiltRad) * slope.y,
      z: Math.cos(tiltRad),
    }

    const panels = [makePanel(0, 0, 3, -2)]
    const thickness = 0.04
    const buffer = buildPanelsGeometry(
      panels,
      tiltDeg,
      azimuthDeg,
      normal,
      thickness,
    )
    const position = buffer.getAttribute('position')

    for (let i = 0; i < 4; i++) {
      const topX = position.getX(i)
      const topY = position.getY(i)
      const topZ = position.getZ(i)
      const bottomX = position.getX(i + 4)
      const bottomY = position.getY(i + 4)
      const bottomZ = position.getZ(i + 4)

      // The bottom face corner must land exactly on the tilted roof plane
      // (this is the box face that should be coplanar with the roof).
      expect(bottomZ).toBeCloseTo(
        liftToPlane({ x: bottomX, y: bottomY }, tiltDeg, azimuthDeg),
        6,
      )

      // The top face corner must be offset from the bottom (roof-plane)
      // corner by exactly `thickness` along the surface normal, not
      // embedded into the roof and not merely coplanar with it.
      expect(topX).toBeCloseTo(bottomX + normal.x * thickness, 6)
      expect(topY).toBeCloseTo(bottomY + normal.y * thickness, 6)
      expect(topZ).toBeCloseTo(bottomZ + normal.z * thickness, 6)

      // At this non-zero tilt, the top face must be measurably displaced
      // from the roof plane along the normal — i.e. NOT coplanar with it
      // (the actual bug: previously this deviation was ~0, floating-point
      // zero, causing z-fighting against the roof mesh).
      const roofZAtTop = liftToPlane({ x: topX, y: topY }, tiltDeg, azimuthDeg)
      expect(Math.abs(topZ - roofZAtTop)).toBeGreaterThan(thickness * 0.5)
    }
  })
})

describe('panel on-slope oversizing (issue #85 item 1, known & documented limitation)', () => {
  it('renders a panel measurably larger on-slope than its true physical size at a real tilt', () => {
    // Mirrors the issue's own measured example: a generic residential
    // panel (1.134m x 1.722m) on a 35deg-tilted, south-facing plane.
    // `panelAutoFillGrid`/`buildPanelsGeometry`'s module docs explain why
    // this is a deliberately deferred limitation rather than a bug fixed
    // here — this test exists to keep the *magnitude* pinned down rather
    // than let it silently drift, and to prove the limitation is real
    // (not just a hypothetical worst case).
    const tiltDeg = 35
    const azimuthDeg = 180
    const physicalWidthM = 1.134
    const physicalHeightM = 1.722
    const tiltRad = (tiltDeg * Math.PI) / 180
    const azimuthRad = (azimuthDeg * Math.PI) / 180
    const slope = { x: Math.sin(azimuthRad), y: Math.cos(azimuthRad) }
    const normal = {
      x: Math.sin(tiltRad) * slope.x,
      y: Math.sin(tiltRad) * slope.y,
      z: Math.cos(tiltRad),
    }

    const panel: PanelPlacement = {
      row: 0,
      col: 0,
      center: { x: 0, y: 0 },
      corners: [
        { x: -physicalWidthM / 2, y: -physicalHeightM / 2 },
        { x: physicalWidthM / 2, y: -physicalHeightM / 2 },
        { x: physicalWidthM / 2, y: physicalHeightM / 2 },
        { x: -physicalWidthM / 2, y: physicalHeightM / 2 },
      ],
    }

    const buffer = buildPanelsGeometry([panel], tiltDeg, azimuthDeg, normal)
    const position = buffer.getAttribute('position')
    // Bottom-face corners (indices 4-7) sit on the tilted roof plane —
    // see `buildPanelsGeometry`'s doc for the top(0-3)/bottom(4-7) layout.
    const corner = (i: number) => ({
      x: position.getX(i),
      y: position.getY(i),
      z: position.getZ(i),
    })
    const distance3D = (a: Vec3, b: Vec3) =>
      Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

    // Edge from bottom-corner 4 (min x, min y) to bottom-corner 7 (min x,
    // max y) is the slope-parallel (north-south, matching azimuth 180)
    // edge — the one foreshortening/lifting distorts.
    const renderedHeightM = distance3D(corner(4), corner(7))
    // The cross-slope edge (4 -> 5) is unaffected by tilt.
    const renderedWidthM = distance3D(corner(4), corner(5))

    expect(renderedWidthM).toBeCloseTo(physicalWidthM, 6)
    expect(renderedHeightM).toBeGreaterThan(physicalHeightM)
    // Pin the known ~22% (issue #85's measured figure) magnitude down
    // rather than any regression: currently way oversized, not roughly
    // correct.
    const oversizeRatio = renderedHeightM / physicalHeightM
    expect(oversizeRatio).toBeGreaterThan(1.1)
    expect(oversizeRatio).toBeLessThan(1.3)
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
    // A bare `offset.x > 0` assertion would still pass even if the
    // `cos(lat)` meridian-convergence factor were accidentally dropped
    // (issue #85 item 6) — it would just make `offset.x` too large, not
    // negative. Assert the actual expected magnitude instead, computed
    // independently here (not by re-deriving it via `offsetToSceneOrigin`
    // or `toLocalMeters` itself, which would make this tautological).
    const EARTH_RADIUS_M = 6371000
    const expectedX =
      ((0.001 * Math.PI) / 180) *
      Math.cos((52.5 * Math.PI) / 180) *
      EARTH_RADIUS_M
    expect(offset.x).toBeCloseTo(expectedX, 3)
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
