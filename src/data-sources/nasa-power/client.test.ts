import { describe, expect, it, vi } from 'vitest'
import climatologyErrorFixture from './__fixtures__/climatology-error.json'
import climatologyNoDataFixture from './__fixtures__/climatology-no-data.json'
import climatologySuccessFixture from './__fixtures__/climatology-success.json'
import { fetchNasaPowerClimateNormals } from './client.ts'
import { NasaPowerNoDataError, NasaPowerRequestError } from './errors.ts'

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('fetchNasaPowerClimateNormals', () => {
  it('normalizes a successful climatology response into HourlyClimate[]', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(climatologySuccessFixture))

    const result = await fetchNasaPowerClimateNormals({
      latitude: 40.02,
      longitude: -105.27,
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const requestedUrl = new URL(fetchImpl.mock.calls[0][0] as string)
    expect(requestedUrl.origin + requestedUrl.pathname).toBe(
      'https://power.larc.nasa.gov/api/temporal/climatology/point',
    )
    expect(requestedUrl.searchParams.get('latitude')).toBe('40.02')
    expect(requestedUrl.searchParams.get('longitude')).toBe('-105.27')
    expect(requestedUrl.searchParams.get('parameters')).toBe(
      'ALLSKY_SFC_SW_DWN,T2M',
    )

    expect(result).toHaveLength(12)

    // January entry: 2.5212 kWh/m^2/day -> average W/m^2 over the day.
    expect(result[0]).toEqual({
      timestamp: '2001-01-15T12:00:00.000Z',
      temperatureC: -0.56,
      ghiWm2: (2.5212 * 1000) / 24,
    })

    // Entries are in calendar-month order and each has a well-formed ISO
    // timestamp with an increasing month.
    const months = result.map((entry) =>
      new Date(entry.timestamp).getUTCMonth(),
    )
    expect(months).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])

    // All GHI values are non-negative and finite.
    for (const entry of result) {
      expect(Number.isFinite(entry.ghiWm2)).toBe(true)
      expect(entry.ghiWm2).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(entry.temperatureC)).toBe(true)
    }
  })

  it('throws NasaPowerNoDataError when the location has no coverage', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(climatologyNoDataFixture))

    await expect(
      fetchNasaPowerClimateNormals({
        latitude: -85,
        longitude: -140,
        fetchImpl,
      }),
    ).rejects.toThrow(NasaPowerNoDataError)
  })

  it('throws NasaPowerRequestError on a non-2xx API error response', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(climatologyErrorFixture, { status: 422 }))

    await expect(
      fetchNasaPowerClimateNormals({
        latitude: 40,
        longitude: 200,
        fetchImpl,
      }),
    ).rejects.toThrow(NasaPowerRequestError)
  })

  it('throws NasaPowerRequestError on a network failure, distinct from no-data', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('fetch failed'))

    const promise = fetchNasaPowerClimateNormals({
      latitude: 40,
      longitude: -105,
      fetchImpl,
    })

    await expect(promise).rejects.toThrow(NasaPowerRequestError)
    await expect(promise).rejects.not.toBeInstanceOf(NasaPowerNoDataError)
  })

  it('throws NasaPowerRequestError when the response body is missing expected fields', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ properties: {} }))

    await expect(
      fetchNasaPowerClimateNormals({
        latitude: 40,
        longitude: -105,
        fetchImpl,
      }),
    ).rejects.toThrow(NasaPowerRequestError)
  })
})
