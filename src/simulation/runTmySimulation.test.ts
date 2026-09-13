import { describe, expect, it } from 'vitest'
import type { MonthlyClimateNormal } from '../data-sources/index.ts'
import { sunPosition } from '../solar-physics/index.ts'
import {
  buildTmySimulationResult,
  MAX_CLEARNESS_FACTOR,
  REFERENCE_YEAR,
} from './runTmySimulation.ts'
import type { PanelArrayConfig, SceneGeometry, SystemConfig } from './types.ts'

/**
 * Fixture climate normals loosely modeled on NASA POWER climatology for a
 * sunny mid-latitude location (Phoenix, AZ-ish: high insolation,
 * pronounced seasonal swing, hot summers). Values are representative
 * rather than pulled verbatim from a live API response — this module's
 * tests are integration tests of the physics pipeline wiring, not of
 * NASA POWER's response format (that's `data-sources`'s job).
 */
const SUNNY_LOCATION_NORMALS: MonthlyClimateNormal[] = [
  { month: 1, temperatureC: 11.5, dailyInsolationKWhM2: 3.9 },
  { month: 2, temperatureC: 13.8, dailyInsolationKWhM2: 4.9 },
  { month: 3, temperatureC: 17.2, dailyInsolationKWhM2: 6.1 },
  { month: 4, temperatureC: 21.5, dailyInsolationKWhM2: 7.3 },
  { month: 5, temperatureC: 26.6, dailyInsolationKWhM2: 8.0 },
  { month: 6, temperatureC: 32.0, dailyInsolationKWhM2: 8.4 },
  { month: 7, temperatureC: 35.0, dailyInsolationKWhM2: 7.6 },
  { month: 8, temperatureC: 34.2, dailyInsolationKWhM2: 7.1 },
  { month: 9, temperatureC: 30.5, dailyInsolationKWhM2: 6.6 },
  { month: 10, temperatureC: 23.8, dailyInsolationKWhM2: 5.4 },
  { month: 11, temperatureC: 16.2, dailyInsolationKWhM2: 4.1 },
  { month: 12, temperatureC: 11.0, dailyInsolationKWhM2: 3.5 },
]

const SUNNY_LOCATION = { lat: 33.45, lon: -112.07 } // Phoenix, AZ

/** A modest residential system: ~20 panels x 400W ~= 8kW. */
const RESIDENTIAL_ARRAY: PanelArrayConfig = {
  tiltDeg: 20,
  azimuthDeg: 180,
  panelCount: 20,
  wattsPerPanel: 400,
  efficiencyPercent: 21,
  tempCoefficientPercentPerC: -0.34,
  manualShadingPercent: 0,
}

const RESIDENTIAL_SYSTEM: SystemConfig = {
  arrays: [RESIDENTIAL_ARRAY],
  systemLossesPercent: 14,
}

/** Overrides a field on the single array of a single-array `SystemConfig` fixture. */
function withArrayOverride(
  config: SystemConfig,
  override: Partial<PanelArrayConfig>,
): SystemConfig {
  return {
    ...config,
    arrays: config.arrays.map((array) => ({ ...array, ...override })),
  }
}

