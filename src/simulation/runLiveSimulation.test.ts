import { describe, expect, it } from 'vitest'
import { runLiveSimulation } from './runLiveSimulation'
import type { HourlyClimate } from '../data-sources'
import type { PanelArrayConfig, SystemConfig } from './types'

/**
 * Fixture climate data: two synthetic summer days at Berlin's latitude
 * (52.52N, 13.41E), hand-picked to be *shaped* like real Open-Meteo output
 * (rising through a midday peak, falling to 0 overnight) rather than a
 * captured/recorded response. Includes a short gap (a dropped null-padded
 * hour) to exercise non-contiguous input, per the M1 design doc's note that
 * `HourlyClimate[]` may skip hours.
 */
const BERLIN_SUMMER_FIXTURE: HourlyClimate[] = [
  { timestamp: '2026-06-21T00:00:00Z', temperatureC: 16, ghiWm2: 0 },
  { timestamp: '2026-06-21T03:00:00Z', temperatureC: 15, ghiWm2: 0 },
  { timestamp: '2026-06-21T05:00:00Z', temperatureC: 16, ghiWm2: 40 },
  { timestamp: '2026-06-21T07:00:00Z', temperatureC: 19, ghiWm2: 250 },
  { timestamp: '2026-06-21T09:00:00Z', temperatureC: 22, ghiWm2: 480 },
  { timestamp: '2026-06-21T11:00:00Z', temperatureC: 25, ghiWm2: 650 },
  { timestamp: '2026-06-21T12:00:00Z', temperatureC: 26, ghiWm2: 700 },
  // 13:00Z intentionally omitted, simulating an Open-Meteo null-padded hour.
  { timestamp: '2026-06-21T14:00:00Z', temperatureC: 26, ghiWm2: 600 },
  { timestamp: '2026-06-21T16:00:00Z', temperatureC: 24, ghiWm2: 350 },
  { timestamp: '2026-06-21T18:00:00Z', temperatureC: 21, ghiWm2: 100 },
  { timestamp: '2026-06-21T20:00:00Z', temperatureC: 18, ghiWm2: 0 },
  { timestamp: '2026-06-21T23:00:00Z', temperatureC: 16, ghiWm2: 0 },
]

const BERLIN = { lat: 52.52, lon: 13.41 }

const ARRAY_CONFIG: PanelArrayConfig = {
  tiltDeg: 35,
  azimuthDeg: 180,
  panelCount: 20,
  wattsPerPanel: 400,
  efficiencyPercent: 21,
  tempCoefficientPercentPerC: -0.34,
  manualShadingPercent: 10,
}

