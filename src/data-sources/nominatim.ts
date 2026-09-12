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

// See docs/decisions/0050-nominatim-client.md for why this is a query
// param rather than a `User-Agent` header, and why it's optional.
const CONTACT_EMAIL = import.meta.env.VITE_NOMINATIM_CONTACT_EMAIL as
  string | undefined

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
 * - Requests are throttled client-side to at most ~1/second, per
 *   Nominatim's public-instance usage policy.
 */
export async function geocode(
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<GeocodeResult[]> {
  const trimmed = query.trim()
  if (!trimmed) {
    return []
  }

  return scheduleNominatimRequest(async () => {
    const url = new URL(NOMINATIM_SEARCH_URL)
    url.searchParams.set('q', trimmed)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', '10')
    if (CONTACT_EMAIL) {
      // Nominatim's documented `email` param — see the ADR for why this
      // stands in for a User-Agent header, which browser fetch cannot set.
      url.searchParams.set('email', CONTACT_EMAIL)
    }

    let response: Response
    try {
      response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: options.signal,
      })
    } catch (cause) {
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
        (result) => Number.isFinite(result.lat) && Number.isFinite(result.lon),
      )
  })
}
