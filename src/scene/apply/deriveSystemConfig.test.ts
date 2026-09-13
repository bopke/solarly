import { describe, expect, it } from 'vitest'
import type { PanelPreset } from '../../panel-presets'
import type { SceneDesignState } from '../flow/types'
import {
  DEFAULT_SCENE_MANUAL_SHADING_PERCENT,
  DEFAULT_SCENE_SYSTEM_LOSSES_PERCENT,
  deriveSystemConfigFromScene,
} from './deriveSystemConfig'

const PRESET: PanelPreset = {
  id: 'test-preset',
  make: 'Test',
  model: 'Panel',
  ratedWattsPeak: 450,
  efficiencyPercent: 21.5,
  widthMm: 1100,
  heightMm: 1900,
  areaM2: 2.09,
  tempCoefficientPercentPerC: -0.3,
  isGeneric: false,
  notes: '',
}

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

describe('deriveSystemConfigFromScene', () => {
  it('produces one PanelArrayConfig per traced shape, using each shape config and panel layout', () => {
    const state = makeState({
      tracedShapes: [
        { id: 'shape-1', kind: 'roof-face', polygon: [] },
        { id: 'shape-2', kind: 'ground-array', polygon: [] },
      ],
      shapeConfigs: [
        { shapeId: 'shape-1', tiltDeg: 30, azimuthDeg: 180 },
        { shapeId: 'shape-2', tiltDeg: 20, azimuthDeg: 190 },
      ],
      panelLayouts: [
        { shapeId: 'shape-1', panelCount: 18, panels: [] },
        { shapeId: 'shape-2', panelCount: 24, panels: [] },
      ],
    })

    const config = deriveSystemConfigFromScene(state, { panelPreset: PRESET })

    expect(config.arrays).toEqual([
      {
        tiltDeg: 30,
        azimuthDeg: 180,
        panelCount: 18,
        wattsPerPanel: 450,
        efficiencyPercent: 21.5,
        tempCoefficientPercentPerC: -0.3,
        manualShadingPercent: 0,
      },
      {
        tiltDeg: 20,
        azimuthDeg: 190,
        panelCount: 24,
        wattsPerPanel: 450,
        efficiencyPercent: 21.5,
        tempCoefficientPercentPerC: -0.3,
        manualShadingPercent: 0,
      },
    ])
  })

  it('defaults manualShadingPercent to 0 (M2 does not compute real shading — that is M3)', () => {
    const state = makeState({
      tracedShapes: [{ id: 's1', kind: 'roof-face', polygon: [] }],
      shapeConfigs: [{ shapeId: 's1', tiltDeg: 30, azimuthDeg: 180 }],
      panelLayouts: [{ shapeId: 's1', panelCount: 10, panels: [] }],
    })

    const config = deriveSystemConfigFromScene(state, { panelPreset: PRESET })

    expect(config.arrays[0].manualShadingPercent).toBe(
      DEFAULT_SCENE_MANUAL_SHADING_PERCENT,
    )
    expect(DEFAULT_SCENE_MANUAL_SHADING_PERCENT).toBe(0)
  })

  it('defaults systemLossesPercent when not provided, and honors an explicit override', () => {
    const state = makeState({
      tracedShapes: [{ id: 's1', kind: 'roof-face', polygon: [] }],
      shapeConfigs: [{ shapeId: 's1', tiltDeg: 30, azimuthDeg: 180 }],
      panelLayouts: [{ shapeId: 's1', panelCount: 10, panels: [] }],
    })

    expect(
      deriveSystemConfigFromScene(state, { panelPreset: PRESET })
        .systemLossesPercent,
    ).toBe(DEFAULT_SCENE_SYSTEM_LOSSES_PERCENT)

    expect(
      deriveSystemConfigFromScene(state, {
        panelPreset: PRESET,
        systemLossesPercent: 9,
      }).systemLossesPercent,
    ).toBe(9)
  })

  it('honors an explicit manualShadingPercent override applied to every array', () => {
    const state = makeState({
      tracedShapes: [
        { id: 's1', kind: 'roof-face', polygon: [] },
        { id: 's2', kind: 'roof-face', polygon: [] },
      ],
      shapeConfigs: [
        { shapeId: 's1', tiltDeg: 30, azimuthDeg: 180 },
        { shapeId: 's2', tiltDeg: 35, azimuthDeg: 170 },
      ],
      panelLayouts: [
        { shapeId: 's1', panelCount: 10, panels: [] },
        { shapeId: 's2', panelCount: 5, panels: [] },
      ],
    })

    const config = deriveSystemConfigFromScene(state, {
      panelPreset: PRESET,
      manualShadingPercent: 12,
    })

    expect(config.arrays.map((a) => a.manualShadingPercent)).toEqual([12, 12])
  })

  it('skips a traced shape with no matching shapeConfigs entry', () => {
    const state = makeState({
      tracedShapes: [
        { id: 's1', kind: 'roof-face', polygon: [] },
        { id: 's2', kind: 'roof-face', polygon: [] },
      ],
      shapeConfigs: [{ shapeId: 's1', tiltDeg: 30, azimuthDeg: 180 }],
      panelLayouts: [
        { shapeId: 's1', panelCount: 10, panels: [] },
        { shapeId: 's2', panelCount: 6, panels: [] },
      ],
    })

    const config = deriveSystemConfigFromScene(state, { panelPreset: PRESET })

    expect(config.arrays).toHaveLength(1)
    expect(config.arrays[0].panelCount).toBe(10)
  })

  it('produces panelCount: 0 for a configured shape with no panel-layout entry, rather than dropping it', () => {
    const state = makeState({
      tracedShapes: [{ id: 's1', kind: 'roof-face', polygon: [] }],
      shapeConfigs: [{ shapeId: 's1', tiltDeg: 30, azimuthDeg: 180 }],
      panelLayouts: [],
    })

    const config = deriveSystemConfigFromScene(state, { panelPreset: PRESET })

    expect(config.arrays).toHaveLength(1)
    expect(config.arrays[0].panelCount).toBe(0)
    expect(config.arrays[0].tiltDeg).toBe(30)
  })

  it('produces an empty arrays list for a scene with no traced shapes', () => {
    const config = deriveSystemConfigFromScene(makeState(), {
      panelPreset: PRESET,
    })
    expect(config.arrays).toEqual([])
  })

  // Issue #78: `shapeId` correlates a derived array with the matching
  // `SceneGeometry.shapes`/`panels` entry from `deriveSceneGeometryFromScene`
  // — see `PanelArrayConfig.shapeId`'s doc comment.
  const SQUARE = [
    { lat: 52.5, lon: 13.4 },
    { lat: 52.5005, lon: 13.4 },
    { lat: 52.5005, lon: 13.4005 },
    { lat: 52.5, lon: 13.4005 },
  ]

  it('populates shapeId with the traced shape id when its geometry is resolvable', () => {
    const state = makeState({
      tracedShapes: [{ id: 'shape-1', kind: 'roof-face', polygon: SQUARE }],
      shapeConfigs: [{ shapeId: 'shape-1', tiltDeg: 30, azimuthDeg: 180 }],
      panelLayouts: [{ shapeId: 'shape-1', panelCount: 10, panels: [] }],
    })

    const config = deriveSystemConfigFromScene(state, { panelPreset: PRESET })

    expect(config.arrays[0].shapeId).toBe('shape-1')
  })

  it('leaves shapeId undefined for a configured shape whose polygon cannot produce valid geometry (matching deriveSceneGeometryFromScene’s own skip condition, per PR #82 review)', () => {
    // An empty polygon is a config attached to a shape that isn't
    // geometrizable — `deriveSceneGeometryFromScene` would skip it
    // entirely, so this array must not carry a `shapeId` that
    // `SceneGeometry.shapes` will never contain: it should instead fall
    // back to the pre-M3 `manualShadingPercent` flat-derate path
    // (see `resolveArrayScenePanels`), same as before this field existed —
    // rather than the array vanishing (this function's own
    // shape-inclusion condition is looser than the geometry one, see this
    // function's doc comment) or silently carrying a dangling id.
    const state = makeState({
      tracedShapes: [{ id: 's1', kind: 'roof-face', polygon: [] }],
      shapeConfigs: [{ shapeId: 's1', tiltDeg: 30, azimuthDeg: 180 }],
      panelLayouts: [{ shapeId: 's1', panelCount: 10, panels: [] }],
    })

    const config = deriveSystemConfigFromScene(state, { panelPreset: PRESET })

    expect(config.arrays).toHaveLength(1)
    expect(config.arrays[0].shapeId).toBeUndefined()
  })
})
