/**
 * Live forecast mode orchestration — the only place that wires
 * `data-sources` (Open-Meteo) forecast data through the `solar-physics`
 * pipeline for Live mode. See
 * docs/superpowers/specs/2026-09-12-solarly-m1-design.md and
 * docs/decisions/0016-live-forecast-orchestration.md.
 */

import { fetchOpenMeteoForecast } from '../data-sources'
import type { HourlyClimate } from '../data-sources'
import {
  sunPosition,
  decomposeGhi,
  poaIrradiance,
  panelPowerOutput,
  sunAltitudeAzimuthToEnuDirection,
} from '../solar-physics'
import type { PanelSpec } from '../solar-physics'
import {
  computeArrayPowerWithOcclusion,
  resolveArrayScenePanels,
  type ArrayScenePanels,
} from './sceneOcclusion'
import type {
  HourlyPowerPoint,
  Location,
  LiveSimulationResult,
  PanelArrayConfig,
  SceneGeometry,
  SystemConfig,
} from './types'

export interface RunLiveSimulationInput {
  location: Location
  systemConfig: SystemConfig
  /**
   * Real 3D scene geometry, for M3's per-panel occlusion loop (issue #77)
   * — see `RunTmySimulationInput.sceneGeometry`'s doc comment (same
   * contract: optional and purely additive, falls back to the pre-M3
   * `manualShadingPercent` shortcut per-array when absent or non-matching).
   */
  sceneGeometry?: SceneGeometry
}

/**
 * Half the width of Open-Meteo's hourly averaging window, in milliseconds.
 * Open-Meteo's `shortwave_radiation` stamped at `HH:00Z` is the mean
 * irradiance over `(HH-1):00Z` to `HH:00Z`, not an instantaneous sample at
 * `HH:00Z`. Sun position is computed at `HH:00Z - 30min` (the interval
 * midpoint) rather than at `HH:00Z` to better align the sun geometry with
 * the averaged irradiance value — see ADR 0016.
 */
const GHI_INTERVAL_MIDPOINT_OFFSET_MS = 30 * 60 * 1000

/**
 * Dependencies `runLiveSimulation` needs from `data-sources`, injectable for
 * testing (e.g. with fixture `HourlyClimate[]` data) without a live network
 * call. Defaults to the real Open-Meteo client.
 */
export interface RunLiveSimulationDeps {
  fetchForecast: (lat: number, lon: number) => Promise<HourlyClimate[]>
}

const defaultDeps: RunLiveSimulationDeps = {
  fetchForecast: (lat, lon) => fetchOpenMeteoForecast(lat, lon),
}

/**
 * Validates `location` and `systemConfig` before any physics runs.
 *
 * Without this, a non-finite `SystemConfig` field (e.g. `NaN` from a
 * partially-cleared numeric form input, per issue #13) propagates silently
 * into `HourlyPowerPoint.watts`, breaking that field's documented
 * "non-negative" contract; a negative percentage (e.g.
 * `manualShadingPercent: -20`) silently *inflates* output instead of being
 * rejected, since only the low end is clamped downstream; and an
 * out-of-range latitude/longitude produces a silent all-zero series (sun
 * position degenerates rather than erroring) instead of a clear failure. See
 * PR #34 review finding #1.
 */
function validateInput(location: Location, systemConfig: SystemConfig): void {
  const { lat, lon } = location
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(
      `Invalid location.lat: must be a finite number in [-90, 90], got ${lat}`,
    )
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error(
      `Invalid location.lon: must be a finite number in [-180, 180], got ${lon}`,
    )
  }

  requireFiniteInRange(
    'systemConfig.systemLossesPercent',
    systemConfig.systemLossesPercent,
    0,
    100,
  )

  if (systemConfig.arrays.length === 0) {
    throw new Error(
      'Invalid systemConfig.arrays: must contain at least one array',
    )
  }

  systemConfig.arrays.forEach((array, index) => {
    const prefix = `systemConfig.arrays[${index}]`
    requireFiniteInRange(`${prefix}.tiltDeg`, array.tiltDeg, 0, 90)
    requireFiniteInRange(`${prefix}.azimuthDeg`, array.azimuthDeg, 0, 360)
    requireFiniteInRange(
      `${prefix}.manualShadingPercent`,
      array.manualShadingPercent,
      0,
      100,
    )

    if (!Number.isFinite(array.panelCount) || array.panelCount <= 0) {
      throw new Error(
        `Invalid ${prefix}.panelCount: must be a finite number > 0, got ${array.panelCount}`,
      )
    }
    if (!Number.isFinite(array.wattsPerPanel) || array.wattsPerPanel <= 0) {
      throw new Error(
        `Invalid ${prefix}.wattsPerPanel: must be a finite number > 0, got ${array.wattsPerPanel}`,
      )
    }
    if (!Number.isFinite(array.tempCoefficientPercentPerC)) {
      throw new Error(
        `Invalid ${prefix}.tempCoefficientPercentPerC: must be a finite number, got ${array.tempCoefficientPercentPerC}`,
      )
    }
    if (!Number.isFinite(array.efficiencyPercent)) {
      throw new Error(
        `Invalid ${prefix}.efficiencyPercent: must be a finite number, got ${array.efficiencyPercent}`,
      )
    }
  })
}

function requireFiniteInRange(
  fieldName: string,
  value: number,
  min: number,
  max: number,
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(
      `Invalid ${fieldName}: must be a finite number in [${min}, ${max}], got ${value}`,
    )
  }
}

