/**
 * TMY (long-term climate-normal) simulation orchestration: wires
 * `data-sources` (NASA POWER climate normals) through the `solar-physics`
 * pipeline to produce a typed, chart-ready result. This is the only
 * module allowed to depend on both `solar-physics` and `data-sources`,
 * per the M1 design spec's module-boundary rule
 * (docs/superpowers/specs/2026-09-12-solarly-m1-design.md).
 *
 * Algorithm: clearness-index disaggregation of NASA POWER's monthly daily
 * mean insolation into an hourly curve for a representative day per
 * month, via `solar-physics`'s clear-sky and GHI-decomposition models.
 * See `docs/decisions/0040-tmy-disaggregation-approach.md` for the full
 * rationale and known limitations.
 */

import {
  clearSkyIrradiance,
  decomposeGhi,
  panelPowerOutput,
  poaIrradiance,
  sunPosition,
} from '../solar-physics/index.ts'
import {
  fetchNasaPowerClimateNormals,
  type MonthlyClimateNormal,
} from '../data-sources/index.ts'
import type {
  HourlyPoint,
  Location,
  MonthlySimulation,
  SimulationResult,
  SystemConfig,
} from './types.ts'

/**
 * Fixed calendar year used to anchor each month's representative day and
 * days-in-month arithmetic. TMY climate normals have no real year
 * attached (they're 20-year averages), so any non-leap year works — 2025
 * is used so February consistently has 28 days, matching a "typical"
 * (non-leap) year. See ADR 0040.
 */
export const REFERENCE_YEAR = 2025

/** Representative day-of-month used for each month's synthesized hourly curve — see ADR 0040. */
const REPRESENTATIVE_DAY_OF_MONTH = 15

/**
 * Upper/lower bounds the clearness scale factor is clamped to. A factor
 * above 1 is allowed (rather than capped at 1) because real-world GHI can
 * slightly exceed this module's simplified clear-sky estimate near midday
 * under cloud-edge enhancement; 1.2 is a generous but bounded allowance
 * for that. See ADR 0040.
 */
const MIN_CLEARNESS_FACTOR = 0
const MAX_CLEARNESS_FACTOR = 1.2

const HOURS_PER_DAY = 24

export interface RunTmySimulationInput {
  location: Location
  systemConfig: SystemConfig
}

/**
 * Combines `systemLossesPercent` and `manualShadingPercent` into a single
 * aggregate loss percentage for `panelPowerOutput`'s `systemLossesPercent`
 * parameter, by stacking their retention factors multiplicatively (i.e.
 * treating manual shading as an independent additional derate on top of
 * system losses, not summed with it) — see ADR 0040 for why.
 */
function combinedLossesPercent(
  systemLossesPercent: number,
  manualShadingPercent: number,
): number {
  const retention =
    (1 - systemLossesPercent / 100) * (1 - manualShadingPercent / 100)
  return (1 - retention) * 100
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the *next* month is the last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function dayOfYear(year: number, month: number, day: number): number {
  const startOfYear = Date.UTC(year, 0, 1)
  const thisDay = Date.UTC(year, month - 1, day)
  return Math.round((thisDay - startOfYear) / 86400000) + 1
}

/**
 * Computes clear-sky horizontal GHI (direct + diffuse) for every hour of
 * the representative day, plus the day's total clear-sky insolation.
 *
 * Hours are stepped as UTC hours of the representative calendar date
 * (rather than resolving the location's local solar day, which would
 * require a timezone lookup this project doesn't otherwise perform — see
 * ADR 0040). This is a good approximation away from extreme longitudes;
 * it can shift the apparent sunrise/sunset hour by up to ~12h of UTC
 * clock time relative to local solar time without affecting total daily
 * insolation, since the full 24-hour cycle is still covered.
 */
function computeClearSkyHourly(
  location: Location,
  year: number,
  month: number,
  day: number,
): { hour: number; ghiWm2: number; sunAlt: number; sunAz: number }[] {
  const hourly: {
    hour: number
    ghiWm2: number
    sunAlt: number
    sunAz: number
  }[] = []
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    const timestamp = new Date(Date.UTC(year, month - 1, day, hour))
    const sun = sunPosition(location.lat, location.lon, timestamp)
    const clearSky = clearSkyIrradiance(sun.altitude)
    hourly.push({
      hour,
      ghiWm2: clearSky.direct + clearSky.diffuse,
      sunAlt: sun.altitude,
      sunAz: sun.azimuth,
    })
  }
  return hourly
}

/**
 * Simulates one calendar month's representative day: disaggregates the
 * month's climate-normal daily insolation into an hourly curve via a
 * clearness-index scaling of clear-sky irradiance, then runs each hour
 * through the full solar-physics pipeline. See ADR 0040.
 */
