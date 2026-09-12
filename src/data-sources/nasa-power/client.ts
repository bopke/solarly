import type { MonthlyClimateNormal } from '../types.ts'
import { NasaPowerNoDataError, NasaPowerRequestError } from './errors.ts'

const POWER_CLIMATOLOGY_URL =
  'https://power.larc.nasa.gov/api/temporal/climatology/point'

/** Default NASA POWER fill value for missing data, per the API docs. */
const DEFAULT_FILL_VALUE = -999

/** Month keys in calendar order, as returned by the climatology endpoint. */
const MONTH_KEYS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const

interface PowerClimatologyResponse {
  properties?: {
    parameter?: {
      ALLSKY_SFC_SW_DWN?: Record<string, number>
      T2M?: Record<string, number>
    }
  }
  /**
   * On a successful response this is an object with `fill_value`. On
   * an error response (e.g. HTTP 422) POWER instead returns `header`
   * as a plain string describing the failure - see
   * `__fixtures__/climatology-error.json`.
   */
  header?: string | { fill_value?: number }
  messages?: string[]
}

export interface FetchNasaPowerClimateNormalsParams {
  latitude: number
  longitude: number
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  /** Optional abort signal, forwarded to `fetchImpl`. */
  signal?: AbortSignal
}

/**
 * Fetches NASA POWER's long-term monthly climate normals (20-year
 * climatological monthly averages) for a location and normalizes them
 * into {@link MonthlyClimateNormal}[] - one entry per calendar month,
 * using POWER's all-sky surface shortwave downward irradiance (GHI)
 * field directly and its 2m air temperature field.
 *
 * See `docs/decisions/0030-nasa-power-client.md` for why the
 * climatology endpoint (rather than the hourly endpoint) was chosen,
 * and `docs/decisions/0035-climate-data-type-split.md` for why this
 * client returns `MonthlyClimateNormal[]` (native kWh/m^2/day units)
 * rather than the hourly-resolution `HourlyClimate` shape.
 *
 * @throws {NasaPowerRequestError} on network failure, a non-2xx
 *   response, or a response that doesn't match the expected shape.
 * @throws {NasaPowerNoDataError} when POWER has no usable climate data
 *   for this location - every calendar month ends up excluded because
 *   its all-sky GHI, its temperature, or both equal POWER's documented
 *   fill value, leaving zero usable months.
 */
export async function fetchNasaPowerClimateNormals({
  latitude,
  longitude,
  fetchImpl = fetch,
  signal,
}: FetchNasaPowerClimateNormalsParams): Promise<MonthlyClimateNormal[]> {
  const url = new URL(POWER_CLIMATOLOGY_URL)
  url.searchParams.set('parameters', 'ALLSKY_SFC_SW_DWN,T2M')
  url.searchParams.set('community', 'RE')
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('format', 'JSON')

  let response: Response
  try {
    response = await fetchImpl(url.toString(), { signal })
  } catch (cause) {
    throw new NasaPowerRequestError(
      `Network error fetching NASA POWER climatology data: ${String(cause)}`,
      { cause },
    )
  }

  if (!response.ok) {
    // Try to pull POWER's own error message out of the body, but don't
    // let a non-JSON error body (e.g. a gateway's HTML error page)
    // discard the HTTP status we already know.
    let detail = `HTTP ${response.status}`
    try {
      const errorBody = (await response.json()) as Pick<
        PowerClimatologyResponse,
        'messages'
      >
      if (errorBody.messages?.length) {
        detail = errorBody.messages.join(' ')
      }
    } catch {
      // Body wasn't JSON (or was empty) - fall back to the HTTP status.
    }
    throw new NasaPowerRequestError(`NASA POWER API request failed: ${detail}`)
  }

  let body: PowerClimatologyResponse
  try {
    body = (await response.json()) as PowerClimatologyResponse
  } catch (cause) {
    throw new NasaPowerRequestError('NASA POWER response was not valid JSON.', {
      cause,
    })
  }

  const ghiByMonth = body.properties?.parameter?.ALLSKY_SFC_SW_DWN
  const tempByMonth = body.properties?.parameter?.T2M
  if (!ghiByMonth || !tempByMonth) {
    throw new NasaPowerRequestError(
      'NASA POWER response is missing expected ALLSKY_SFC_SW_DWN/T2M data.',
    )
  }

  const fillValue =
    (typeof body.header === 'object' ? body.header?.fill_value : undefined) ??
    DEFAULT_FILL_VALUE
  const isFill = (value: number | undefined): boolean =>
    value === undefined || value === fillValue

  const result: MonthlyClimateNormal[] = []
  MONTH_KEYS.forEach((month, index) => {
    const dailyInsolationKWhM2 = ghiByMonth[month]
    const temperatureC = tempByMonth[month]
    if (isFill(dailyInsolationKWhM2) || isFill(temperatureC)) {
      // Partial coverage for this month only (GHI, temperature, or
      // both are POWER's fill sentinel) - skip it rather than
      // fabricating a value; downstream consumers get a shorter series
      // instead of a silently wrong one.
      return
    }

    result.push({
      month: index + 1,
      temperatureC,
      dailyInsolationKWhM2,
    })
  })

  // Every month may have been dropped above even though the two
  // parameters' fill months don't line up 1:1 - e.g. GHI is all-fill
  // (SYN1DEG has no coverage here) while temperature is entirely real
  // (MERRA2 does), or vice versa. Whatever the cause, zero usable
  // months means this location has no usable climate data, so this is
  // the single, robust trigger for NasaPowerNoDataError rather than
  // trying to special-case which parameter was at fault.
  if (result.length === 0) {
    throw new NasaPowerNoDataError(
      `NASA POWER has no climate data for location (${latitude}, ${longitude}). This location is likely outside POWER's data coverage (e.g. open ocean or polar gaps).`,
      latitude,
      longitude,
    )
  }

  return result
}
