import { describe, expect, it } from 'vitest'
import { runLiveSimulation } from './runLiveSimulation'
import type { HourlyClimate } from '../data-sources'

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

const SYSTEM_CONFIG = {
  tiltDeg: 35,
  azimuthDeg: 180,
  panelCount: 20,
  wattsPerPanel: 400,
  efficiencyPercent: 21,
  tempCoefficientPercentPerC: -0.34,
  systemLossesPercent: 14,
  manualShadingPercent: 10,
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
    // this margin), and the sunniest midday hour should be a substantial
    // fraction of it after losses/shading.
    const ratedWattsPeak =
      SYSTEM_CONFIG.panelCount * SYSTEM_CONFIG.wattsPerPanel
    for (const watts of byTimestamp.values()) {
      expect(watts).toBeLessThan(ratedWattsPeak * 1.2)
    }

    const middayWatts = byTimestamp.get('2026-06-21T12:00:00Z')!
    expect(middayWatts).toBeGreaterThan(ratedWattsPeak * 0.3)

    // Power should rise from sunrise toward the midday peak.
    const morningWatts = byTimestamp.get('2026-06-21T05:00:00Z')!
    const lateMorningWatts = byTimestamp.get('2026-06-21T09:00:00Z')!
    expect(lateMorningWatts).toBeGreaterThan(morningWatts)
    expect(middayWatts).toBeGreaterThan(lateMorningWatts)
  })

  it('applies manual shading as an additional multiplicative derate on top of system losses', async () => {
    const baseInput = { location: BERLIN, systemConfig: SYSTEM_CONFIG }
    const noShadingConfig = { ...SYSTEM_CONFIG, manualShadingPercent: 0 }
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
})
