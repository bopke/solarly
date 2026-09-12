import type { HourlyClimate } from '../types.ts'
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

/**
 * Reference (non-leap) year used to build a timestamp for each monthly
 * normal. Climate normals aren't tied to any specific year, so this is
 * an arbitrary but fixed anchor purely to give each sample an ISO
 * timestamp the rest of the app's time-series machinery can sort/plot.
 */
const REFERENCE_YEAR = 2001

interface PowerClimatologyResponse {
  properties?: {
    parameter?: {
      ALLSKY_SFC_SW_DWN?: Record<string, number>
      T2M?: Record<string, number>
    }
  }
  header?: {
    fill_value?: number
  }
  messages?: string[]
}

export interface FetchNasaPowerClimateNormalsParams {
  latitude: number
  longitude: number
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

/**
 * Fetches NASA POWER's long-term monthly climate normals (20-year
 * climatological monthly averages) for a location and normalizes them
 * into the shared {@link HourlyClimate} shape - one entry per calendar
 * month, using POWER's all-sky surface shortwave downward irradiance
 * (GHI) field directly and its 2m air temperature field.
 *
 * See `docs/decisions/0030-nasa-power-client.md` for why the
 * climatology endpoint (rather than the hourly endpoint) was chosen,
 * and how GHI's native kWh/m^2/day unit is converted to the shared
 * shape's average-W/m^2 field.
 *
 * @throws {NasaPowerRequestError} on network failure, a non-2xx
 *   response, or a response that doesn't match the expected shape.
 * @throws {NasaPowerNoDataError} when POWER has no usable climate data
 *   for this location (all-sky GHI or temperature is POWER's documented
 *   fill value for every month).
 */
export async function fetchNasaPowerClimateNormals({
  latitude,
  longitude,
  fetchImpl = fetch,
}: FetchNasaPowerClimateNormalsParams): Promise<HourlyClimate[]> {
  const url = new URL(POWER_CLIMATOLOGY_URL)
  url.searchParams.set('parameters', 'ALLSKY_SFC_SW_DWN,T2M')
  url.searchParams.set('community', 'RE')
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('format', 'JSON')

  let response: Response
  try {
    response = await fetchImpl(url.toString())
  } catch (cause) {
    throw new NasaPowerRequestError(
      `Network error fetching NASA POWER climatology data: ${String(cause)}`,
      { cause },
    )
  }

  let body: PowerClimatologyResponse
  try {
    body = (await response.json()) as PowerClimatologyResponse
  } catch (cause) {
    throw new NasaPowerRequestError('NASA POWER response was not valid JSON.', {
      cause,
    })
  }

  if (!response.ok) {
    const detail = body.messages?.join(' ') ?? `HTTP ${response.status}`
    throw new NasaPowerRequestError(`NASA POWER API request failed: ${detail}`)
  }

  const ghiByMonth = body.properties?.parameter?.ALLSKY_SFC_SW_DWN
  const tempByMonth = body.properties?.parameter?.T2M
  if (!ghiByMonth || !tempByMonth) {
    throw new NasaPowerRequestError(
      'NASA POWER response is missing expected ALLSKY_SFC_SW_DWN/T2M data.',
    )
  }

  const fillValue = body.header?.fill_value ?? DEFAULT_FILL_VALUE
  const isFill = (value: number | undefined): boolean =>
    value === undefined || value === fillValue

  const allMonthsMissing = MONTH_KEYS.every(
    (month) => isFill(ghiByMonth[month]) && isFill(tempByMonth[month]),
  )
  if (allMonthsMissing) {
    throw new NasaPowerNoDataError(
      `NASA POWER has no climate data for location (${latitude}, ${longitude}). This location is likely outside POWER's data coverage (e.g. open ocean or polar gaps).`,
      latitude,
      longitude,
    )
  }

  const result: HourlyClimate[] = []
  MONTH_KEYS.forEach((month, index) => {
    const ghiKwhPerM2PerDay = ghiByMonth[month]
    const temperatureC = tempByMonth[month]
    if (isFill(ghiKwhPerM2PerDay) || isFill(temperatureC)) {
      // Partial coverage for this month only - skip it rather than
      // fabricating a value; downstream consumers get a shorter series
      // instead of a silently wrong one.
      return
    }

    const timestamp = new Date(
      Date.UTC(REFERENCE_YEAR, index, 15, 12, 0, 0),
    ).toISOString()

    result.push({
      timestamp,
      temperatureC,
      // POWER reports GHI as a daily total, kWh/m^2/day. Convert to an
      // average W/m^2 over the day: kWh -> Wh (x1000), spread over 24h.
      ghiWm2: (ghiKwhPerM2PerDay * 1000) / 24,
    })
  })

  return result
}
