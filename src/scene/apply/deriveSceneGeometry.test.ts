import { describe, expect, it } from 'vitest'
import type { SceneDesignState } from '../flow/types'
import type { PanelPlacement } from '../derive'
import { deriveSceneGeometryFromScene } from './deriveSceneGeometry'

function makeState(
  overrides: Partial<SceneDesignState> = {},
): SceneDesignState {
  return {
    tracedShapes: [],
    hasInvalidTracedShapes: false,
    shapeConfigs: [],
    isShapeConfigValid: true,
    obstructions: [],
    panelLayouts: [],
    ...overrides,
  }
}

function panel(
  center: { x: number; y: number },
  row = 0,
  col = 0,
): PanelPlacement {
  return { row, col, center, corners: [center, center, center, center] }
}

/**
 * Fixture geometry, independently hand/script-computed (see the PR
 * description) against the exact same formulas `polygonToExtrusionGeometry`
 * and `offsetToSceneOrigin` implement, so this test is a real spot-check of
 * the derivation's wiring rather than a tautology against the production
 * code path itself.
 *
 * Shape A ("flat-roof"): a flat (tiltDeg: 0) 10m x 10m square centered at
 * (lat: 0, lon: 0) — flat, so its extruded vertices have z = 0 regardless
 * of azimuth, and it's listed first in `tracedShapes` so it becomes the
 * shared scene origin (offset (0, 0)).
 *
 * Shape B ("tilted-roof"): an 8m x 8m square, tiltDeg 30, azimuthDeg 90,
 * whose polygon is placed so its centroid lands exactly 20m east and 30m
 * north of shape A's origin.
 */
const SHAPE_A_POLYGON = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 0.00008993216059187306 },
  { lat: 0.00008993216059187306, lon: 0.00008993216059187306 },
  { lat: 0.00008993216059187306, lon: 0 },
]

const SHAPE_B_POLYGON = [
  { lat: 0.0002787896978348065, lon: 0.00018885753724298882 },
  { lat: 0.0002787896978348065, lon: 0.00026080326571648727 },
  { lat: 0.0003507354263083049, lon: 0.00026080326571648727 },
  { lat: 0.0003507354263083049, lon: 0.00018885753724298882 },
]

function makeTwoShapeState(
  overrides: Partial<SceneDesignState> = {},
): SceneDesignState {
  return makeState({
    tracedShapes: [
      { id: 'flat-roof', kind: 'roof-face', polygon: SHAPE_A_POLYGON },
      { id: 'tilted-roof', kind: 'roof-face', polygon: SHAPE_B_POLYGON },
    ],
    shapeConfigs: [
      { shapeId: 'flat-roof', tiltDeg: 0, azimuthDeg: 180 },
      { shapeId: 'tilted-roof', tiltDeg: 30, azimuthDeg: 90 },
    ],
    ...overrides,
  })
}

