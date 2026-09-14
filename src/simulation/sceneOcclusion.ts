/**
 * Per-panel geometric shadow occlusion for the hourly generation loop
 * (issue #77, see `docs/superpowers/specs/2026-09-13-solarly-m3-design.md`'s
 * "Simulation loop changes"). Shared between `runTmySimulation.ts` and
 * `runLiveSimulation.ts` so both pipelines apply the exact same
 * array<->shape correlation and per-panel power calculation.
 *
 * When a `PanelArrayConfig` has a `shapeId` that matches an entry in the
 * caller's `SceneGeometry.shapes`, this module replaces the
 * `panelPowerOutput(...) * panelCount` shortcut for that array with a real
 * per-panel loop: each of the array's actual panel positions
 * (`SceneGeometry.panels` filtered by `shapeId`) is tested for direct-beam
 * occlusion against every *other* shape and every obstruction via
 * `solar-physics/shadowOcclusion`'s `isPanelOccluded`, and an occluded
 * panel's direct-beam component is zeroed (diffuse untouched) before
 * `panelPowerOutput` runs for it.
 *
 * When an array has no `shapeId`, or its `shapeId` doesn't match any
 * `SceneGeometry.shapes` entry (no `sceneGeometry` supplied at all, the
 * manual single-array form, or an M2-era `SystemConfig` applied before
 * this field existed), `resolveArrayScenePanels` returns `undefined` and
 * the caller falls back to the pre-M3 `manualShadingPercent` flat-derate
 * path, completely unchanged — see each caller's own regression tests.
 */

import { isPanelOccluded } from '../solar-physics/index.ts'
import type { Obstacle, Vec3 } from '../solar-physics/index.ts'
import { panelPowerOutput, poaIrradiance } from '../solar-physics/index.ts'
import type { PanelSpec } from '../solar-physics/index.ts'
import type { PanelArrayConfig, SceneGeometry } from './types.ts'

/**
 * Converts a {@link PanelArrayConfig} into the {@link PanelSpec} shape
 * `panelPowerOutput` expects. Shared by `runLiveSimulation.ts` and
 * `runTmySimulation.ts` (previously duplicated identically in both, with an
 * inconsistent explicit return-type annotation between the two copies) so
 * there's exactly one place defining how an array's panel-count/
 * wattage/efficiency/temp-coefficient fields map onto the solar-physics
 * pipeline's panel model.
 */
export function toPanelSpec(array: PanelArrayConfig): PanelSpec {
  return {
    ratedWattsPeak: array.panelCount * array.wattsPerPanel,
    efficiencyPercent: array.efficiencyPercent,
    tempCoefficientPercentPerC: array.tempCoefficientPercentPerC,
  }
}

/**
 * One array's resolved scene geometry: its real panel positions plus the
 * obstacle list every one of them should be tested against (every *other*
 * shape, per the M3 spec's "a shape never occludes its own panels" rule,
 * plus every obstruction). Precomputed once per array — rather than
 * recomputed on every hour of the simulation loop — since neither a
 * shape's vertices nor an obstruction's geometry change hour-to-hour, only
 * the sun direction does.
 */
export interface ArrayScenePanels {
  panels: { position: Vec3 }[]
  obstacles: Obstacle[]
}

/**
 * Builds the `Obstacle[]` list a `shapeId`'s panels should be tested
 * against: every other traced shape's extruded vertices (`kind: 'shape'`)
 * plus every placed obstruction, verbatim — `SceneGeometry.obstructions`'
 * `{ kind, position, heightM, radiusM }` shape already matches
 * `shadowOcclusion.ts`'s `Obstacle` union field-for-field (see that
 * module's doc comment on why), so no per-field mapping is needed beyond
 * the object literal itself.
 */
function buildObstaclesExcludingOwnShape(
  sceneGeometry: SceneGeometry,
  ownShapeId: string,
): Obstacle[] {
  const shapeObstacles: Obstacle[] = sceneGeometry.shapes
    .filter((shape) => shape.id !== ownShapeId)
    .map((shape) => ({ kind: 'shape', vertices: shape.vertices }))

  const obstructionObstacles: Obstacle[] = sceneGeometry.obstructions.map(
    (o) => ({
      kind: o.kind,
      position: o.position,
      heightM: o.heightM,
      radiusM: o.radiusM,
    }),
  )

  return [...shapeObstacles, ...obstructionObstacles]
}

