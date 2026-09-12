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
} from '../solar-physics'
import type { PanelSpec } from '../solar-physics'
import type {
  HourlyPowerPoint,
  Location,
  SimulationResult,
  SystemConfig,
} from './types'

export interface RunLiveSimulationInput {
  location: Location
  systemConfig: SystemConfig
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

  requireFiniteInRange('systemConfig.tiltDeg', systemConfig.tiltDeg, 0, 90)
  requireFiniteInRange(
    'systemConfig.azimuthDeg',
    systemConfig.azimuthDeg,
    0,
    360,
  )
  requireFiniteInRange(
    'systemConfig.systemLossesPercent',
    systemConfig.systemLossesPercent,
    0,
    100,
  )
  requireFiniteInRange(
    'systemConfig.manualShadingPercent',
    systemConfig.manualShadingPercent,
    0,
    100,
  )

  if (
    !Number.isFinite(systemConfig.panelCount) ||
    systemConfig.panelCount <= 0
  ) {
    throw new Error(
      `Invalid systemConfig.panelCount: must be a finite number > 0, got ${systemConfig.panelCount}`,
    )
  }
  if (
    !Number.isFinite(systemConfig.wattsPerPanel) ||
    systemConfig.wattsPerPanel <= 0
  ) {
    throw new Error(
      `Invalid systemConfig.wattsPerPanel: must be a finite number > 0, got ${systemConfig.wattsPerPanel}`,
    )
  }
  if (!Number.isFinite(systemConfig.tempCoefficientPercentPerC)) {
    throw new Error(
      `Invalid systemConfig.tempCoefficientPercentPerC: must be a finite number, got ${systemConfig.tempCoefficientPercentPerC}`,
    )
  }
  if (!Number.isFinite(systemConfig.efficiencyPercent)) {
    throw new Error(
      `Invalid systemConfig.efficiencyPercent: must be a finite number, got ${systemConfig.efficiencyPercent}`,
    )
  }
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

function toPanelSpec(systemConfig: SystemConfig): PanelSpec {
  return {
    ratedWattsPeak: systemConfig.panelCount * systemConfig.wattsPerPanel,
    efficiencyPercent: systemConfig.efficiencyPercent,
    tempCoefficientPercentPerC: systemConfig.tempCoefficientPercentPerC,
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
): Promise<SimulationResult> {
  const { location, systemConfig } = input
  validateInput(location, systemConfig)
  const climate = await deps.fetchForecast(location.lat, location.lon)
  const panelSpec = toPanelSpec(systemConfig)
  const manualShadingFactor = 1 - systemConfig.manualShadingPercent / 100

  const hourlyWattsSeries: HourlyPowerPoint[] = climate.map((entry) =>
    hourlyPowerPoint(
      entry,
      location,
      systemConfig,
      panelSpec,
      manualShadingFactor,
    ),
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
  panelSpec: PanelSpec,
  manualShadingFactor: number,
): HourlyPowerPoint {
  const stampedInstant = new Date(entry.timestamp)
  // Compute sun position at the interval midpoint, not the HH:00Z stamp
  // itself — see GHI_INTERVAL_MIDPOINT_OFFSET_MS's doc comment / ADR 0016.
  const midpointInstant = new Date(
    stampedInstant.getTime() - GHI_INTERVAL_MIDPOINT_OFFSET_MS,
  )

  const sunPos = sunPosition(location.lat, location.lon, midpointInstant)
  const { directWm2, diffuseWm2 } = decomposeGhi(entry.ghiWm2, sunPos)
  const poa = poaIrradiance(
    { direct: directWm2, diffuse: diffuseWm2 },
    sunPos,
    systemConfig.tiltDeg,
    systemConfig.azimuthDeg,
  )
  const basePowerW = panelPowerOutput(
    poa,
    panelSpec,
    entry.temperatureC,
    systemConfig.systemLossesPercent,
  )
  const watts = Math.max(basePowerW * manualShadingFactor, 0)

  return { timestamp: entry.timestamp, watts }
}
