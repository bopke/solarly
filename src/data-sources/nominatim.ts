import { createThrottle } from './rate-limit'

/**
 * A single geocoding match, normalized from Nominatim's response shape.
 */
export interface GeocodeResult {
  lat: number
  lon: number
  displayName: string
}

/** Shape of one entry in Nominatim's `/search` JSON response (subset). */
interface NominatimSearchEntry {
  lat: string
  lon: string
  display_name: string
}

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'

// Nominatim's public-instance usage policy asks for a max of 1 request per
// second. We pad slightly beyond 1000ms to leave headroom for clock drift
// between our `Date.now()` checks and the server's own accounting.
const MIN_REQUEST_INTERVAL_MS = 1100

// Default number of results Nominatim returns per query, when the caller
// doesn't override it via `options.limit`.
const DEFAULT_RESULT_LIMIT = 10

// How long a single geocode request (queue wait + fetch) is allowed to
// take before we give up on it. Without this, a `fetch` call that never
// settles would wedge the shared throttle queue for every caller in the
// tab until page reload (the throttle is a module-level singleton).
const REQUEST_TIMEOUT_MS = 9000

// Nominatim's usage policy requires results to be cached client-side
// ("Results must be cached on your side. Clients sending repeatedly the
// same query may be classified as faulty and blocked."). A location
// search box is exactly the kind of caller that resends identical queries
// (retype, backspace-and-retype, re-search the same place), so this is a
// hard requirement, not an optimization.
//
// This is intentionally a plain in-memory Map with no TTL and no
// persistence: it lives for the lifetime of the page/tab and is cleared
// on reload. That's sufficient to satisfy the "don't repeat identical
// queries" policy clause for M1; a persistent (e.g. localStorage) cache
// was judged unnecessary complexity for now. See
// docs/decisions/0050-nominatim-client.md.
const resultCache = new Map<string, GeocodeResult[]>()

function cacheKey(normalizedQuery: string, limit: number): string {
  return JSON.stringify([normalizedQuery, limit])
}

// See docs/decisions/0050-nominatim-client.md for why this is a query
// param rather than a `User-Agent` header, and why it's optional.
//
// Defaults to the project's own contact address so requests identify
// Solarly out of the box; set VITE_NOMINATIM_CONTACT_EMAIL in the
// environment to override it (e.g. for a fork or a different deployment).
const DEFAULT_CONTACT_EMAIL = 'contact@bopke.dev'
const CONTACT_EMAIL: string =
  (import.meta.env.VITE_NOMINATIM_CONTACT_EMAIL as string | undefined) ||
  DEFAULT_CONTACT_EMAIL

// Serializes all geocode() calls (from any caller in this tab) so that,
// combined, they never exceed MIN_REQUEST_INTERVAL_MS between requests.
const scheduleNominatimRequest = createThrottle(MIN_REQUEST_INTERVAL_MS)

/**
 * Geocodes a free-text address/place query via Nominatim (OpenStreetMap).
 *
 * - Returns an empty array (never throws) when the query is blank or when
 *   Nominatim finds no matches — callers can show an inline "no results"
 *   message rather than handling an error path.
 * - Rejects only for genuine network failures or non-OK HTTP responses
 *   (e.g. Nominatim being down or rate-limiting us at the HTTP level).
 * - Rejects with an `Error` whose `name === 'AbortError'` if `options.signal`
 *   fires or the request times out — whether that happens while the request
 *   is still waiting in the shared throttle queue or during the `fetch`
 *   itself — so callers can distinguish cancellation from a real failure
 *   via `err.name === 'AbortError'` in every case.
 * - Requests are throttled client-side to at most ~1/second, per
 *   Nominatim's public-instance usage policy, and identical (normalized)
 *   queries are served from an in-memory cache rather than re-fetched, per
 *   the same policy's caching requirement.
 * - Returned arrays are copies: mutating a result you got back from one
 *   call (sorting, pushing, etc.) never affects what other callers see for
 *   the same cached query.
 *
 * NOTE: Nominatim's usage policy also requires attribution ("Clearly
 * display attribution as suitable for your medium") wherever results are
 * shown. This module does not render UI, so it's not done here — whoever
 * builds the location picker in `src/ui/` must surface OSM/Nominatim
 * attribution in the picker/results UI.
 */
export async function geocode(
  query: string,
  options: { signal?: AbortSignal; limit?: number; timeoutMs?: number } = {},
): Promise<GeocodeResult[]> {
  const trimmed = query.trim()
  if (!trimmed) {
    return []
  }

  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const normalizedQuery = trimmed.toLowerCase()
  const key = cacheKey(normalizedQuery, limit)

  const cached = resultCache.get(key)
  if (cached) {
    return [...cached]
  }

  // Bound the whole request (queue wait + fetch) with a timeout, combined
  // with any caller-provided signal so either can cancel it. Overridable
  // (mainly for tests) via `options.timeoutMs`.
  const timeoutSignal = AbortSignal.timeout(
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  )
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal

  const request = scheduleNominatimRequest(async () => {
    const url = new URL(NOMINATIM_SEARCH_URL)
    url.searchParams.set('q', trimmed)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', String(limit))
    // Nominatim's documented `email` param — see the ADR for why this
    // stands in for a User-Agent header, which browser fetch cannot set.
    // Always set: CONTACT_EMAIL always has a value (falls back to
    // DEFAULT_CONTACT_EMAIL when unset in the environment).
    url.searchParams.set('email', CONTACT_EMAIL)

    let response: Response
    try {
      response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        signal,
      })
    } catch (cause) {
      // Preserve abort identity so callers can do
      // `err.name === 'AbortError'` rather than getting a generic wrapped
      // error. `signal.aborted` (rather than inspecting `cause.name`
      // directly) covers both a caller's own `AbortController.abort()`
      // (whose rejection is named `AbortError`) and our own
      // `AbortSignal.timeout()` (whose rejection is named `TimeoutError`)
      // — from a caller's point of view both mean "this didn't fail, it
      // was cancelled," so both are normalized to `AbortError`.
      if (signal.aborted) {
        const message = cause instanceof Error ? cause.message : String(cause)
        const abortError = new Error(message, { cause })
        abortError.name = 'AbortError'
        throw abortError
      }
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new Error(`Nominatim geocoding request failed: ${message}`, {
        cause,
      })
    }

    if (!response.ok) {
      throw new Error(
        `Nominatim geocoding request failed with status ${response.status}`,
      )
    }

    const data: unknown = await response.json()
    if (!Array.isArray(data)) {
      return []
    }

    return (data as NominatimSearchEntry[])
      .map((entry) => ({
        lat: Number(entry.lat),
        lon: Number(entry.lon),
        displayName: entry.display_name,
      }))
      .filter(
        (result): result is GeocodeResult =>
          Number.isFinite(result.lat) &&
          Number.isFinite(result.lon) &&
          typeof result.displayName === 'string',
      )
  }, signal)

  const results = await request
  resultCache.set(key, results)
  return [...results]
}
