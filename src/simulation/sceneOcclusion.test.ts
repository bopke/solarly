import { describe, expect, it, vi } from 'vitest'
import { panelPowerOutput, poaIrradiance } from '../solar-physics/index.ts'
import { sunAltitudeAzimuthToEnuDirection } from '../solar-physics/index.ts'
import type { PanelSpec } from '../solar-physics/index.ts'
import {
  computeArrayPowerWithOcclusion,
  resolveArrayScenePanels,
} from './sceneOcclusion.ts'
import type { PanelArrayConfig, SceneGeometry } from './types.ts'

/**
 * Sun at 30deg altitude, due south (azimuth 180) — a moderate,
 * hand-verifiable angle: `tan(30deg) ~= 0.577`, so a ray from a panel at
 * the origin toward the sun passes through z = 0.577 * (distance south)
 * as it crosses due south of the panel. Used to size fixture obstacles
 * below so the intersection math is easy to hand-check.
 */
const SUN_ALTITUDE_DEG = 30
const SUN_AZIMUTH_DEG = 180
const SUN_DIRECTION = sunAltitudeAzimuthToEnuDirection(
  SUN_ALTITUDE_DEG,
  SUN_AZIMUTH_DEG,
)
const SUN = {
  altitudeDeg: SUN_ALTITUDE_DEG,
  azimuthDeg: SUN_AZIMUTH_DEG,
  direction: SUN_DIRECTION,
}

const HORIZONTAL_IRRADIANCE = { directWm2: 800, diffuseWm2: 120 }
const AMBIENT_TEMP_C = 25
const LOSSES_PERCENT = 14

const PANEL_ARRAY: PanelArrayConfig = {
  tiltDeg: 0,
  azimuthDeg: 180,
  panelCount: 1,
  wattsPerPanel: 400,
  efficiencyPercent: 21,
  tempCoefficientPercentPerC: -0.3,
  manualShadingPercent: 0,
  shapeId: 'roof',
}

/** A flat, roughly-square roof footprint at z=0 — content is irrelevant to every test here (a shape never occludes its own panels), just a valid (>=3 vertex) polygon. */
const ROOF_VERTICES = [
  { x: -3, y: -3, z: 0 },
  { x: 3, y: -3, z: 0 },
  { x: 3, y: 3, z: 0 },
  { x: -3, y: 3, z: 0 },
]

describe('resolveArrayScenePanels', () => {
  it('returns undefined when no sceneGeometry is supplied', () => {
    expect(resolveArrayScenePanels(PANEL_ARRAY, undefined)).toBeUndefined()
  })

  it('returns undefined when the array has no shapeId (the manual form path)', () => {
    const arrayWithoutShapeId: PanelArrayConfig = { ...PANEL_ARRAY }
    delete arrayWithoutShapeId.shapeId
    const sceneGeometry: SceneGeometry = {
      shapes: [{ id: 'roof', vertices: ROOF_VERTICES }],
      obstructions: [],
      panels: [{ shapeId: 'roof', position: { x: 0, y: 0, z: 1 } }],
    }
    expect(
      resolveArrayScenePanels(arrayWithoutShapeId, sceneGeometry),
    ).toBeUndefined()
  })

  it("returns undefined when the array's shapeId has no matching SceneGeometry.shapes entry", () => {
    const sceneGeometry: SceneGeometry = {
      shapes: [{ id: 'some-other-shape', vertices: ROOF_VERTICES }],
      obstructions: [],
      panels: [],
    }
    expect(resolveArrayScenePanels(PANEL_ARRAY, sceneGeometry)).toBeUndefined()
  })

  it('resolves the matching panels and excludes the array’s own shape from the obstacle list', () => {
    const sceneGeometry: SceneGeometry = {
      shapes: [
        { id: 'roof', vertices: ROOF_VERTICES },
        { id: 'other-roof', vertices: ROOF_VERTICES },
      ],
      obstructions: [
        { kind: 'tree', position: { x: 5, y: 5 }, heightM: 4, radiusM: 1.5 },
      ],
      panels: [
        { shapeId: 'roof', position: { x: -1, y: 0, z: 1 } },
        { shapeId: 'roof', position: { x: 1, y: 0, z: 1 } },
        { shapeId: 'other-roof', position: { x: 10, y: 10, z: 1 } },
      ],
    }

    const resolved = resolveArrayScenePanels(PANEL_ARRAY, sceneGeometry)

    expect(resolved).toBeDefined()
    expect(resolved!.panels).toEqual([
      { position: { x: -1, y: 0, z: 1 } },
      { position: { x: 1, y: 0, z: 1 } },
    ])
    // Obstacle list: the OTHER shape plus the obstruction, never 'roof' itself.
    expect(resolved!.obstacles).toEqual([
      { kind: 'shape', vertices: ROOF_VERTICES },
      { kind: 'tree', position: { x: 5, y: 5 }, heightM: 4, radiusM: 1.5 },
    ])
  })
})