function toPanelSpec(array: PanelArrayConfig): PanelSpec {
  return {
    ratedWattsPeak: array.panelCount * array.wattsPerPanel,
    efficiencyPercent: array.efficiencyPercent,
    tempCoefficientPercentPerC: array.tempCoefficientPercentPerC,
  }
}

/**
 * Computes hourly panel power output for Live forecast mode: fetches an
 * Open-Meteo hourly forecast for `input.location` and runs each hour's GHI
 * + temperature through the `solar-physics` pipeline
 * (`sunPosition` -> `decomposeGhi` -> `poaIrradiance` -> `panelPowerOutput`)
 * using `input.systemConfig`'s tilt/azimuth/panel spec.
 *
 * Loss stacking: `panelPowerOutput()` already applies `systemLossesPercent`
 * internally; `manualShadingPercent` is applied on top as an additional
 * multiplicative derate, i.e. the combined loss factor is
 * `(1 - systemLossesPercent / 100) * (1 - manualShadingPercent / 100)`. See
 * ADR 0016.
 *
 * @param input Location + system config to simulate.
 * @param deps Injectable dependencies (for testing with fixture climate
 *   data); defaults to the real Open-Meteo client.
 */
export async function runLiveSimulation(
  input: RunLiveSimulationInput,
  deps: RunLiveSimulationDeps = defaultDeps,
): Promise<LiveSimulationResult> {
  const { location, systemConfig, sceneGeometry } = input
  validateInput(location, systemConfig)
  const climate = await deps.fetchForecast(location.lat, location.lon)

  // Precomputed once for the whole forecast horizon (rather than once per
  // hour): each array's real scene panels + obstacle list, or `undefined`
  // for an array that should keep using the pre-M3 `manualShadingPercent`
  // shortcut — see `resolveArrayScenePanels`'s doc comment. Neither a
  // shape's vertices nor an obstruction's geometry change hour-to-hour,
  // only the sun direction does.
  const arrayScenePanels = new Map<PanelArrayConfig, ArrayScenePanels>()
  for (const array of systemConfig.arrays) {
    const resolved = resolveArrayScenePanels(array, sceneGeometry)
    if (resolved) arrayScenePanels.set(array, resolved)
  }

  const hourlyWattsSeries: HourlyPowerPoint[] = climate.map((entry) =>
    hourlyPowerPoint(entry, location, systemConfig, arrayScenePanels),
  )

  return {
    mode: 'live',
    location,
    hourlyWattsSeries,
  }
}

function hourlyPowerPoint(
  entry: HourlyClimate,
  location: Location,
  systemConfig: SystemConfig,
  arrayScenePanels: Map<PanelArrayConfig, ArrayScenePanels>,
): HourlyPowerPoint {
  const stampedInstant = new Date(entry.timestamp)
  // Compute sun position at the interval midpoint, not the HH:00Z stamp
  // itself — see GHI_INTERVAL_MIDPOINT_OFFSET_MS's doc comment / ADR 0016.
  const midpointInstant = new Date(
    stampedInstant.getTime() - GHI_INTERVAL_MIDPOINT_OFFSET_MS,
  )

  const sunPos = sunPosition(location.lat, location.lon, midpointInstant)
  const decomposed = decomposeGhi(entry.ghiWm2, sunPos)
  const { directWm2, diffuseWm2 } = decomposed
  const sunDirection = arrayScenePanels.size
    ? sunAltitudeAzimuthToEnuDirection(sunPos.altitude, sunPos.azimuth)
    : undefined

  const watts = systemConfig.arrays.reduce((sum, array) => {
    const geometry = arrayScenePanels.get(array)
    if (geometry && sunDirection) {
      // Real scene geometry is driving this array's occlusion — M3
      // replaces the user-estimated `manualShadingPercent` derate with the
      // real computed one rather than stacking both (harmless while the
      // scene-editor path always produced 0, but no longer once #78 wired
      // this up live — see PR #82 review). The non-occlusion fallback
      // below still applies the array's own `manualShadingPercent`
      // exactly as before.
      const powerW = computeArrayPowerWithOcclusion(
        array,
        geometry,
        {
          altitudeDeg: sunPos.altitude,
          azimuthDeg: sunPos.azimuth,
          direction: sunDirection,
        },
        decomposed,
        entry.temperatureC,
        // A geometry-resolved array replaces `manualShadingPercent` with
        // the real computed occlusion rather than stacking both (see the
        // comment above), so the combined loss is just
        // `systemLossesPercent` on its own here — folding it through the
        // old `combinedLossesPercent(systemLossesPercent, 0)` call was a
        // no-op (issue #94 item 5).
        systemConfig.systemLossesPercent,
      )
      return sum + Math.max(powerW, 0)
    }

    const poa = poaIrradiance(
      { direct: directWm2, diffuse: diffuseWm2 },
      sunPos,
      array.tiltDeg,
      array.azimuthDeg,
    )
    const basePowerW = panelPowerOutput(
      poa,
      toPanelSpec(array),
      entry.temperatureC,
      systemConfig.systemLossesPercent,
    )
    const manualShadingFactor = 1 - array.manualShadingPercent / 100
    return sum + Math.max(basePowerW * manualShadingFactor, 0)
  }, 0)

  return { timestamp: entry.timestamp, watts }
}
