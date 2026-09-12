import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { geocode as GeocodeFn } from './nominatim'
import berlinFixture from './fixtures/nominatim-search-berlin.json'
import emptyFixture from './fixtures/nominatim-search-empty.json'

// The Nominatim client keeps a module-level throttle singleton so that all
// callers in the tab share the same rate limit. Reset modules and
// re-import between tests so each test gets a fresh throttle (no leftover
// "last request" timestamp bleeding into the next test's assertions).
let geocode: typeof GeocodeFn

/**
 * Stubs `fetch` to resolve with the same response on every call (note:
 * despite the similarly-named Vitest `mockResolvedValueOnce`, this mock
 * answers *every* call, which the throttling test below relies on).
 */
function mockFetchAlways(
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
    mockFetchAlways(berlinFixture)

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
    mockFetchAlways(emptyFixture)

    await expect(callGeocode('asdkjhqwlekjhasdkjhasdkjh')).resolves.toEqual([])
  })

  it('returns an empty array for a blank query without calling fetch', async () => {
    const fetchMock = mockFetchAlways(emptyFixture)

    await expect(callGeocode('   ')).resolves.toEqual([])

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects on a non-OK HTTP response', async () => {
    mockFetchAlways([], { ok: false, status: 503 })

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

  it('requests jsonv2 format with an Accept header and the query param', async () => {
    const fetchMock = mockFetchAlways(berlinFixture)

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
    const fetchMock = mockFetchAlways(berlinFixture)

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

  it('caches results for repeated (normalized) queries instead of re-fetching', async () => {
    const fetchMock = mockFetchAlways(berlinFixture)

    const first = await callGeocode('Berlin')
    // Different casing/whitespace should still hit the cache.
    const second = await geocode('  BERLIN  ')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('does not cache across different limit values', async () => {
    const fetchMock = mockFetchAlways(berlinFixture)

    await callGeocode('Berlin')
    await callGeocode('Berlin', { limit: 5 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns a fresh array each time so one caller mutating it does not affect another', async () => {
    mockFetchAlways(berlinFixture)

    const first = await callGeocode('Berlin')
    first.push({ lat: 0, lon: 0, displayName: 'mutated by caller' })
    const second = await geocode('Berlin')

    expect(second).not.toBe(first)
    expect(second).toHaveLength(2)
  })

  it('deduplicates concurrent identical queries into a single fetch', async () => {
    const fetchMock = mockFetchAlways(berlinFixture)

    const [first, second] = await Promise.all([
      callGeocode('Berlin'),
      geocode('Berlin'),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('preserves AbortError identity when the caller aborts a queued request', async () => {
    const fetchMock = mockFetchAlways(berlinFixture)
    const controller = new AbortController()

    const first = geocode('Berlin')
    const second = geocode('Munich', { signal: controller.signal })
    const third = geocode('Paris')
    // Attach the rejection assertion up front so it "handles" the
    // rejection the instant it happens, rather than after the fact.
    const secondAssertion = expect(second).rejects.toMatchObject({
      name: 'AbortError',
    })

    // Let the first request go out; the second is now waiting in the
    // throttle queue for its slot.
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    controller.abort()
    await vi.advanceTimersByTimeAsync(0)

    await secondAssertion
    // Aborting while queued must not itself trigger a fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // The third request should still fire ~1100ms after the first started,
    // not delayed further by the aborted second one.
    await vi.advanceTimersByTimeAsync(1100)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await first
    await third
  })

  it('rejects immediately with an AbortError if the signal is already aborted', async () => {
    const fetchMock = mockFetchAlways(berlinFixture)
    const controller = new AbortController()
    controller.abort()

    const promise = geocode('Berlin', { signal: controller.signal })
    const assertion = expect(promise).rejects.toMatchObject({
      name: 'AbortError',
    })
    await vi.runAllTimersAsync()

    await assertion
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a timeout that fires while queued (not during fetch) as AbortError, not TimeoutError', async () => {
    // Regression test for the reviewer-reported bug: AbortSignal.timeout()
    // fires with a DOMException named 'TimeoutError', which is still
    // `instanceof Error`. rate-limit.ts's normalization used to return
    // such reasons unchanged, so a request whose timeout fired while it
    // was still waiting in the throttle queue (rather than during fetch)
    // leaked as name === 'TimeoutError' instead of the documented
    // 'AbortError'. Real timers are required: AbortSignal.timeout() and
    // the throttle's real spacing must both actually elapse.
    vi.useRealTimers()
    mockFetchAlways(berlinFixture)

    // Occupies the throttle immediately (module default spacing is
    // 1100ms), so the second call is queued behind it.
    const first = geocode('Berlin')
    // Queued behind `first`; its 20ms timeout fires long before its turn
    // (~1100ms away) comes up.
    const second = geocode('Munich', { timeoutMs: 20 })

    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    await first
  })

  it('reproduces a burst of queued requests timing out as AbortError, not TimeoutError', async () => {
    // Scaled-down version of the reviewer's 12-query-burst repro: with a
    // per-request timeout shorter than the cumulative queue wait, later
    // requests in the burst time out before reaching fetch. They must
    // still surface as name === 'AbortError', matching the documented
    // contract, never the raw 'TimeoutError'.
    vi.useRealTimers()
    mockFetchAlways(berlinFixture)

    const queries = ['a', 'b', 'c', 'd', 'e', 'f']
    const outcomes = await Promise.all(
      queries.map((q) =>
        geocode(q, { timeoutMs: 2500 }).then(
          () => 'ok',
          (err: Error) => err.name,
        ),
      ),
    )

    // Module throttle spacing is 1100ms; with a 2500ms per-request
    // timeout, requests 4+ in the queue (starting ~3300ms+) never get a
    // turn before their own clock fires.
    expect(outcomes).not.toContain('TimeoutError')
    expect(outcomes.some((o) => o === 'AbortError')).toBe(true)
  }, 10000)

  it('times out a stalled request instead of hanging the queue forever', async () => {
    vi.useRealTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            // Mimic real fetch: never settle on its own, but reject once
            // the request signal aborts (from our own timeout, here).
            init.signal?.addEventListener('abort', () => {
              reject(init.signal?.reason)
            })
          }),
      ),
    )

    const promise = geocode('Berlin', { timeoutMs: 20 })
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})
