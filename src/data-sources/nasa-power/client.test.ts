import { describe, expect, it, vi } from 'vitest'
import climatologyErrorFixture from './__fixtures__/climatology-error.json'
import climatologyGhiMissingFixture from './__fixtures__/climatology-ghi-missing.json'
import climatologyNoDataFixture from './__fixtures__/climatology-no-data.json'
import climatologyPolarZeroGhiFixture from './__fixtures__/climatology-polar-zero-ghi.json'
import climatologySuccessFixture from './__fixtures__/climatology-success.json'
import climatologyTemperatureMissingFixture from './__fixtures__/climatology-temperature-missing.json'
import { fetchNasaPowerClimateNormals } from './client.ts'
import { NasaPowerNoDataError, NasaPowerRequestError } from './errors.ts'

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('fetchNasaPowerClimateNormals', () => {
  it('normalizes a successful climatology response into MonthlyClimateNormal[]', async () => {
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
    expect(requestedUrl.searchParams.get('community')).toBe('RE')
    expect(requestedUrl.searchParams.get('format')).toBe('JSON')

    expect(result).toHaveLength(12)

    // January entry: POWER's native kWh/m^2/day unit, kept as-is.
    expect(result[0]).toEqual({
      month: 1,
      temperatureC: -0.56,
      dailyInsolationKWhM2: 2.5212,
    })

    // Entries are in calendar-month order, 1 (January) through 12
    // (December).
    expect(result.map((entry) => entry.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])

    // All values are non-negative and finite.
    for (const entry of result) {
      expect(Number.isFinite(entry.dailyInsolationKWhM2)).toBe(true)
      expect(entry.dailyInsolationKWhM2).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(entry.temperatureC)).toBe(true)
    }
  })

  it('preserves a real 0.0 GHI value (polar winter) rather than treating it as fill', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(climatologyPolarZeroGhiFixture))

    const result = await fetchNasaPowerClimateNormals({
      latitude: -85,
      longitude: -140,
      fetchImpl,
    })

    expect(result).toHaveLength(12)
    const june = result.find((entry) => entry.month === 6)
    expect(june).toEqual({
      month: 6,
      temperatureC: -59.7,
      dailyInsolationKWhM2: 0,
    })
  })

  it('throws NasaPowerNoDataError when the location has no coverage in either parameter', async () => {
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

  it('throws NasaPowerNoDataError when GHI is all-fill even though temperature has real data for every month', async () => {
    // Regression test: ALLSKY_SFC_SW_DWN and T2M are backed by
    // different underlying datasets (SYN1DEG vs MERRA2) and can have
    // independently different coverage. Previously, the per-month loop
    // dropped a month if *either* field was fill while the "all
    // missing" guard required *both* to be fill for every month - so
    // this exact case (GHI all-fill, temperature all real) fell
    // through the guard and resolved with an empty array instead of
    // throwing.
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(climatologyGhiMissingFixture))

    await expect(
      fetchNasaPowerClimateNormals({
        latitude: 40.02,
        longitude: -105.27,
        fetchImpl,
      }),
    ).rejects.toThrow(NasaPowerNoDataError)
  })

  it('throws NasaPowerNoDataError when temperature is all-fill even though GHI has real data for every month', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(climatologyTemperatureMissingFixture))

    await expect(
      fetchNasaPowerClimateNormals({
        latitude: 40.02,
        longitude: -105.27,
        fetchImpl,
      }),
    ).rejects.toThrow(NasaPowerNoDataError)
  })

  it('drops only the affected months when fill is partial across both parameters', async () => {
    interface ClimatologyFixture {
      properties: {
        parameter: {
          ALLSKY_SFC_SW_DWN: Record<string, number>
          T2M: Record<string, number>
        }
      }
    }
    const partial = structuredClone(
      climatologySuccessFixture,
    ) as unknown as ClimatologyFixture
    // JAN: GHI fill only. FEB: temperature fill only. Both months
    // should be dropped, the other 10 kept.
    partial.properties.parameter.ALLSKY_SFC_SW_DWN.JAN = -999
    partial.properties.parameter.T2M.FEB = -999

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(partial))

    const result = await fetchNasaPowerClimateNormals({
      latitude: 40.02,
      longitude: -105.27,
      fetchImpl,
    })

    expect(result).toHaveLength(10)
    expect(result.map((entry) => entry.month)).not.toContain(1)
    expect(result.map((entry) => entry.month)).not.toContain(2)
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

  it('throws NasaPowerRequestError with the HTTP status when a non-2xx body is not valid JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    )

    await expect(
      fetchNasaPowerClimateNormals({
        latitude: 40,
        longitude: -105,
        fetchImpl,
      }),
    ).rejects.toThrow(/HTTP 502/)
  })

  it('forwards an AbortSignal to fetchImpl', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(climatologySuccessFixture))
    const controller = new AbortController()

    await fetchNasaPowerClimateNormals({
      latitude: 40.02,
      longitude: -105.27,
      fetchImpl,
      signal: controller.signal,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
  })
})