const SYSTEM_CONFIG: SystemConfig = {
  arrays: [ARRAY_CONFIG],
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

describe('runLiveSimulation', () => {
  it('wires fixture climate data through the full solar-physics pipeline', async () => {
    const result = await runLiveSimulation(
      { location: BERLIN, systemConfig: SYSTEM_CONFIG },
      { fetchForecast: async () => BERLIN_SUMMER_FIXTURE },
    )

    expect(result.mode).toBe('live')
    expect(result.location).toEqual(BERLIN)

    // One output point per fixture input hour, in the same order/timestamps
    // (the module doesn't fill in the dropped 13:00Z hour).
    expect(result.hourlyWattsSeries).toHaveLength(BERLIN_SUMMER_FIXTURE.length)
    expect(result.hourlyWattsSeries.map((p) => p.timestamp)).toEqual(
      BERLIN_SUMMER_FIXTURE.map((e) => e.timestamp),
    )

    for (const point of result.hourlyWattsSeries) {
      expect(Number.isFinite(point.watts)).toBe(true)
      expect(point.watts).toBeGreaterThanOrEqual(0)
    }

    const byTimestamp = new Map(
      result.hourlyWattsSeries.map((p) => [p.timestamp, p.watts]),
    )

    // Night hours (0 GHI) produce zero power.
    expect(byTimestamp.get('2026-06-21T00:00:00Z')).toBe(0)
    expect(byTimestamp.get('2026-06-21T23:00:00Z')).toBe(0)

    // Rated array capacity: 20 panels * 400W = 8000 Wp. No hour should
    // exceed that (POA irradiance can modestly exceed 1000 W/m2 with the
    // isotropic ground-reflected term, but not by nearly enough to clear
    // this margin).
    const ratedWattsPeak = ARRAY_CONFIG.panelCount * ARRAY_CONFIG.wattsPerPanel
    for (const watts of byTimestamp.values()) {
      expect(watts).toBeLessThan(ratedWattsPeak * 1.2)
    }

    // Golden reference values independently verified against pvlib 0.13
    // (own SPA solar position + get_total_irradiance(model='isotropic',
    // albedo=0.2)) for this exact fixture/location/system config — see the
    // PR #34 review. These pin the *magnitude* of the output tightly
    // (unlike the loose bound checks above), so a real end-to-end wiring
    // error (e.g. feeding DNI where BHI is expected) would be caught.
    const middayWatts = byTimestamp.get('2026-06-21T12:00:00Z')!
    expect(middayWatts).toBeCloseTo(4180.5, 1)

    const eveningWatts = byTimestamp.get('2026-06-21T18:00:00Z')!
    expect(eveningWatts).toBeCloseTo(558.4, 1)

    // Power should rise from sunrise toward the midday peak.
    const morningWatts = byTimestamp.get('2026-06-21T05:00:00Z')!
    const lateMorningWatts = byTimestamp.get('2026-06-21T09:00:00Z')!
    expect(lateMorningWatts).toBeGreaterThan(morningWatts)
    expect(middayWatts).toBeGreaterThan(lateMorningWatts)
  })

  it('applies the interval-midpoint sun-position adjustment in the correct direction, pinned near sunset where it matters most', async () => {
    // At midday the midpoint adjustment barely matters (~0.14% difference
    // between -30min/0/+30min variants), so it can't distinguish a sign
    // flip. Near sunset (18:00Z, sun altitude ~15 deg at the midpoint) the
    // three variants differ by 2.1x - 558.4 W (as implemented, -30min) vs.
    // 500.5 W (naive 0 min) vs. 263.0 W (sign-flipped +30min) - independently
    // verified against pvlib in the PR #34 review. Pinning this value
    // guards against a future sign flip on GHI_INTERVAL_MIDPOINT_OFFSET_MS,
    // which would otherwise pass every other assertion in this file.
    const result = await runLiveSimulation(
      { location: BERLIN, systemConfig: SYSTEM_CONFIG },
      { fetchForecast: async () => BERLIN_SUMMER_FIXTURE },
    )

    const eveningWatts = result.hourlyWattsSeries.find(
      (p) => p.timestamp === '2026-06-21T18:00:00Z',
    )!.watts

    expect(eveningWatts).toBeCloseTo(558.4, 1)
  })

  it('applies manual shading as an additional multiplicative derate on top of system losses', async () => {
    const baseInput = { location: BERLIN, systemConfig: SYSTEM_CONFIG }
    const noShadingConfig = withArrayOverride(SYSTEM_CONFIG, {
      manualShadingPercent: 0,
    })
    const deps = { fetchForecast: async () => BERLIN_SUMMER_FIXTURE }

    const [withShading, withoutShading] = await Promise.all([
      runLiveSimulation(baseInput, deps),
      runLiveSimulation(
        { location: BERLIN, systemConfig: noShadingConfig },
        deps,
      ),
    ])

    const middayWithShading = withShading.hourlyWattsSeries.find(
      (p) => p.timestamp === '2026-06-21T12:00:00Z',
    )!.watts
    const middayWithoutShading = withoutShading.hourlyWattsSeries.find(
      (p) => p.timestamp === '2026-06-21T12:00:00Z',
    )!.watts

    // manualShadingPercent = 10 => factor 0.9 on top of the unshaded result.
    expect(middayWithShading).toBeCloseTo(middayWithoutShading * 0.9, 6)
  })

  it('fetches from the injected location', async () => {
    let calledWith: [number, number] | undefined
    await runLiveSimulation(
      { location: BERLIN, systemConfig: SYSTEM_CONFIG },
      {
        fetchForecast: async (lat, lon) => {
          calledWith = [lat, lon]
          return []
        },
      },
    )

    expect(calledWith).toEqual([BERLIN.lat, BERLIN.lon])
  })

  it('returns an empty series when the forecast has no usable hours', async () => {
    const result = await runLiveSimulation(
      { location: BERLIN, systemConfig: SYSTEM_CONFIG },
      { fetchForecast: async () => [] },
    )

    expect(result.hourlyWattsSeries).toEqual([])
  })

  describe('input validation', () => {
    const deps = { fetchForecast: async () => BERLIN_SUMMER_FIXTURE }

    // A partially-cleared React numeric input (issue #13's form) produces
    // NaN, which must never silently propagate into `watts` - see PR #34
    // review finding #1.
    it('throws a clear error for NaN manualShadingPercent instead of propagating NaN into watts', async () => {
      await expect(
        runLiveSimulation(
          {
            location: BERLIN,
            systemConfig: withArrayOverride(SYSTEM_CONFIG, {
              manualShadingPercent: NaN,
            }),
          },
          deps,
        ),
      ).rejects.toThrow(/manualShadingPercent/)
    })

    it('throws a clear error for NaN systemLossesPercent instead of propagating NaN into watts', async () => {
      await expect(
        runLiveSimulation(
          {
            location: BERLIN,
            systemConfig: { ...SYSTEM_CONFIG, systemLossesPercent: NaN },
          },
          deps,
        ),
      ).rejects.toThrow(/systemLossesPercent/)
    })

    it('throws a clear error for NaN panelCount instead of propagating NaN into watts', async () => {
      await expect(
        runLiveSimulation(
          {
            location: BERLIN,
            systemConfig: withArrayOverride(SYSTEM_CONFIG, {
              panelCount: NaN,
            }),
          },
          deps,
        ),
      ).rejects.toThrow(/panelCount/)
    })

    // A negative percentage must be rejected, not silently turn a "loss"
    // into a gain (e.g. manualShadingPercent: -20 previously inflated
    // output to 5574 W instead of derating it).
    it('throws a clear error for a negative manualShadingPercent instead of silently inflating output', async () => {
      await expect(
        runLiveSimulation(
          {
            location: BERLIN,
            systemConfig: withArrayOverride(SYSTEM_CONFIG, {
              manualShadingPercent: -20,
            }),
          },
          deps,
        ),
      ).rejects.toThrow(/manualShadingPercent/)
    })

    it('throws a clear error for a negative systemLossesPercent instead of silently inflating output', async () => {
      await expect(
        runLiveSimulation(
          {
            location: BERLIN,
            systemConfig: { ...SYSTEM_CONFIG, systemLossesPercent: -50 },
          },
          deps,
        ),
      ).rejects.toThrow(/systemLossesPercent/)
    })

    // An invalid latitude must throw a clear error, not silently return an
    // all-zero series (a bad geocode from issue #12 would otherwise render
    // as "your system produces nothing").
    it('throws a clear error for an out-of-range latitude instead of returning an all-zero series', async () => {
      await expect(
        runLiveSimulation(
          {
            location: { lat: 200, lon: BERLIN.lon },
            systemConfig: SYSTEM_CONFIG,
          },
          deps,
        ),
      ).rejects.toThrow(/lat/)
    })

    it('throws a clear error for a NaN latitude instead of returning an all-zero series', async () => {
      await expect(
        runLiveSimulation(
          {
            location: { lat: NaN, lon: BERLIN.lon },
            systemConfig: SYSTEM_CONFIG,
          },
          deps,
        ),
      ).rejects.toThrow(/lat/)
    })
  })

  describe('multi-array configs', () => {
    // A steep south-facing roof array plus a flatter east-facing roof array
    // (e.g. a smaller secondary roof face) — meaningfully different
    // tilt/azimuth per the issue #54 acceptance criteria.
    const SOUTH_STEEP_ARRAY: PanelArrayConfig = {
      tiltDeg: 40,
      azimuthDeg: 180,
      panelCount: 20,
      wattsPerPanel: 400,
      efficiencyPercent: 21,
      tempCoefficientPercentPerC: -0.34,
      manualShadingPercent: 10,
    }
    const EAST_FLAT_ARRAY: PanelArrayConfig = {
      tiltDeg: 15,
      azimuthDeg: 90,
      panelCount: 10,
      wattsPerPanel: 350,
      efficiencyPercent: 19,
      tempCoefficientPercentPerC: -0.4,
      manualShadingPercent: 5,
    }

    it("sums a multi-array system's output to the sum of each array's standalone contribution", async () => {
      const multiArraySystemConfig: SystemConfig = {
        arrays: [SOUTH_STEEP_ARRAY, EAST_FLAT_ARRAY],
        systemLossesPercent: 14,
      }
      const deps = { fetchForecast: async () => BERLIN_SUMMER_FIXTURE }

      const [combined, southOnly, eastOnly] = await Promise.all([
        runLiveSimulation(
          { location: BERLIN, systemConfig: multiArraySystemConfig },
          deps,
        ),
        runLiveSimulation(
          {
            location: BERLIN,
            systemConfig: {
              arrays: [SOUTH_STEEP_ARRAY],
              systemLossesPercent: 14,
            },
          },
          deps,
        ),
        runLiveSimulation(
          {
            location: BERLIN,
            systemConfig: {
              arrays: [EAST_FLAT_ARRAY],
              systemLossesPercent: 14,
            },
          },
          deps,
        ),
      ])

      const southByTimestamp = new Map(
        southOnly.hourlyWattsSeries.map((p) => [p.timestamp, p.watts]),
      )
      const eastByTimestamp = new Map(
        eastOnly.hourlyWattsSeries.map((p) => [p.timestamp, p.watts]),
      )

      for (const point of combined.hourlyWattsSeries) {
        const expectedWatts =
          (southByTimestamp.get(point.timestamp) ?? 0) +
          (eastByTimestamp.get(point.timestamp) ?? 0)
        expect(point.watts).toBeCloseTo(expectedWatts, 6)
      }

      // Sanity check the fixture actually produces some non-zero daytime
      // output, so the above loop isn't vacuously comparing zeros.
      const middayWatts = combined.hourlyWattsSeries.find(
        (p) => p.timestamp === '2026-06-21T12:00:00Z',
      )!.watts
      expect(middayWatts).toBeGreaterThan(0)
    })

    it('a single-array config wrapped in a one-element arrays array matches the pre-#54 flat-shape output (regression check)', async () => {
      const deps = { fetchForecast: async () => BERLIN_SUMMER_FIXTURE }
      const result = await runLiveSimulation(
        { location: BERLIN, systemConfig: SYSTEM_CONFIG },
        deps,
      )

      const middayWatts = result.hourlyWattsSeries.find(
        (p) => p.timestamp === '2026-06-21T12:00:00Z',
      )!.watts
      const eveningWatts = result.hourlyWattsSeries.find(
        (p) => p.timestamp === '2026-06-21T18:00:00Z',
      )!.watts

      // Same golden reference values as the single-array test above,
      // independently verified against pvlib — confirms summing over an
      // array of length one is a byte-identical no-op.
      expect(middayWatts).toBeCloseTo(4180.5, 1)
      expect(eveningWatts).toBeCloseTo(558.4, 1)
    })
  })
})