function simulateMonth(
  location: Location,
  systemConfig: SystemConfig,
  normal: MonthlyClimateNormal,
  referenceYear: number,
): MonthlySimulation {
  const day = REPRESENTATIVE_DAY_OF_MONTH
  const clearSkyHourly = computeClearSkyHourly(
    location,
    referenceYear,
    normal.month,
    day,
  )

  // Integrate hourly W/m^2 samples as if each represents that hour's
  // average irradiance, so summing 24 of them yields Wh/m^2/day.
  const clearSkyDailyInsolationWhM2 = clearSkyHourly.reduce(
    (sum, h) => sum + h.ghiWm2,
    0,
  )
  const clearSkyDailyInsolationKWhM2 = clearSkyDailyInsolationWhM2 / 1000

  // Guard against a division by (near-)zero clear-sky estimate — possible
  // in principle for a polar-night representative day where the sun never
  // rises. In that case there's no clear-sky reference to scale against,
  // so the clearness factor is meaningless; fall back to 0 (no output),
  // which is also physically correct for a day with no daylight hours.
  const clearnessFactorRaw =
    clearSkyDailyInsolationKWhM2 > 0
      ? normal.dailyInsolationKWhM2 / clearSkyDailyInsolationKWhM2
      : 0
  const clearnessFactor = Math.min(
    Math.max(clearnessFactorRaw, MIN_CLEARNESS_FACTOR),
    MAX_CLEARNESS_FACTOR,
  )

  const ratedWattsPeak = systemConfig.panelCount * systemConfig.wattsPerPanel
  const panelSpec = {
    ratedWattsPeak,
    efficiencyPercent: systemConfig.efficiencyPercent,
    tempCoefficientPercentPerC: systemConfig.tempCoefficientPercentPerC,
  }
  const lossesPercent = combinedLossesPercent(
    systemConfig.systemLossesPercent,
    systemConfig.manualShadingPercent,
  )

  const representativeDayHourly: HourlyPoint[] = clearSkyHourly.map((h) => {
    const estimatedGhiWm2 = h.ghiWm2 * clearnessFactor
    const sun = { altitude: h.sunAlt, azimuth: h.sunAz }
    const decomposed = decomposeGhi(estimatedGhiWm2, sun)
    const poaIrradianceWm2 = poaIrradiance(
      { direct: decomposed.directWm2, diffuse: decomposed.diffuseWm2 },
      sun,
      systemConfig.tiltDeg,
      systemConfig.azimuthDeg,
    )
    const powerW = panelPowerOutput(
      poaIrradianceWm2,
      panelSpec,
      normal.temperatureC,
      lossesPercent,
    )
    return { hour: h.hour, poaIrradianceWm2, powerW }
  })

  // Same "hourly sample = hourly average" convention as the clear-sky
  // integration above: summing 24 hourly watt values yields Wh for the day.
  const representativeDayTotalKWh =
    representativeDayHourly.reduce((sum, p) => sum + p.powerW, 0) / 1000

  const monthDaysInMonth = daysInMonth(referenceYear, normal.month)

  return {
    month: normal.month,
    dayOfYear: dayOfYear(referenceYear, normal.month, day),
    ambientTemperatureC: normal.temperatureC,
    clearnessFactor,
    representativeDayHourly,
    representativeDayTotalKWh,
    daysInMonth: monthDaysInMonth,
    monthlyTotalKWh: representativeDayTotalKWh * monthDaysInMonth,
  }
}

/**
 * Builds a full {@link SimulationResult} from already-fetched
 * `MonthlyClimateNormal[]` data, running the clearness-index
 * disaggregation + full solar-physics pipeline for each month. Split out
 * from `runTmySimulation` so integration tests can wire fixture climate
 * data straight through the physics pipeline without mocking network
 * calls — see `runTmySimulation.test.ts`.
 */
export function buildTmySimulationResult(
  location: Location,
  systemConfig: SystemConfig,
  normals: MonthlyClimateNormal[],
  referenceYear: number = REFERENCE_YEAR,
): SimulationResult {
  const months = normals
    .map((normal) =>
      simulateMonth(location, systemConfig, normal, referenceYear),
    )
    .sort((a, b) => a.month - b.month)

  const annualTotalKWh = months.reduce((sum, m) => sum + m.monthlyTotalKWh, 0)

  return {
    location,
    systemConfig,
    referenceYear,
    months,
    annualTotalKWh,
  }
}

/**
 * Runs a full TMY (long-term climate-normal) simulation for a location and
 * PV system configuration: fetches NASA POWER's monthly climate normals,
 * disaggregates each into a representative day's hourly curve via a
 * clearness-index model, and runs the result through the full
 * solar-physics pipeline (POA transposition + panel power output).
 *
 * @throws {NasaPowerRequestError} on a NASA POWER network/API failure —
 *   propagated as-is from `fetchNasaPowerClimateNormals`.
 * @throws {NasaPowerNoDataError} if the location has no usable NASA POWER
 *   coverage — propagated as-is.
 */
export async function runTmySimulation({
  location,
  systemConfig,
}: RunTmySimulationInput): Promise<SimulationResult> {
  const normals = await fetchNasaPowerClimateNormals({
    latitude: location.lat,
    longitude: location.lon,
  })

  return buildTmySimulationResult(location, systemConfig, normals)
}