/**
 * Resolves an array's real scene panels + obstacle list, or `undefined`
 * when this array should use the pre-M3 flat-derate path instead — either
 * because no `sceneGeometry` was supplied at all, the array has no
 * `shapeId` (the manual form path, or an M2-era `SystemConfig`), or its
 * `shapeId` doesn't match any shape actually present in `sceneGeometry`
 * (defensive: shouldn't happen for a `SceneGeometry`/`SystemConfig` pair
 * derived from the same scene, but a caller could in principle pass
 * mismatched ones).
 *
 * A matching shape with zero panels (e.g. an emptied array, per the M3
 * spec's "Error handling" section) still resolves — `panels: []` — rather
 * than falling back, so `computeArrayPowerWithOcclusion` correctly
 * contributes zero power for it instead of the flat-derate path silently
 * substituting a full, un-occluded array's worth of shortcut power.
 */
export function resolveArrayScenePanels(
  array: PanelArrayConfig,
  sceneGeometry: SceneGeometry | undefined,
): ArrayScenePanels | undefined {
  if (!sceneGeometry || !array.shapeId) return undefined
  if (!sceneGeometry.shapes.some((shape) => shape.id === array.shapeId)) {
    return undefined
  }

  return {
    panels: sceneGeometry.panels
      .filter((p) => p.shapeId === array.shapeId)
      .map((p) => ({ position: p.position })),
    obstacles: buildObstaclesExcludingOwnShape(sceneGeometry, array.shapeId),
  }
}

/** Sun altitude/azimuth (degrees) plus its precomputed ENU direction vector, for one simulated hour. */
export interface HourSunGeometry {
  altitudeDeg: number
  azimuthDeg: number
  direction: Vec3
}

/**
 * Sums per-panel power across an array's real scene panels for one hour,
 * replacing the `panelPowerOutput(...) * panelCount` shortcut per the M3
 * spec's "Simulation loop changes": each panel is tested for direct-beam
 * occlusion (`isPanelOccluded`) against `geometry.obstacles`, and an
 * occluded panel's direct-beam component is zeroed — diffuse from
 * `decomposeGhi` stays untouched, per the direct-only-occlusion decision —
 * before `panelPowerOutput` runs for that single panel.
 *
 * @param geometry This array's resolved panels + obstacle list, from
 *   `resolveArrayScenePanels`.
 * @param sun This hour's sun altitude/azimuth + ENU direction.
 * @param horizontalIrradiance This hour's *un-occluded* horizontal
 *   direct/diffuse split (from `decomposeGhi`) — the direct component is
 *   zeroed per-panel inside this function, not by the caller.
 * @param ambientTempC This hour's ambient temperature, for
 *   `panelPowerOutput`'s NOCT-based cell-temperature model.
 * @param lossesPercent The array's combined system+manual-shading losses
 *   percentage (same aggregate the non-occlusion path already uses — see
 *   each caller's `combinedLossesPercent`), applied per panel.
 */
export function computeArrayPowerWithOcclusion(
  array: PanelArrayConfig,
  geometry: ArrayScenePanels,
  sun: HourSunGeometry,
  horizontalIrradiance: { directWm2: number; diffuseWm2: number },
  ambientTempC: number,
  lossesPercent: number,
): number {
  const panelSpec: PanelSpec = {
    ratedWattsPeak: array.wattsPerPanel,
    efficiencyPercent: array.efficiencyPercent,
    tempCoefficientPercentPerC: array.tempCoefficientPercentPerC,
  }
  const sunPositionInput = {
    altitude: sun.altitudeDeg,
    azimuth: sun.azimuthDeg,
  }

  let totalPowerW = 0
  for (const panel of geometry.panels) {
    const occluded = isPanelOccluded(
      panel.position,
      sun.direction,
      geometry.obstacles,
    )
    const poa = poaIrradiance(
      {
        direct: occluded ? 0 : horizontalIrradiance.directWm2,
        diffuse: horizontalIrradiance.diffuseWm2,
      },
      sunPositionInput,
      array.tiltDeg,
      array.azimuthDeg,
    )
    totalPowerW += panelPowerOutput(poa, panelSpec, ambientTempC, lossesPercent)
  }
  return totalPowerW
}
