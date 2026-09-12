import { describe, expect, it, vi } from 'vitest'
import fixture from './__fixtures__/open-meteo-forecast.json'
import { attenuateForCloudCover, fetchOpenMeteoForecast } from './open-meteo'

function fixtureFetch(body: unknown): typeof fetch {
  return vi.fn(async () =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    }),
  ) as unknown as typeof fetch
}

describe('fetchOpenMeteoForecast', () => {
  it('normalizes the recorded fixture response into HourlyClimate[]', async () => {
    const fetchImpl = fixtureFetch(fixture)

    const result = await fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl })

    expect(result).toHaveLength(fixture.hourly.time.length)
    // Every entry has the shared shape with the right primitive types.
    for (const entry of result) {
      expect(typeof entry.timestamp).toBe('string')
      expect(typeof entry.temperatureC).toBe('number')
      expect(typeof entry.ghiWm2).toBe('number')
      expect(entry.ghiWm2).toBeGreaterThanOrEqual(0)
    }
  })

  it('converts naive Open-Meteo timestamps into UTC ISO 8601 timestamps', async () => {
    const fetchImpl = fixtureFetch(fixture)

    const result = await fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl })

    expect(result[0].timestamp).toBe('2026-06-21T00:00:00Z')
    expect(result[4].timestamp).toBe('2026-06-21T12:00:00Z')
  })

  it('carries temperature through unchanged', async () => {
    const fetchImpl = fixtureFetch(fixture)

    const result = await fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl })

    expect(result.map((r) => r.temperatureC)).toEqual(
      fixture.hourly.temperature_2m,
    )
  })

  it('estimates zero GHI at night regardless of cloud cover', async () => {
    const fetchImpl = fixtureFetch(fixture)

    const result = await fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl })

    // 00:00 and 21:00 UTC are well after sunset / before sunrise in Berlin
    // in June.
    expect(result[0].ghiWm2).toBe(0)
    expect(result[7].ghiWm2).toBe(0)
  })

  it('produces higher GHI for a clearer midday hour than a cloudier one', async () => {
    const fetchImpl = fixtureFetch(fixture)

    const result = await fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl })

    // 12:00 (0% cloud cover) vs 15:00 (20% cloud cover), both daytime.
    const noon = result[4]
    const afternoon = result[5]
    expect(noon.ghiWm2).toBeGreaterThan(afternoon.ghiWm2)
    // Midday clear-sky GHI in June at 52.5N should be in a plausible range.
    expect(noon.ghiWm2).toBeGreaterThan(700)
    expect(noon.ghiWm2).toBeLessThan(1100)
  })

  it('requests the expected hourly variables and clamps forecast_days', async () => {
    const fetchImpl = fixtureFetch(fixture)

    await fetchOpenMeteoForecast(52.52, 13.41, {
      fetchImpl,
      forecastDays: 30,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const calledUrl = new URL(
      (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string,
    )
    expect(calledUrl.origin + calledUrl.pathname).toBe(
      'https://api.open-meteo.com/v1/forecast',
    )
    expect(calledUrl.searchParams.get('hourly')).toBe(
      'temperature_2m,cloud_cover',
    )
    expect(calledUrl.searchParams.get('latitude')).toBe('52.52')
    expect(calledUrl.searchParams.get('longitude')).toBe('13.41')
    expect(calledUrl.searchParams.get('timezone')).toBe('UTC')
    // Clamped to Open-Meteo's documented max of 16.
    expect(calledUrl.searchParams.get('forecast_days')).toBe('16')
  })

  it('throws when the response is not ok', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({}),
      }),
    ) as unknown as typeof fetch

    await expect(
      fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl }),
    ).rejects.toThrow(/429/)
  })
})

describe('attenuateForCloudCover', () => {
  it('returns the clear-sky value unchanged at 0% cloud cover', () => {
    expect(attenuateForCloudCover(800, 0)).toBe(800)
  })

  it('attenuates fully overcast sky per the Kasten & Czeplak curve', () => {
    // At 100% cloud cover the fraction is 1, so attenuation = 1 - 0.75 = 0.25.
    expect(attenuateForCloudCover(800, 100)).toBeCloseTo(800 * 0.25, 5)
  })

  it('is monotonically non-increasing as cloud cover increases', () => {
    const values = [0, 25, 50, 75, 100].map((cc) =>
      attenuateForCloudCover(1000, cc),
    )
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1])
    }
  })

  it('clamps out-of-range cloud cover input', () => {
    expect(attenuateForCloudCover(800, -10)).toBe(800)
    expect(attenuateForCloudCover(800, 150)).toBeCloseTo(800 * 0.25, 5)
  })
})
