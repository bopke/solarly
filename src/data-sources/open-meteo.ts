import type { HourlyClimate } from './types'

const OPEN_METEO_BASE_URL = 'https://api.open-meteo.com/v1/forecast'

/** Open-Meteo's documented supported range for `forecast_days`. */
const OPEN_METEO_MIN_FORECAST_DAYS = 1
const OPEN_METEO_MAX_FORECAST_DAYS = 16

export interface OpenMeteoForecastOptions {
  /**
   * Number of forecast days to request, including today. Solarly's product
   * scope only shows 3-7 days of forecast (per the M1 design doc), so this
   * defaults to 7. Must be a finite integer; it's clamped to Open-Meteo's
   * documented `[1, 16]` supported range. Passing `NaN` or a non-integer
   * (e.g. `3.7`) throws rather than being silently coerced or forwarded.
   */
  forecastDays?: number
  /** Injectable for testing; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

interface OpenMeteoHourlyResponse {
  hourly?: {
    time: string[]
    // Open-Meteo pads variables whose source model has a shorter horizon
    // than the requested `forecast_days` with `null`, so these are never
    // safely `number[]`.
    temperature_2m: Array<number | null>
    shortwave_radiation: Array<number | null>
  }
}

interface OpenMeteoErrorResponse {
  error?: boolean
  reason?: string
}

/**
 * Fetches an hourly global horizontal irradiance (GHI) + temperature
 * forecast from Open-Meteo for a given lat/lon and normalizes it into the
 * shared `HourlyClimate` shape.
 *
 * Open-Meteo's free, keyless forecast API publishes `shortwave_radiation`
 * directly as an hourly variable — this *is* GHI, W/m^2 — so it's used
 * as-is rather than reconstructed from cloud cover. Note that this value
 * is NOT instantaneous: Open-Meteo defines it as the average irradiance
 * over the preceding hour, so the value stamped at `HH:00Z` describes the
 * interval `(HH-1):00Z` to `HH:00Z`, not a sample taken at `HH:00Z`. See
 * docs/decisions/0040-open-meteo-client.md for the full rationale,
 * including why the `shortwave_radiation_instant` variant (a genuinely
 * instantaneous point sample) was not chosen instead.
 *
 * Hours where Open-Meteo pads `shortwave_radiation` or `temperature_2m`
 * with `null` (short-horizon source models under a longer `forecast_days`
 * request) are dropped from the result entirely, rather than being
 * coerced into a misleading `0` or passed through as `null` in a
 * `number`-typed field.
 */
export async function fetchOpenMeteoForecast(
  latitude: number,
  longitude: number,
  options: OpenMeteoForecastOptions = {},
): Promise<HourlyClimate[]> {
  const fetchFn = options.fetchImpl ?? fetch
  const forecastDays = sanitizeForecastDays(options.forecastDays)

  const url = new URL(OPEN_METEO_BASE_URL)
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('hourly', 'temperature_2m,shortwave_radiation')
  url.searchParams.set('forecast_days', String(forecastDays))
  // Fixed UTC timezone so the "naive" timestamps Open-Meteo returns can be
  // treated as UTC unambiguously (see the `Z` suffix added below).
  url.searchParams.set('timezone', 'UTC')

  const response = await fetchFn(url.toString())
  if (!response.ok) {
    const reason = await readErrorReason(response)
    const statusPart = response.statusText
      ? `${response.status} ${response.statusText}`
      : `${response.status}`
    throw new Error(
      `Open-Meteo request failed: ${statusPart}${
        reason ? ` - ${reason}` : ' (no reason given)'
      }`,
    )
  }

  const data = (await response.json()) as OpenMeteoHourlyResponse
  if (!data.hourly) {
    throw new Error(
      "Open-Meteo response is missing the 'hourly' field; the response shape may have changed.",
    )
  }

  const {
    time,
    temperature_2m: temperatures,
    shortwave_radiation: shortwaveRadiation,
  } = data.hourly

  if (
    !Array.isArray(time) ||
    !Array.isArray(temperatures) ||
    !Array.isArray(shortwaveRadiation)
  ) {
    throw new Error(
      "Open-Meteo response is missing one or more of the expected 'hourly' " +
        "arrays ('time', 'temperature_2m', 'shortwave_radiation'); the " +
        'response shape may have changed.',
    )
  }

  if (
    temperatures.length !== time.length ||
    shortwaveRadiation.length !== time.length
  ) {
    throw new Error(
      `Open-Meteo response arrays have mismatched lengths: time=${time.length}, ` +
        `temperature_2m=${temperatures.length}, shortwave_radiation=${shortwaveRadiation.length}`,
    )
  }

  const result: HourlyClimate[] = []
  for (let i = 0; i < time.length; i++) {
    const temperatureC = temperatures[i]
    const ghiWm2 = shortwaveRadiation[i]
    // Open-Meteo pads short-horizon variables with `null`; skip these hours
    // rather than coercing `null` into a misleading `0` or letting it flow
    // through a `number`-typed field.
    if (temperatureC === null || ghiWm2 === null) continue

    // Open-Meteo returns "2026-09-12T13:00" (no offset, no seconds) when
    // timezone=UTC; append ":00Z" to make it an unambiguous UTC ISO 8601
    // timestamp matching the shared `HourlyClimate` shape. Guard against a
    // timestamp that already carries seconds (e.g. "2026-06-21T12:00:00")
    // so we don't double-append and produce a malformed
    // "...T12:00:00:00Z" string.
    const isoTimeNaive = time[i]
    // Minute precision ("...T12:00") has one ":" after the date; seconds
    // precision ("...T12:00:00") has two. Only append ":00" when seconds
    // aren't already present, so we never produce "...T12:00:00:00Z".
    const hasSeconds = isoTimeNaive.split(':').length > 2
    const timestamp = isoTimeNaive.endsWith('Z')
      ? isoTimeNaive
      : hasSeconds
        ? `${isoTimeNaive}Z`
        : `${isoTimeNaive}:00Z`

    result.push({ timestamp, temperatureC, ghiWm2 })
  }

  return result
}

function sanitizeForecastDays(forecastDays: number | undefined): number {
  if (forecastDays === undefined) return 7
  if (!Number.isFinite(forecastDays) || !Number.isInteger(forecastDays)) {
    throw new Error(
      `forecastDays must be a finite integer, got ${forecastDays}`,
    )
  }
  return Math.min(
    OPEN_METEO_MAX_FORECAST_DAYS,
    Math.max(OPEN_METEO_MIN_FORECAST_DAYS, forecastDays),
  )
}

async function readErrorReason(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as OpenMeteoErrorResponse
    return body.reason ?? null
  } catch {
    return null
  }
}
