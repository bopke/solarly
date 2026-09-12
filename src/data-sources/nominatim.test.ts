import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { geocode as GeocodeFn } from './nominatim'
import berlinFixture from './fixtures/nominatim-search-berlin.json'
import emptyFixture from './fixtures/nominatim-search-empty.json'

// The Nominatim client keeps a module-level throttle singleton so that all
// callers in the tab share the same rate limit. Reset modules and
// re-import between tests so each test gets a fresh throttle (no leftover
// "last request" timestamp bleeding into the next test's assertions).
let geocode: typeof GeocodeFn

function mockFetchOnce(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
) {
  const { ok = true, status = 200 } = init
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * geocode() throttles its own requests (see rate-limit.ts), so calling it
 * under fake timers requires letting pending timers flush before awaiting
 * the result. This helper does that.
 */
async function callGeocode(
  ...args: Parameters<typeof geocode>
): Promise<ReturnType<typeof geocode>> {
  const promise = geocode(...args)
  await vi.runAllTimersAsync()
  return promise
}

describe('geocode', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    // Reset modules so each test gets a fresh throttle singleton (see the
    // comment above) instead of inheriting the previous test's timestamp.
    vi.resetModules()
    ;({ geocode } = await import('./nominatim'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns normalized results for a matching query', async () => {
    mockFetchOnce(berlinFixture)

    const results = await callGeocode('Berlin')

    expect(results).toEqual([
      { lat: 52.5170365, lon: 13.3888599, displayName: 'Berlin, Germany' },
      {
        lat: 44.4780568,
        lon: -93.0298187,
        displayName:
          'Berlin Street, Saint Paul, Ramsey County, Minnesota, 55107, United States',
      },
    ])
  })

  it('returns an empty array (not a throw) for a no-match query', async () => {
    mockFetchOnce(emptyFixture)

    await expect(callGeocode('asdkjhqwlekjhasdkjhasdkjh')).resolves.toEqual([])
  })

  it('returns an empty array for a blank query without calling fetch', async () => {
    const fetchMock = mockFetchOnce(emptyFixture)

    await expect(callGeocode('   ')).resolves.toEqual([])

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects on a non-OK HTTP response', async () => {
    mockFetchOnce([], { ok: false, status: 503 })

    const promise = geocode('Berlin')
    const assertion = expect(promise).rejects.toThrow(/503/)
    await vi.runAllTimersAsync()

    await assertion
  })

  it('rejects on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )

    const promise = geocode('Berlin')
    const assertion = expect(promise).rejects.toThrow(
      /Nominatim geocoding request failed/,
    )
    await vi.runAllTimersAsync()

    await assertion
  })

  it('requests jsonv2 format and an identifying Accept header', async () => {
    const fetchMock = mockFetchOnce(berlinFixture)

    await callGeocode('Berlin')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('nominatim.openstreetmap.org/search')
    expect(url).toContain('format=jsonv2')
    expect(url).toContain('q=Berlin')
    expect((requestInit.headers as Record<string, string>).Accept).toBe(
      'application/json',
    )
  })

  it('throttles consecutive requests to roughly 1 per second', async () => {
    const fetchMock = mockFetchOnce(berlinFixture)

    const first = geocode('Berlin')
    const second = geocode('Munich')

    // Only the first request should have gone out before the throttle
    // interval elapses.
    await vi.advanceTimersByTimeAsync(100)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1100)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await Promise.all([first, second])
  })
})
