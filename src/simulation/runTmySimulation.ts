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
 * See `docs/decisions/0080-tmy-disaggregation-approach.md` for the full
 * rationale and known limitations.
 */

import {
  clearSkyIrradiance,
  decomposeGhi,
  panelPowerOutput,
  poaIrradiance,
  sunAltitudeAzimuthToEnuDirection,
  sunPosition,
} from '../solar-physics/index.ts'
import {
  fetchNasaPowerClimateNormals,
  type MonthlyClimateNormal,
} from '../data-sources/index.ts'
import {
  computeArrayPowerWithOcclusion,
  resolveArrayScenePanels,
  toPanelSpec,
  type ArrayScenePanels,
} from './sceneOcclusion.ts'
import type {
  HourlyPoint,
  Location,
  MonthlySimulation,
  PanelArrayConfig,
  SceneGeometry,
  TmySimulationResult,
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
export const MAX_CLEARNESS_FACTOR = 1.2

const HOURS_PER_DAY = 24

export interface RunTmySimulationInput {
  location: Location
  systemConfig: SystemConfig
  /**
   * Real 3D scene geometry (traced shapes, obstructions, and real panel
   * positions), for M3's per-panel occlusion loop (issue #77) — see the M3
   * design spec's "Simulation loop changes". Optional and purely additive:
   * when absent, or when a given array's `shapeId` has no corresponding
   * entry in `sceneGeometry.shapes`, that array's power is computed via
   * the pre-M3 `manualShadingPercent` flat-derate shortcut, byte-identical
   * to before this parameter existed.
   */
  sceneGeometry?: SceneGeometry
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
 * Milliseconds per hour of longitude-based local solar time offset from
 * UTC (15° of longitude ≈ 1 hour) — see `computeClearSkyHourly`.
 */
const MS_PER_LOCAL_SOLAR_HOUR = 3_600_000

/**
 * Computes clear-sky horizontal GHI (direct + diffuse) for every *local
 * solar* hour of the representative day, plus the day's total clear-sky
 * insolation.
 *
 * Hours are stepped in the location's local solar time — approximated as
 * a simple longitude offset from UTC (`-longitude/15` hours, no timezone
 * database or DST lookup needed, the same simple approach used elsewhere
 * in this project) — rather than raw UTC hours. Stepping in UTC would
 * still produce the correct daily *total* (a fixed offset just relabels
 * which 24 samples cover the day), but it wraps and mis-centers the
 * hourly *shape*: for a location far from UTC (e.g. Tokyo, UTC+9), "hour
 * 12" in UTC is nowhere near local solar noon, so the synthesized curve
 * would show generation clustered at the wrong hours and, near the
 * international date line, could split into two disjoint lobes. See ADR
 * 0040.
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
  const localSolarOffsetMs = -(location.lon / 15) * MS_PER_LOCAL_SOLAR_HOUR
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    const timestamp = new Date(
      Date.UTC(year, month - 1, day, hour) + localSolarOffsetMs,
    )
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

type ClearSkyHourly = {
  hour: number
  ghiWm2: number
  sunAlt: number
  sunAz: number
}[]

/**
 * Result of scanning every day of a month's clear-sky insolation once:
 * the month-averaged daily clear-sky insolation (the clearness-factor
 * denominator, see below) plus the hourly curve to use for the
 * representative day's *shape*.
 */
interface MonthClearSkyStats {
  /** Average of each sampled day's clear-sky daily insolation across the month. */
  averageDailyInsolationKWhM2: number
  /** Day-of-month whose hourly curve is used for the representative day's shape. */
  shapeDay: number
  /** That day's hourly clear-sky curve. */
  shapeHourly: ClearSkyHourly
}

/**
 * Scans every day of the month once, computing:
 *
 * 1. The month's **average** clear-sky daily insolation (sampling clear-sky
 *    insolation across every day spanning the month rather than relying on
 *    a single representative day, and averaging the results) — used as the
 *    clearness-factor denominator. See ADR 0040's "month-averaged
 *    clear-sky denominator" section for why a single day (e.g. day 15) is
 *    a poor denominator: day-to-day clear-sky variation (and, at high
 *    latitude, sharp convexity near polar night) can make a single day's
 *    estimate diverge substantially from the month's true average, which
 *    is what a monthly climate normal actually measures against.
 * 2. Which day's hourly clear-sky curve to use for the representative
 *    day's *shape* (diurnal sunrise/sunset/peak pattern). Ordinarily this
 *    is `preferredDay` (day 15) — a fine astronomical stand-in for "what a
 *    clear day looks like this month". But at high latitude, day 15 itself
 *    can be a polar-night day with zero clear-sky insolation even though
 *    the month as a whole has some daylight at its edges (see ADR 0040 /
 *    the PR review's Issue 3) — using day 15's all-zero curve as the shape
 *    would silently zero the whole month's real, non-zero climate-normal
 *    insolation. In that degenerate case, fall back to the month's
 *    best-daylight day instead, so a month with any real daylight at all
 *    produces a non-zero (if small) output.
 */
function computeMonthClearSkyStats(
  location: Location,
  year: number,
  month: number,
  totalDaysInMonth: number,
  preferredDay: number,
): MonthClearSkyStats {
  let sum = 0
  let count = 0
  let bestDay = preferredDay
  let bestDayTotalKWhM2 = -Infinity
  let bestDayHourly: ClearSkyHourly = []
  let preferredHourly: ClearSkyHourly = []
  let preferredTotalKWhM2 = 0

  for (let day = 1; day <= totalDaysInMonth; day++) {
    const hourly = computeClearSkyHourly(location, year, month, day)
    const dailyKWhM2 = hourly.reduce((s, h) => s + h.ghiWm2, 0) / 1000
    sum += dailyKWhM2
    count++

    if (day === preferredDay) {
      preferredHourly = hourly
      preferredTotalKWhM2 = dailyKWhM2
    }
    if (dailyKWhM2 > bestDayTotalKWhM2) {
      bestDayTotalKWhM2 = dailyKWhM2
      bestDay = day
      bestDayHourly = hourly
    }
  }

  const averageDailyInsolationKWhM2 = count > 0 ? sum / count : 0

  // Use day 15's own shape unless it's degenerate (zero clear-sky
  // insolation) while the month as a whole has real daylight elsewhere.
  const dayFifteenIsDegenerate =
    preferredTotalKWhM2 <= 0 && averageDailyInsolationKWhM2 > 0

  return {
    averageDailyInsolationKWhM2,
    shapeDay: dayFifteenIsDegenerate ? bestDay : preferredDay,
    shapeHourly: dayFifteenIsDegenerate ? bestDayHourly : preferredHourly,
  }
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
  sceneGeometry: SceneGeometry | undefined,
): MonthlySimulation {
  const day = REPRESENTATIVE_DAY_OF_MONTH
  const monthDaysInMonth = daysInMonth(referenceYear, normal.month)

  // A single scan of every day in the month: the month-averaged clear-sky
  // daily insolation (the clearness-factor denominator) plus the hourly
  // curve to use for the representative day's shape (ordinarily day 15,
  // unless day 15 is itself a degenerate polar-night day — see
  // `computeMonthClearSkyStats` and ADR 0040).
  const { averageDailyInsolationKWhM2, shapeHourly: clearSkyHourly } =
    computeMonthClearSkyStats(
      location,
      referenceYear,
      normal.month,
      monthDaysInMonth,
      day,
    )
  const clearSkyDailyInsolationKWhM2 = averageDailyInsolationKWhM2

  // Guard against a division by (near-)zero clear-sky estimate — possible
  // in principle for a month whose every day is polar night (the sun
  // never rises at all, all month). In that case there's no clear-sky
  // reference to scale against, so the clearness factor is meaningless;
  // fall back to 0 (no output), which is also physically correct for a
  // month with no daylight hours at all. `Number.isFinite` additionally
  // guards against a NaN/Infinity artifact (e.g. a non-zero climate
  // normal divided by a zero or otherwise degenerate denominator) leaking
  // into the result instead of a clean 0.
  const clearnessFactorRaw =
    clearSkyDailyInsolationKWhM2 > 0
      ? normal.dailyInsolationKWhM2 / clearSkyDailyInsolationKWhM2
      : 0
  const clearnessFactor = Number.isFinite(clearnessFactorRaw)
    ? Math.min(
        Math.max(clearnessFactorRaw, MIN_CLEARNESS_FACTOR),
        MAX_CLEARNESS_FACTOR,
      )
    : 0

  const totalPanelCount = systemConfig.arrays.reduce(
    (sum, array) => sum + array.panelCount,
    0,
  )

  // Precomputed once per month (rather than recomputed every hour): each
  // array's real scene panels + obstacle list, keyed by array object
  // identity, or `undefined` for an array that should keep using the
  // pre-M3 `manualShadingPercent` shortcut (see `resolveArrayScenePanels`'s
  // doc comment for exactly which arrays fall back). Neither a shape's
  // vertices nor an obstruction's geometry change hour-to-hour, only the
  // sun direction does, so this is invariant across `clearSkyHourly.map`
  // below.
  const arrayScenePanels = new Map<PanelArrayConfig, ArrayScenePanels>()
  for (const array of systemConfig.arrays) {
    const resolved = resolveArrayScenePanels(array, sceneGeometry)
    if (resolved) arrayScenePanels.set(array, resolved)
  }

  const representativeDayHourly: HourlyPoint[] = clearSkyHourly.map((h) => {
    const estimatedGhiWm2 = h.ghiWm2 * clearnessFactor
    const sun = { altitude: h.sunAlt, azimuth: h.sunAz }
    const decomposed = decomposeGhi(estimatedGhiWm2, sun)
    const sunDirection = arrayScenePanels.size
      ? sunAltitudeAzimuthToEnuDirection(h.sunAlt, h.sunAz)
      : undefined

    let totalPowerW = 0
    let weightedPoaIrradianceWm2 = 0
    for (const array of systemConfig.arrays) {
      // Always computed, occlusion-agnostic — this is a display/diagnostic
      // aggregate only (see `HourlyPoint.poaIrradianceWm2`'s doc comment),
      // never fed into the power calculation below.
      const arrayPoaIrradianceWm2 = poaIrradiance(
        { direct: decomposed.directWm2, diffuse: decomposed.diffuseWm2 },
        sun,
        array.tiltDeg,
        array.azimuthDeg,
      )

      const geometry = arrayScenePanels.get(array)
      // When real scene geometry is driving this array's occlusion, M3's
      // whole point is to REPLACE the user-estimated `manualShadingPercent`
      // derate with the real computed one — not stack the two, which would
      // silently double-shade the array (harmless while the scene-editor
      // path always produced 0, but no longer once #78 wired this up live —
      // see PR #82 review). Zeroed only for a `geometry`-resolved array;
      // the non-occlusion fallback below still applies the array's own
      // `manualShadingPercent` exactly as before.
      const lossesPercent = combinedLossesPercent(
        systemConfig.systemLossesPercent,
        geometry ? 0 : array.manualShadingPercent,
      )
      const powerW =
        geometry && sunDirection
          ? computeArrayPowerWithOcclusion(
              array,
              geometry,
              {
                altitudeDeg: h.sunAlt,
                azimuthDeg: h.sunAz,
                direction: sunDirection,
              },
              decomposed,
              normal.temperatureC,
              lossesPercent,
            )
          : panelPowerOutput(
              arrayPoaIrradianceWm2,
              toPanelSpec(array),
              normal.temperatureC,
              lossesPercent,
            )
      totalPowerW += powerW
      // Panel-count-weighted average across arrays — see the comment above.
      weightedPoaIrradianceWm2 += arrayPoaIrradianceWm2 * array.panelCount
    }
    const poaIrradianceWm2 =
      totalPanelCount > 0 ? weightedPoaIrradianceWm2 / totalPanelCount : 0

    return { hour: h.hour, poaIrradianceWm2, powerW: totalPowerW }
  })

  // Same "hourly sample = hourly average" convention as the clear-sky
  // integration above: summing 24 hourly watt values yields Wh for the day.
  const representativeDayTotalKWh =
    representativeDayHourly.reduce((sum, p) => sum + p.powerW, 0) / 1000

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
 * Builds a full {@link TmySimulationResult} from already-fetched
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
  sceneGeometry?: SceneGeometry,
): TmySimulationResult {
  const months = normals
    .map((normal) =>
      simulateMonth(
        location,
        systemConfig,
        normal,
        referenceYear,
        sceneGeometry,
      ),
    )
    .sort((a, b) => a.month - b.month)

  const annualTotalKWh = months.reduce((sum, m) => sum + m.monthlyTotalKWh, 0)

  return {
    mode: 'tmy',
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
  sceneGeometry,
}: RunTmySimulationInput): Promise<TmySimulationResult> {
  const normals = await fetchNasaPowerClimateNormals({
    latitude: location.lat,
    longitude: location.lon,
  })

  return buildTmySimulationResult(
    location,
    systemConfig,
    normals,
    REFERENCE_YEAR,
    sceneGeometry,
  )
}