describe('computeArrayPowerWithOcclusion', () => {
  it('produces less power with a blocking obstruction than with it removed, and never fully zero (diffuse survives)', () => {
    // A tall, wide building due south of the panel. At 30deg sun altitude,
    // a ray from the panel toward the sun reaches z = y * tan(30deg) as it
    // crosses each y coordinate south of the panel; at y=-10 that's
    // ~5.8m, comfortably inside this 40m-tall, 10m-wide building
    // centered at (0, -10) (footprint x,y in [-5, 5] x [-15, -5]).
    const sceneGeometry: SceneGeometry = {
      shapes: [{ id: 'roof', vertices: ROOF_VERTICES }],
      obstructions: [
        {
          kind: 'building',
          position: { x: 0, y: -10 },
          heightM: 40,
          radiusM: 5,
        },
      ],
      panels: [{ shapeId: 'roof', position: { x: 0, y: 0, z: 1 } }],
    }

    const withObstruction = resolveArrayScenePanels(PANEL_ARRAY, sceneGeometry)!
    const withoutObstruction = resolveArrayScenePanels(PANEL_ARRAY, {
      ...sceneGeometry,
      obstructions: [],
    })!

    const occludedPowerW = computeArrayPowerWithOcclusion(
      PANEL_ARRAY,
      withObstruction,
      SUN,
      HORIZONTAL_IRRADIANCE,
      AMBIENT_TEMP_C,
      LOSSES_PERCENT,
    )
    const unoccludedPowerW = computeArrayPowerWithOcclusion(
      PANEL_ARRAY,
      withoutObstruction,
      SUN,
      HORIZONTAL_IRRADIANCE,
      AMBIENT_TEMP_C,
      LOSSES_PERCENT,
    )

    expect(occludedPowerW).toBeLessThan(unoccludedPowerW)
    expect(occludedPowerW).toBeGreaterThan(0) // diffuse-only, never fully zero

    // Exact match against directly computing the diffuse-only power via
    // the same physics primitives, hand-verifying the occluded branch.
    const expectedOccludedPoa = poaIrradiance(
      { direct: 0, diffuse: HORIZONTAL_IRRADIANCE.diffuseWm2 },
      { altitude: SUN_ALTITUDE_DEG, azimuth: SUN_AZIMUTH_DEG },
      PANEL_ARRAY.tiltDeg,
      PANEL_ARRAY.azimuthDeg,
    )
    const panelSpec: PanelSpec = {
      ratedWattsPeak: PANEL_ARRAY.wattsPerPanel,
      efficiencyPercent: PANEL_ARRAY.efficiencyPercent,
      tempCoefficientPercentPerC: PANEL_ARRAY.tempCoefficientPercentPerC,
    }
    const expectedOccludedPowerW = panelPowerOutput(
      expectedOccludedPoa,
      panelSpec,
      AMBIENT_TEMP_C,
      LOSSES_PERCENT,
    )
    expect(occludedPowerW).toBeCloseTo(expectedOccludedPowerW, 10)
  })

  it('a shape can shade another shape’s panels (two-shapes-shade-each-other scope decision)', () => {
    // shapeA is a tall vertical wall (e.g. a two-story extension's face)
    // standing due south of shapeB's panel, spanning z in [0, 40]. Same
    // hand-verified geometry as the obstruction test above: at 30deg sun
    // altitude, the ray from shapeB's panel crosses y=-10 at z ~= 5.8m,
    // well within the wall's [0, 40] extent and [-5, 5] x-extent.
    const shapeAWall = [
      { x: -5, y: -10, z: 0 },
      { x: 5, y: -10, z: 0 },
      { x: 5, y: -10, z: 40 },
      { x: -5, y: -10, z: 40 },
    ]
    const arrayB: PanelArrayConfig = { ...PANEL_ARRAY, shapeId: 'shapeB' }

    const sceneGeometryBothShapes: SceneGeometry = {
      shapes: [
        { id: 'shapeB', vertices: ROOF_VERTICES },
        { id: 'shapeA', vertices: shapeAWall },
      ],
      obstructions: [],
      panels: [
        { shapeId: 'shapeB', position: { x: 0, y: 0, z: 1 } },
        { shapeId: 'shapeA', position: { x: 0, y: -10, z: 20 } },
      ],
    }
    const sceneGeometryOnlyShapeB: SceneGeometry = {
      ...sceneGeometryBothShapes,
      shapes: sceneGeometryBothShapes.shapes.filter((s) => s.id === 'shapeB'),
    }

    const geometryShaded = resolveArrayScenePanels(
      arrayB,
      sceneGeometryBothShapes,
    )!
    const geometryUnshaded = resolveArrayScenePanels(
      arrayB,
      sceneGeometryOnlyShapeB,
    )!

    const shadedPowerW = computeArrayPowerWithOcclusion(
      arrayB,
      geometryShaded,
      SUN,
      HORIZONTAL_IRRADIANCE,
      AMBIENT_TEMP_C,
      LOSSES_PERCENT,
    )
    const unshadedPowerW = computeArrayPowerWithOcclusion(
      arrayB,
      geometryUnshaded,
      SUN,
      HORIZONTAL_IRRADIANCE,
      AMBIENT_TEMP_C,
      LOSSES_PERCENT,
    )

    expect(shadedPowerW).toBeLessThan(unshadedPowerW)
    expect(shadedPowerW).toBeGreaterThan(0)
  })

  it('sums power across every real panel independently — a partially-shaded array is not all-or-nothing', () => {
    // One panel due south of the building (occluded), one panel far to
    // the east, well outside the building's footprint (unoccluded).
    const sceneGeometry: SceneGeometry = {
      shapes: [{ id: 'roof', vertices: ROOF_VERTICES }],
      obstructions: [
        {
          kind: 'building',
          position: { x: 0, y: -10 },
          heightM: 40,
          radiusM: 5,
        },
      ],
      panels: [
        { shapeId: 'roof', position: { x: 0, y: 0, z: 1 } }, // occluded
        { shapeId: 'roof', position: { x: 50, y: 0, z: 1 } }, // clear
      ],
    }

    const geometry = resolveArrayScenePanels(PANEL_ARRAY, sceneGeometry)!
    const totalPowerW = computeArrayPowerWithOcclusion(
      PANEL_ARRAY,
      geometry,
      SUN,
      HORIZONTAL_IRRADIANCE,
      AMBIENT_TEMP_C,
      LOSSES_PERCENT,
    )

    const singlyOccludedGeometry = resolveArrayScenePanels(PANEL_ARRAY, {
      ...sceneGeometry,
      panels: [sceneGeometry.panels[0]],
    })!
    const occludedOnlyPowerW = computeArrayPowerWithOcclusion(
      PANEL_ARRAY,
      singlyOccludedGeometry,
      SUN,
      HORIZONTAL_IRRADIANCE,
      AMBIENT_TEMP_C,
      LOSSES_PERCENT,
    )

    // The two-panel total should exceed the occluded-panel's contribution
    // alone by roughly the clear panel's own (much larger, direct+diffuse)
    // output — i.e. the clear panel isn't being dragged down to zero by
    // its shaded neighbor.
    expect(totalPowerW).toBeGreaterThan(occludedOnlyPowerW * 1.5)
  })

  it('warns in dev when array.panelCount disagrees with the real scene panel count (issue #88, item 3)', () => {
    // `array.panelCount` (bookkeeping/display only) should always agree
    // with `geometry.panels.length` (the actual power-computation
    // authority) by construction — this only fires the dev-time invariant
    // check deliberately, by handing in a `PanelArrayConfig` whose
    // `panelCount` doesn't match the single-panel `geometry` fixture.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const geometry = resolveArrayScenePanels(PANEL_ARRAY, {
      shapes: [{ id: 'roof', vertices: ROOF_VERTICES }],
      obstructions: [],
      panels: [{ shapeId: 'roof', position: { x: 0, y: 0, z: 1 } }],
    })!

    computeArrayPowerWithOcclusion(
      { ...PANEL_ARRAY, panelCount: 99 },
      geometry,
      SUN,
      HORIZONTAL_IRRADIANCE,
      AMBIENT_TEMP_C,
      LOSSES_PERCENT,
    )

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toMatch(/panelCount/)
    warnSpy.mockRestore()
  })

  it('does not warn when array.panelCount agrees with the real scene panel count', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const geometry = resolveArrayScenePanels(PANEL_ARRAY, {
      shapes: [{ id: 'roof', vertices: ROOF_VERTICES }],
      obstructions: [],
      panels: [{ shapeId: 'roof', position: { x: 0, y: 0, z: 1 } }],
    })!

    computeArrayPowerWithOcclusion(
      PANEL_ARRAY, // panelCount: 1, matching the single-panel geometry above
      geometry,
      SUN,
      HORIZONTAL_IRRADIANCE,
      AMBIENT_TEMP_C,
      LOSSES_PERCENT,
    )

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