describe('deriveSceneGeometryFromScene', () => {
  it('derives correct per-shape vertex positions in one shared scene frame', () => {
    const geometry = deriveSceneGeometryFromScene(makeTwoShapeState())

    expect(geometry.shapes).toHaveLength(2)

    const flatRoof = geometry.shapes.find((s) => s.id === 'flat-roof')
    expect(flatRoof).toBeDefined()
    // Shape A is first, so it anchors the scene origin: offset (0, 0),
    // and (flat, tiltDeg 0) z = 0 at every vertex.
    const expectedFlat = [
      { x: -5, y: -5, z: 0 },
      { x: 5, y: -5, z: 0 },
      { x: 5, y: 5, z: 0 },
      { x: -5, y: 5, z: 0 },
    ]
    flatRoof!.vertices.forEach((v, i) => {
      expect(v.x).toBeCloseTo(expectedFlat[i].x, 6)
      expect(v.y).toBeCloseTo(expectedFlat[i].y, 6)
      expect(v.z).toBeCloseTo(expectedFlat[i].z, 6)
    })

    const tiltedRoof = geometry.shapes.find((s) => s.id === 'tilted-roof')
    expect(tiltedRoof).toBeDefined()
    // Independently computed: 8m square tilted 30deg facing azimuth 90
    // (east), translated by the (20, 30) offset to shape A's origin.
    const expectedTilted = [
      { x: 16, y: 26, z: 2.3094010767236544 },
      { x: 24, y: 26, z: -2.3094010767236544 },
      { x: 24, y: 34, z: -2.3094010767236544 },
      { x: 16, y: 34, z: 2.3094010767236544 },
    ]
    tiltedRoof!.vertices.forEach((v, i) => {
      expect(v.x).toBeCloseTo(expectedTilted[i].x, 4)
      expect(v.y).toBeCloseTo(expectedTilted[i].y, 4)
      expect(v.z).toBeCloseTo(expectedTilted[i].z, 4)
    })
  })

  it('passes obstructions through directly (already in the shared scene frame)', () => {
    const state = makeTwoShapeState({
      obstructions: [
        {
          id: 'o1',
          kind: 'tree',
          position: { x: 3, y: -2 },
          heightM: 6,
          radiusM: 1.5,
        },
        {
          id: 'o2',
          kind: 'building',
          position: { x: -10, y: 12 },
          heightM: 8,
          radiusM: 4,
        },
      ],
    })

    const geometry = deriveSceneGeometryFromScene(state)

    expect(geometry.obstructions).toEqual([
      { kind: 'tree', position: { x: 3, y: -2 }, heightM: 6, radiusM: 1.5 },
      { kind: 'building', position: { x: -10, y: 12 }, heightM: 8, radiusM: 4 },
    ])
  })

  it('derives per-panel 3D positions, correctly keyed by shapeId, matching panelLayouts counts', () => {
    const state = makeTwoShapeState({
      panelLayouts: [
        {
          shapeId: 'flat-roof',
          panelCount: 1,
          panels: [panel({ x: 0, y: 0 })],
        },
        {
          shapeId: 'tilted-roof',
          panelCount: 1,
          panels: [panel({ x: 2, y: 2 })],
        },
      ],
    })

    const geometry = deriveSceneGeometryFromScene(state)

    expect(geometry.panels).toHaveLength(2)

    const flatPanel = geometry.panels.find((p) => p.shapeId === 'flat-roof')
    expect(flatPanel).toBeDefined()
    // Flat shape, offset (0,0), center (0,0) -> position exactly the origin.
    expect(flatPanel!.position.x).toBeCloseTo(0, 6)
    expect(flatPanel!.position.y).toBeCloseTo(0, 6)
    expect(flatPanel!.position.z).toBeCloseTo(0, 6)

    const tiltedPanel = geometry.panels.find((p) => p.shapeId === 'tilted-roof')
    expect(tiltedPanel).toBeDefined()
    // center (2,2) on a tiltDeg 30 / azimuth 90 plane: z = -(2*sin90 +
    // 2*cos90) * tan(30) = -2 * tan(30); translated by the (20, 30) offset.
    expect(tiltedPanel!.position.x).toBeCloseTo(22, 4)
    expect(tiltedPanel!.position.y).toBeCloseTo(32, 4)
    expect(tiltedPanel!.position.z).toBeCloseTo(
      -2 * Math.tan((30 * Math.PI) / 180),
      4,
    )
  })

  it('matches the total panel count across all shapes to the sum of panelLayouts panel counts', () => {
    const state = makeTwoShapeState({
      panelLayouts: [
        {
          shapeId: 'flat-roof',
          panelCount: 2,
          panels: [panel({ x: -1, y: 0 }, 0, 0), panel({ x: 1, y: 0 }, 0, 1)],
        },
        {
          shapeId: 'tilted-roof',
          panelCount: 3,
          panels: [
            panel({ x: -1, y: -1 }, 0, 0),
            panel({ x: 0, y: 0 }, 0, 1),
            panel({ x: 1, y: 1 }, 0, 2),
          ],
        },
      ],
    })

    const geometry = deriveSceneGeometryFromScene(state)

    expect(geometry.panels).toHaveLength(5)
    expect(
      geometry.panels.filter((p) => p.shapeId === 'flat-roof'),
    ).toHaveLength(2)
    expect(
      geometry.panels.filter((p) => p.shapeId === 'tilted-roof'),
    ).toHaveLength(3)
  })

  it('skips a panelLayouts entry whose shapeId has no resolvable shape geometry', () => {
    const state = makeTwoShapeState({
      panelLayouts: [
        {
          shapeId: 'flat-roof',
          panelCount: 1,
          panels: [panel({ x: 0, y: 0 })],
        },
        {
          shapeId: 'nonexistent-shape',
          panelCount: 1,
          panels: [panel({ x: 0, y: 0 })],
        },
      ],
    })

    const geometry = deriveSceneGeometryFromScene(state)

    expect(geometry.panels).toHaveLength(1)
    expect(geometry.panels[0].shapeId).toBe('flat-roof')
  })

  it('skips a traced shape with no matching shapeConfigs entry, same as deriveSystemConfigFromScene', () => {
    const state = makeTwoShapeState({
      tracedShapes: [
        { id: 'flat-roof', kind: 'roof-face', polygon: SHAPE_A_POLYGON },
        { id: 'unconfigured', kind: 'roof-face', polygon: SHAPE_B_POLYGON },
      ],
      shapeConfigs: [{ shapeId: 'flat-roof', tiltDeg: 0, azimuthDeg: 180 }],
    })

    const geometry = deriveSceneGeometryFromScene(state)

    expect(geometry.shapes).toHaveLength(1)
    expect(geometry.shapes[0].id).toBe('flat-roof')
  })

  it('produces a sensible empty SceneGeometry for a scene with no traced shapes', () => {
    const geometry = deriveSceneGeometryFromScene(makeState())

    expect(geometry).toEqual({ shapes: [], obstructions: [], panels: [] })
  })

  it('produces an empty SceneGeometry (aside from obstructions) for a scene with only obstructions placed', () => {
    const state = makeState({
      obstructions: [
        {
          id: 'o1',
          kind: 'tree',
          position: { x: 1, y: 1 },
          heightM: 5,
          radiusM: 1.5,
        },
      ],
    })

    const geometry = deriveSceneGeometryFromScene(state)

    expect(geometry.shapes).toEqual([])
    expect(geometry.panels).toEqual([])
    expect(geometry.obstructions).toEqual([
      { kind: 'tree', position: { x: 1, y: 1 }, heightM: 5, radiusM: 1.5 },
    ])
  })
})