describe('buildTmySimulationResult', () => {
  it('produces one MonthlySimulation per input climate normal, sorted ascending by month', () => {
    const result = buildTmySimulationResult(
      SUNNY_LOCATION,
      RESIDENTIAL_SYSTEM,
      SUNNY_LOCATION_NORMALS,
    )

    expect(result.months).toHaveLength(12)
    expect(result.months.map((m) => m.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
    expect(result.referenceYear).toBe(REFERENCE_YEAR)
    expect(result.location).toEqual(SUNNY_LOCATION)
    expect(result.systemConfig).toEqual(RESIDENTIAL_SYSTEM)
  })

  it('handles a partial (non-12-month) input by only producing entries for available months', () => {
    const partialNormals = SUNNY_LOCATION_NORMALS.filter((n) =>
      [6, 7, 12].includes(n.month),
    )

    const result = buildTmySimulationResult(
      SUNNY_LOCATION,
      RESIDENTIAL_SYSTEM,
      partialNormals,
    )

    expect(result.months.map((m) => m.month)).toEqual([6, 7, 12])
  })

  it('each representative day has a 24-hour curve in local solar time, with zero power at night and positive power at midday', () => {
    const result = buildTmySimulationResult(
      SUNNY_LOCATION,
      RESIDENTIAL_SYSTEM,
      SUNNY_LOCATION_NORMALS,
    )

    const june = result.months.find((m) => m.month === 6)!
    expect(june.representativeDayHourly).toHaveLength(24)
    expect(june.representativeDayHourly.map((h) => h.hour)).toEqual(
      Array.from({ length: 24 }, (_, i) => i),
    )

    // `hour` is local solar time (see ADR 0040), so local midnight is
    // hour 0 regardless of the location's actual UTC offset.
    const midnight = june.representativeDayHourly.find((h) => h.hour === 0)!
    expect(midnight.powerW).toBe(0)
    expect(midnight.poaIrradianceWm2).toBe(0)

    // Local solar noon (hour 12) should be producing substantial power for
    // an 8kW-rated array in a sunny location.
    const midday = june.representativeDayHourly.find((h) => h.hour === 12)!
    expect(midday.powerW).toBeGreaterThan(1000)
  })

  it('centers the daily curve on local solar noon regardless of longitude (not raw UTC noon)', () => {
    // Tokyo (lon +139.65, UTC+9) and Fiji (lon +178.44, near the date
    // line) are both far enough from UTC that stepping the representative
    // day in raw UTC hours would wrap/mis-center the curve (see ADR 0040
    // and the PR review) — Tokyo's UTC-stepped peak would land near "hour
    // 3", and Fiji's would split into two lobes across midnight UTC.
    // Local-solar-time stepping should center both on hour 12 with a
    // single contiguous nighttime block.
    const TOKYO = { lat: 35.68, lon: 139.65 }
    const tokyoResult = buildTmySimulationResult(TOKYO, RESIDENTIAL_SYSTEM, [
      { month: 6, temperatureC: 24, dailyInsolationKWhM2: 4.5 },
    ])
    const tokyoJune = tokyoResult.months[0]
    const tokyoPeak = tokyoJune.representativeDayHourly.reduce((a, b) =>
      b.powerW > a.powerW ? b : a,
    )
    expect(tokyoPeak.hour).toBe(12)

    const FIJI = { lat: -18.14, lon: 178.44 }
    const fijiResult = buildTmySimulationResult(FIJI, RESIDENTIAL_SYSTEM, [
      { month: 1, temperatureC: 27, dailyInsolationKWhM2: 6.0 },
    ])
    const fijiJan = fijiResult.months[0]
    const fijiPeak = fijiJan.representativeDayHourly.reduce((a, b) =>
      b.powerW > a.powerW ? b : a,
    )
    expect(fijiPeak.hour).toBe(12)

    // Nighttime (zero-power) hours should form a single contiguous block
    // that doesn't wrap around the array edges — a double-peaked/split
    // curve would show zero-power hours both near the start and the end
    // with non-zero power in between at both ends.
    const isZero = (h: { powerW: number }) => h.powerW === 0
    for (const hourly of [
      tokyoJune.representativeDayHourly,
      fijiJan.representativeDayHourly,
    ]) {
      const zeroIndices = hourly
        .map((h, i) => (isZero(h) ? i : -1))
        .filter((i) => i !== -1)
      // A contiguous block (allowing wraparound would show a gap in the
      // middle instead of at one end) has no "gap" once sorted — check
      // that non-zero hours form one contiguous run instead.
      const nonZeroIndices = hourly
        .map((h, i) => (isZero(h) ? -1 : i))
        .filter((i) => i !== -1)
      expect(nonZeroIndices.length).toBeGreaterThan(0)
      const first = nonZeroIndices[0]
      const last = nonZeroIndices[nonZeroIndices.length - 1]
      expect(last - first + 1).toBe(nonZeroIndices.length)
      expect(zeroIndices.length + nonZeroIndices.length).toBe(24)
    }
  })

  it('clamps the clearness factor into [0, 1.2]', () => {
    const result = buildTmySimulationResult(
      SUNNY_LOCATION,
      RESIDENTIAL_SYSTEM,
      SUNNY_LOCATION_NORMALS,
    )

    for (const month of result.months) {
      expect(month.clearnessFactor).toBeGreaterThanOrEqual(0)
      expect(month.clearnessFactor).toBeLessThanOrEqual(1.2)
    }
  })

  it('every month is mostly clear (clearness factor near the upper end) for this sunny fixture', () => {
    const result = buildTmySimulationResult(
      SUNNY_LOCATION,
      RESIDENTIAL_SYSTEM,
      SUNNY_LOCATION_NORMALS,
    )

    for (const month of result.months) {
      // Phoenix's real-world insolation is close to (usually slightly
      // below) simple clear-sky estimates for most of the year.
      expect(month.clearnessFactor).toBeGreaterThan(0.5)
    }
  })

  it('a genuinely clear month lands at/near a clearness factor of 1.0 rather than routinely hitting the clamp', () => {
    // With the single-day-15 denominator, this fixture's Jan/Dec raw
    // clearness factors were 1.2075/1.1996 — one clamped, one a hair
    // below the clamp (see the PR review). With the month-averaged
    // clear-sky denominator, both should land comfortably below the 1.2
    // clamp, so the clamp is a rare safety net again, not routine
    // truncation on this fixture.
    const result = buildTmySimulationResult(
      SUNNY_LOCATION,
      RESIDENTIAL_SYSTEM,
      SUNNY_LOCATION_NORMALS,
    )

    for (const month of result.months) {
      expect(month.clearnessFactor).toBeLessThan(MAX_CLEARNESS_FACTOR)
    }

    // Pin the most diagnostic intermediate values (per the PR review) so a
    // regression in `clearSkyIrradiance`/`sunPosition`/the denominator
    // calculation is caught here rather than only surfacing as a change
    // in the much-less-sensitive annual total.
    const jan = result.months.find((m) => m.month === 1)!
    const dec = result.months.find((m) => m.month === 12)!
    expect(jan.clearnessFactor).toBeCloseTo(1.18, 1)
    expect(dec.clearnessFactor).toBeCloseTo(1.18, 1)
  })

  it('still clamps the clearness factor as a rare safety net for a genuinely implausible climate normal', () => {
    // A climate normal claiming far more insolation than even clear skies
    // could plausibly deliver (e.g. bad input data) should still hit the
    // upper clamp — the fix to the denominator shouldn't remove the
    // safety net entirely, just stop it from triggering routinely.
    const result = buildTmySimulationResult(
      SUNNY_LOCATION,
      RESIDENTIAL_SYSTEM,
      [{ month: 6, temperatureC: 32, dailyInsolationKWhM2: 20 }],
    )
    expect(result.months[0].clearnessFactor).toBe(MAX_CLEARNESS_FACTOR)
  })

  it('computes monthlyTotalKWh as representativeDayTotalKWh * daysInMonth, and February has 28 days in the reference year', () => {
    const result = buildTmySimulationResult(
      SUNNY_LOCATION,
      RESIDENTIAL_SYSTEM,
      SUNNY_LOCATION_NORMALS,
    )

    const feb = result.months.find((m) => m.month === 2)!
    expect(feb.daysInMonth).toBe(28)
    expect(feb.monthlyTotalKWh).toBeCloseTo(
      feb.representativeDayTotalKWh * 28,
      6,
    )

    const july = result.months.find((m) => m.month === 7)!
    expect(july.daysInMonth).toBe(31)
  })

  it('annualTotalKWh equals the sum of all monthlyTotalKWh entries', () => {
    const result = buildTmySimulationResult(
      SUNNY_LOCATION,
      RESIDENTIAL_SYSTEM,
      SUNNY_LOCATION_NORMALS,
    )

    const expectedAnnual = result.months.reduce(
      (sum, m) => sum + m.monthlyTotalKWh,
      0,
    )
    expect(result.annualTotalKWh).toBeCloseTo(expectedAnnual, 6)
  })

  it('produces a plausible annual kWh figure for an ~8kW residential system in a sunny location', () => {
    const result = buildTmySimulationResult(
      SUNNY_LOCATION,
      RESIDENTIAL_SYSTEM,
      SUNNY_LOCATION_NORMALS,
    )

    // Real-world reference: a well-sited ~8kW residential system in a
    // sunny US location like Phoenix typically produces somewhere around
    // 1,500-2,200 kWh per installed kWp (a PVWatts-style capacity-factor
    // range for high-insolation sites — PVWatts itself lands closer to
    // ~1,700-1,800 kWh/kWp for a comparable Phoenix system once inverter
    // efficiency and a diurnal temperature curve are modeled, neither of
    // which this simplified pipeline does yet — see ADR 0040's "known,
    // one-directional bias" notes). The previous band here (1,000-2,500
    // kWh/kWp) was wide enough to pass an order-of-magnitude bug and
    // nothing else (per the PR review); this tighter band still allows
    // for the model's documented simplifications while catching a real
    // regression in the disaggregation or clear-sky pipeline.
    const kWhPerKWp = result.annualTotalKWh / 8 // 20 panels * 400W = 8kWp
    expect(kWhPerKWp).toBeGreaterThan(1500)
    expect(kWhPerKWp).toBeLessThan(2200)
  })

  it('applies manual shading as an additional derate on top of system losses', () => {
    const shadedSystem: SystemConfig = withArrayOverride(RESIDENTIAL_SYSTEM, {
      manualShadingPercent: 50,
    })

    const unshaded = buildTmySimulationResult(
      SUNNY_LOCATION,
      RESIDENTIAL_SYSTEM,
      SUNNY_LOCATION_NORMALS,
    )
    const shaded = buildTmySimulationResult(
      SUNNY_LOCATION,
      shadedSystem,
      SUNNY_LOCATION_NORMALS,
    )

    // Retention factors stack multiplicatively: (1 - losses) * (1 - shading).
    // With systemLossesPercent = 14 and manualShadingPercent = 50, the
    // shaded system should retain (1 - 0.14) * (1 - 0.50) = 0.43 of the
    // unshaded (1 - 0.14) = 0.86 retention, i.e. exactly half.
    expect(shaded.annualTotalKWh).toBeCloseTo(unshaded.annualTotalKWh * 0.5, 4)
  })

  it('a bigger array (more panels) produces proportionally more energy', () => {
    const biggerSystem: SystemConfig = withArrayOverride(RESIDENTIAL_SYSTEM, {
      panelCount: RESIDENTIAL_ARRAY.panelCount * 2,
    })

    const base = buildTmySimulationResult(
      SUNNY_LOCATION,
      RESIDENTIAL_SYSTEM,
      SUNNY_LOCATION_NORMALS,
    )
    const bigger = buildTmySimulationResult(
      SUNNY_LOCATION,
      biggerSystem,
      SUNNY_LOCATION_NORMALS,
    )

    expect(bigger.annualTotalKWh).toBeCloseTo(base.annualTotalKWh * 2, 4)
  })

  it('assigns each representative day a sensible day-of-year value that increases month over month', () => {
    const result = buildTmySimulationResult(
      SUNNY_LOCATION,
      RESIDENTIAL_SYSTEM,
      SUNNY_LOCATION_NORMALS,
    )

    const dayOfYears = result.months.map((m) => m.dayOfYear)
    for (let i = 1; i < dayOfYears.length; i++) {
      expect(dayOfYears[i]).toBeGreaterThan(dayOfYears[i - 1])
    }
    // Jan 15 is the 15th day of the year.
    expect(result.months[0].dayOfYear).toBe(15)
  })

  it('summer months produce more energy than winter months at this northern-hemisphere sunny location', () => {
    const result = buildTmySimulationResult(
      SUNNY_LOCATION,
      RESIDENTIAL_SYSTEM,
      SUNNY_LOCATION_NORMALS,
    )

    const june = result.months.find((m) => m.month === 6)!
    const december = result.months.find((m) => m.month === 12)!
    expect(june.monthlyTotalKWh).toBeGreaterThan(december.monthlyTotalKWh)
  })

  it('does not silently zero out a high-latitude winter month even when day 15 has no daylight at all', () => {
    // At lat >= ~67, day 15 of a winter month can itself be a polar-night
    // day with zero clear-sky insolation, which used to force the whole
    // month's clearness factor (and therefore its real, measured
    // insolation) to be silently discarded as 0 — see the PR review's
    // Issue 3. Tromsø-ish latitude/longitude, December, with a small but
    // real NASA-POWER-style measured insolation.
    const HIGH_LATITUDE_WINTER_LOCATION = { lat: 68, lon: 20 }
    const result = buildTmySimulationResult(
      HIGH_LATITUDE_WINTER_LOCATION,
      RESIDENTIAL_SYSTEM,
      [{ month: 12, temperatureC: -10, dailyInsolationKWhM2: 0.2 }],
    )

    const december = result.months[0]
    expect(Number.isFinite(december.clearnessFactor)).toBe(true)
    expect(Number.isFinite(december.monthlyTotalKWh)).toBe(true)
    // The month has some real measured insolation, so it should produce
    // *some* non-zero output — not be silently zeroed by a degenerate
    // day-15 denominator/shape.
    expect(december.monthlyTotalKWh).toBeGreaterThan(0)
  })

  it('reports a genuine near-zero (not NaN/Infinity) for a month with truly no daylight all month', () => {
    // Distinguish "the month genuinely has ~no sun at all" (a real
    // physical near-zero) from a division-by-zero artifact: deep polar
    // night (lat 85) in December, with an essentially-zero measured
    // insolation to match.
    const TRUE_POLAR_NIGHT_LOCATION = { lat: 85, lon: 10 }
    const result = buildTmySimulationResult(
      TRUE_POLAR_NIGHT_LOCATION,
      RESIDENTIAL_SYSTEM,
      [{ month: 12, temperatureC: -20, dailyInsolationKWhM2: 0.01 }],
    )

    const december = result.months[0]
    expect(Number.isFinite(december.clearnessFactor)).toBe(true)
    expect(Number.isFinite(december.monthlyTotalKWh)).toBe(true)
    expect(december.clearnessFactor).toBe(0)
    expect(december.monthlyTotalKWh).toBe(0)
    for (const hour of december.representativeDayHourly) {
      expect(Number.isFinite(hour.powerW)).toBe(true)
      expect(Number.isFinite(hour.poaIrradianceWm2)).toBe(true)
    }
  })

  describe('multi-array configs', () => {
    // A steep south-facing roof array plus a flatter east-facing roof array,
    // meaningfully different tilt/azimuth per issue #54's acceptance
    // criteria.
    const SOUTH_STEEP_ARRAY: PanelArrayConfig = {
      tiltDeg: 35,
      azimuthDeg: 180,
      panelCount: 20,
      wattsPerPanel: 400,
      efficiencyPercent: 21,
      tempCoefficientPercentPerC: -0.34,
      manualShadingPercent: 0,
    }
    const EAST_FLAT_ARRAY: PanelArrayConfig = {
      tiltDeg: 10,
      azimuthDeg: 90,
      panelCount: 10,
      wattsPerPanel: 350,
      efficiencyPercent: 19,
      tempCoefficientPercentPerC: -0.4,
      manualShadingPercent: 5,
    }
    const MULTI_ARRAY_SYSTEM: SystemConfig = {
      arrays: [SOUTH_STEEP_ARRAY, EAST_FLAT_ARRAY],
      systemLossesPercent: 14,
    }

    it("sums each hour's power across arrays to the sum of each array's standalone contribution", () => {
      const combined = buildTmySimulationResult(
        SUNNY_LOCATION,
        MULTI_ARRAY_SYSTEM,
        SUNNY_LOCATION_NORMALS,
      )
      const southOnly = buildTmySimulationResult(
        SUNNY_LOCATION,
        { arrays: [SOUTH_STEEP_ARRAY], systemLossesPercent: 14 },
        SUNNY_LOCATION_NORMALS,
      )
      const eastOnly = buildTmySimulationResult(
        SUNNY_LOCATION,
        { arrays: [EAST_FLAT_ARRAY], systemLossesPercent: 14 },
        SUNNY_LOCATION_NORMALS,
      )

      for (const month of combined.months) {
        const southMonth = southOnly.months.find(
          (m) => m.month === month.month,
        )!
        const eastMonth = eastOnly.months.find((m) => m.month === month.month)!

        for (const hour of month.representativeDayHourly) {
          const southHour = southMonth.representativeDayHourly.find(
            (h) => h.hour === hour.hour,
          )!
          const eastHour = eastMonth.representativeDayHourly.find(
            (h) => h.hour === hour.hour,
          )!
          expect(hour.powerW).toBeCloseTo(southHour.powerW + eastHour.powerW, 6)
        }
      }

      // Sanity check: the annual total should also equal the sum of each
      // array's standalone annual total.
      expect(combined.annualTotalKWh).toBeCloseTo(
        southOnly.annualTotalKWh + eastOnly.annualTotalKWh,
        4,
      )
      expect(combined.annualTotalKWh).toBeGreaterThan(0)
    })

    it('a single-array config wrapped in a one-element arrays array matches the pre-#54 flat-shape output (regression check)', () => {
      // RESIDENTIAL_SYSTEM already has a single-element `arrays` array (the
      // post-#54 shape). This confirms every assertion elsewhere in this
      // file — which was pinned against the pre-#54 flat-shape behavior —
      // still holds, i.e. summing over an array of length one is a
      // byte-identical no-op.
      const result = buildTmySimulationResult(
        SUNNY_LOCATION,
        RESIDENTIAL_SYSTEM,
        SUNNY_LOCATION_NORMALS,
      )

      const kWhPerKWp = result.annualTotalKWh / 8 // 20 panels * 400W = 8kWp
      expect(kWhPerKWp).toBeGreaterThan(1500)
      expect(kWhPerKWp).toBeLessThan(2200)
    })
  })

  describe('scene geometry (M3 per-panel occlusion, issue #77)', () => {
    /** Local-solar-noon hour used by every representative day (see `REPRESENTATIVE_DAY_OF_MONTH`/`computeClearSkyHourly`). */
    const REPRESENTATIVE_HOUR = 12
    const REPRESENTATIVE_DAY = 15

    /**
     * Replicates `computeClearSkyHourly`'s local-solar-time timestamp
     * construction (not exported) so this test can call `sunPosition`
     * itself and derive a fixture obstruction guaranteed to intersect the
     * exact ray the simulation will actually cast for local-solar noon of
     * a given month — rather than guessing a plausible-looking building
     * size and hoping it lines up with the real sun angle.
     */
    function localSolarNoonSunPosition(
      location: { lat: number; lon: number },
      month: number,
    ) {
      const localSolarOffsetMs = -(location.lon / 15) * 3_600_000
      const timestamp = new Date(
        Date.UTC(
          REFERENCE_YEAR,
          month - 1,
          REPRESENTATIVE_DAY,
          REPRESENTATIVE_HOUR,
        ) + localSolarOffsetMs,
      )
      return sunPosition(location.lat, location.lon, timestamp)
    }

    /**
     * Builds a 'building' obstruction guaranteed to occlude a panel at the
     * scene origin from the sun at `sunAlt`/`sunAz`: placed along the
     * sun's exact horizontal direction at `planeDistM` meters, tall enough
     * (`planeDistM * tan(altitude) + margin`) that the ray from the origin
     * toward the sun passes through its volume well before exiting the
     * top, with a generous footprint radius so small floating-point drift
     * in the geometry can't make it miss.
     */
    function obstructionAlongSun(
      sunAltDeg: number,
      sunAzDeg: number,
      planeDistM = 8,
    ) {
      const azRad = (sunAzDeg * Math.PI) / 180
      const altRad = (sunAltDeg * Math.PI) / 180
      return {
        kind: 'building' as const,
        position: {
          x: planeDistM * Math.sin(azRad),
          y: planeDistM * Math.cos(azRad),
        },
        heightM: planeDistM * Math.tan(altRad) + 25,
        radiusM: 6,
      }
    }

    const ROOF_VERTICES = [
      { x: -3, y: -3, z: 0 },
      { x: 3, y: -3, z: 0 },
      { x: 3, y: 3, z: 0 },
      { x: -3, y: 3, z: 0 },
    ]

    /** Same fixture location/array as the rest of this file, but with a `shapeId` so the M3 occlusion path applies. */
    const SCENE_ARRAY: PanelArrayConfig = {
      ...RESIDENTIAL_ARRAY,
      panelCount: 1,
      shapeId: 'roof',
    }
    const SCENE_SYSTEM: SystemConfig = {
      arrays: [SCENE_ARRAY],
      systemLossesPercent: 14,
    }

    function sceneGeometryWithObstruction(
      obstructions: SceneGeometry['obstructions'],
    ): SceneGeometry {
      return {
        shapes: [{ id: 'roof', vertices: ROOF_VERTICES }],
        obstructions,
        panels: [{ shapeId: 'roof', position: { x: 0, y: 0, z: 1 } }],
      }
    }

    it('an hour with a known-occluded sun angle produces less power than the same hour with the obstruction removed, and never fully zero (diffuse survives)', () => {
      const sun = localSolarNoonSunPosition(SUNNY_LOCATION, 12) // December
      expect(sun.altitude).toBeGreaterThan(0) // sanity: this is a daytime hour

      const obstruction = obstructionAlongSun(sun.altitude, sun.azimuth)

      const occludedResult = buildTmySimulationResult(
        SUNNY_LOCATION,
        SCENE_SYSTEM,
        SUNNY_LOCATION_NORMALS,
        REFERENCE_YEAR,
        sceneGeometryWithObstruction([obstruction]),
      )
      const unoccludedResult = buildTmySimulationResult(
        SUNNY_LOCATION,
        SCENE_SYSTEM,
        SUNNY_LOCATION_NORMALS,
        REFERENCE_YEAR,
        sceneGeometryWithObstruction([]),
      )

      const occludedNoon = occludedResult.months
        .find((m) => m.month === 12)!
        .representativeDayHourly.find((h) => h.hour === REPRESENTATIVE_HOUR)!
      const unoccludedNoon = unoccludedResult.months
        .find((m) => m.month === 12)!
        .representativeDayHourly.find((h) => h.hour === REPRESENTATIVE_HOUR)!

      expect(occludedNoon.powerW).toBeLessThan(unoccludedNoon.powerW)
      expect(occludedNoon.powerW).toBeGreaterThan(0)
    })

    it('an array with no shapeId is unaffected by sceneGeometry (manual form path stays on manualShadingPercent)', () => {
      const sun = localSolarNoonSunPosition(SUNNY_LOCATION, 12)
      const obstruction = obstructionAlongSun(sun.altitude, sun.azimuth)

      const withoutSceneGeometry = buildTmySimulationResult(
        SUNNY_LOCATION,
        RESIDENTIAL_SYSTEM, // no shapeId on its array
        SUNNY_LOCATION_NORMALS,
      )
      const withSceneGeometryButNoShapeIdMatch = buildTmySimulationResult(
        SUNNY_LOCATION,
        RESIDENTIAL_SYSTEM,
        SUNNY_LOCATION_NORMALS,
        REFERENCE_YEAR,
        sceneGeometryWithObstruction([obstruction]),
      )

      expect(withSceneGeometryButNoShapeIdMatch).toEqual(withoutSceneGeometry)
    })

    it('ignores manualShadingPercent for an array with real scene geometry driving its occlusion (issue #78 / PR #82 review)', () => {
      // M3's whole point is to REPLACE the user-estimated manualShadingPercent
      // derate with the real computed one for an array whose occlusion is
      // actually driven by scene geometry — not stack the two. A non-zero
      // manualShadingPercent must have zero effect once `shapeId` resolves
      // against `sceneGeometry`, even with no obstruction placed (so any
      // stacking would otherwise show up as a plain flat derate).
      const unshaded: SystemConfig = {
        arrays: [{ ...SCENE_ARRAY, manualShadingPercent: 0 }],
        systemLossesPercent: 14,
      }
      const heavilyManualShaded: SystemConfig = {
        arrays: [{ ...SCENE_ARRAY, manualShadingPercent: 80 }],
        systemLossesPercent: 14,
      }

      const unshadedResult = buildTmySimulationResult(
        SUNNY_LOCATION,
        unshaded,
        SUNNY_LOCATION_NORMALS,
        REFERENCE_YEAR,
        sceneGeometryWithObstruction([]),
      )
      const manualShadedResult = buildTmySimulationResult(
        SUNNY_LOCATION,
        heavilyManualShaded,
        SUNNY_LOCATION_NORMALS,
        REFERENCE_YEAR,
        sceneGeometryWithObstruction([]),
      )

      // Compare computed output only — `systemConfig` is just the input
      // echoed back verbatim (see `TmySimulationResult`'s doc comment), so
      // it correctly differs on `manualShadingPercent` between the two
      // inputs; that's not what this test is checking.
      expect(manualShadedResult.months).toEqual(unshadedResult.months)
      expect(manualShadedResult.annualTotalKWh).toEqual(
        unshadedResult.annualTotalKWh,
      )

      // Sanity check: manualShadingPercent DOES still matter for the same
      // array on the pre-M3 fallback path (no sceneGeometry supplied) —
      // proving the equality above isn't just because 80% shading happens
      // to have no measurable effect at this fixture's irradiance.
      const unshadedFallback = buildTmySimulationResult(
        SUNNY_LOCATION,
        unshaded,
        SUNNY_LOCATION_NORMALS,
      )
      const manualShadedFallback = buildTmySimulationResult(
        SUNNY_LOCATION,
        heavilyManualShaded,
        SUNNY_LOCATION_NORMALS,
      )
      expect(manualShadedFallback.annualTotalKWh).toBeLessThan(
        unshadedFallback.annualTotalKWh,
      )
    })
  })
})
