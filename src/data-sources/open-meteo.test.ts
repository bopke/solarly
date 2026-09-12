import { describe, expect, it, vi } from 'vitest'
// This fixture is synthetic, illustrative data shaped like a real
// Open-Meteo `/v1/forecast` response (1-hour spacing, a null-padded tail
// hour), NOT a captured/recorded live response. Values are hand-picked to
// exercise day/night and clear/cloudy behavior predictably; they are not
// observed irradiance or temperature readings.
import fixture from './__fixtures__/open-meteo-forecast.json'
import { fetchOpenMeteoForecast } from './open-meteo'

function fixtureFetch(
  body: unknown,
  init: Partial<Response> = {},
): typeof fetch {
  return vi.fn(async () =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      ...init,
    }),
  ) as unknown as typeof fetch
}

describe('fetchOpenMeteoForecast', () => {
  it('normalizes the synthetic fixture response into HourlyClimate[], dropping null-padded hours', async () => {
    const fetchImpl = fixtureFetch(fixture)

    const result = await fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl })

    // The fixture has 24 hours, one of which (23:00) has a null
    // shortwave_radiation value and should be dropped.
    const expectedLength = fixture.hourly.time.length - 1
    expect(result).toHaveLength(expectedLength)
    expect(
      result.some((entry) => entry.timestamp === '2026-06-21T23:00:00Z'),
    ).toBe(false)
    // Every remaining entry has the shared shape with the right primitive
    // types (no `null` leaking through a `number`-typed field).
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
    expect(result[12].timestamp).toBe('2026-06-21T12:00:00Z')
  })

  it('uses shortwave_radiation directly as GHI, with a pinned golden value', async () => {
    const fetchImpl = fixtureFetch(fixture)

    const result = await fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl })

    const noon = result.find((r) => r.timestamp === '2026-06-21T12:00:00Z')
    expect(noon?.ghiWm2).toBe(881.19)
  })

  it('carries temperature through unchanged for non-null hours', async () => {
    const fetchImpl = fixtureFetch(fixture)

    const result = await fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl })

    expect(result.map((r) => r.temperatureC)).toEqual(
      fixture.hourly.temperature_2m.slice(0, -1),
    )
  })

  it('is zero (not negative or missing) GHI at night', async () => {
    const fetchImpl = fixtureFetch(fixture)

    const result = await fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl })

    expect(result[0].ghiWm2).toBe(0)
    expect(result[1].ghiWm2).toBe(0)
  })

  it('produces higher GHI at noon than mid-afternoon', async () => {
    const fetchImpl = fixtureFetch(fixture)

    const result = await fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl })

    const noon = result.find((r) => r.timestamp === '2026-06-21T12:00:00Z')
    const afternoon = result.find((r) => r.timestamp === '2026-06-21T15:00:00Z')
    expect(noon?.ghiWm2).toBeGreaterThan(afternoon?.ghiWm2 ?? Infinity)
  })

  it('requests the expected hourly variables', async () => {
    const fetchImpl = fixtureFetch(fixture)

    await fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const calledUrl = new URL(
      (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string,
    )
    expect(calledUrl.origin + calledUrl.pathname).toBe(
      'https://api.open-meteo.com/v1/forecast',
    )
    expect(calledUrl.searchParams.get('hourly')).toBe(
      'temperature_2m,shortwave_radiation',
    )
    expect(calledUrl.searchParams.get('latitude')).toBe('52.52')
    expect(calledUrl.searchParams.get('longitude')).toBe('13.41')
    expect(calledUrl.searchParams.get('timezone')).toBe('UTC')
    expect(calledUrl.searchParams.get('forecast_days')).toBe('7')
  })

  it('clamps forecast_days to the documented [1, 16] range', async () => {
    const fetchImpl = fixtureFetch(fixture)

    await fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl, forecastDays: 30 })

    const calledUrl = new URL(
      (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string,
    )
    expect(calledUrl.searchParams.get('forecast_days')).toBe('16')
  })

  it('clamps forecast_days below 1 up to the minimum', async () => {
    const fetchImpl = fixtureFetch(fixture)

    await fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl, forecastDays: 0 })

    const calledUrl = new URL(
      (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string,
    )
    expect(calledUrl.searchParams.get('forecast_days')).toBe('1')
  })

  it('rejects a fractional forecastDays', async () => {
    const fetchImpl = fixtureFetch(fixture)

    await expect(
      fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl, forecastDays: 3.7 }),
    ).rejects.toThrow(/finite integer/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a NaN forecastDays', async () => {
    const fetchImpl = fixtureFetch(fixture)

    await expect(
      fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl, forecastDays: NaN }),
    ).rejects.toThrow(/finite integer/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws a clear error when the response is missing the hourly field', async () => {
    const fetchImpl = fixtureFetch({ latitude: 52.52, longitude: 13.41 })

    await expect(
      fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl }),
    ).rejects.toThrow(/missing the 'hourly' field/)
  })

  it('throws a clear error when hourly arrays have mismatched lengths', async () => {
    const malformed = {
      ...fixture,
      hourly: {
        ...fixture.hourly,
        temperature_2m: fixture.hourly.temperature_2m.slice(0, 3),
      },
    }
    const fetchImpl = fixtureFetch(malformed)

    await expect(
      fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl }),
    ).rejects.toThrow(/mismatched lengths/)
  })

  it('surfaces the reason from an Open-Meteo error response body', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve({
        ok: false,
        status: 400,
        statusText: '',
        json: async () => ({
          error: true,
          reason: 'Latitude must be in range of -90 to 90',
        }),
      }),
    ) as unknown as typeof fetch

    await expect(
      fetchOpenMeteoForecast(200, 13.41, { fetchImpl }),
    ).rejects.toThrow(/Latitude must be in range of -90 to 90/)
  })

  it('still throws a useful error when the error body is not JSON', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => {
          throw new Error('not json')
        },
      }),
    ) as unknown as typeof fetch

    await expect(
      fetchOpenMeteoForecast(52.52, 13.41, { fetchImpl }),
    ).rejects.toThrow(/429/)
  })
})
