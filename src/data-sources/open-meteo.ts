import type { HourlyClimate } from './types'
import { clearSkyGhiWm2, solarElevationDegrees } from './clear-sky'

const OPEN_METEO_BASE_URL = 'https://api.open-meteo.com/v1/forecast'

/** Open-Meteo's documented maximum for `forecast_days`. */
const OPEN_METEO_MAX_FORECAST_DAYS = 16

export interface OpenMeteoForecastOptions {
  /**
   * Number of forecast days to request, including today. Solarly's product
   * scope only shows 3-7 days of forecast (per the M1 design doc), so this
   * defaults to 7; it's clamped to Open-Meteo's [1, 16] supported range.
   */
  forecastDays?: number
  /** Injectable for testing; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

interface OpenMeteoHourlyResponse {
  hourly: {
    time: string[]
    temperature_2m: number[]
    cloud_cover: number[]
  }
}

/**
 * Empirical cloud-cover attenuation of clear-sky GHI, per Kasten & Czeplak
 * (1980): "Solar and terrestrial radiation dependent on the amount and type
 * of cloud", Solar Energy, 24(2), 177-189.
 *
 * I = I_clear * (1 - 0.75 * (N/8)^3.4)
 *
 * where N is cloud cover in oktas (0-8). Open-Meteo reports cloud cover as a
 * percentage (0-100), which maps directly onto the N/8 fraction (0-1) used
 * by the formula.
 */
export function attenuateForCloudCover(
  clearSkyGhi: number,
  cloudCoverPercent: number,
): number {
  const cloudFraction = Math.min(100, Math.max(0, cloudCoverPercent)) / 100
  const attenuation = 1 - 0.75 * Math.pow(cloudFraction, 3.4)
  return clearSkyGhi * attenuation
}

/**
 * Fetches an hourly cloud-cover + temperature forecast from Open-Meteo for a
 * given lat/lon and normalizes it into the shared `HourlyClimate` shape.
 * Open-Meteo does not publish irradiance directly for this use case, so GHI
 * is estimated by attenuating a clear-sky GHI estimate against the forecast
 * cloud cover (see `attenuateForCloudCover` and `clear-sky.ts`).
 *
 * See docs/decisions/0040-open-meteo-client.md for the endpoint/parameter
 * and attenuation-formula rationale.
 */
export async function fetchOpenMeteoForecast(
  latitude: number,
  longitude: number,
  options: OpenMeteoForecastOptions = {},
): Promise<HourlyClimate[]> {
  const fetchFn = options.fetchImpl ?? fetch
  const forecastDays = Math.min(
    OPEN_METEO_MAX_FORECAST_DAYS,
    Math.max(1, options.forecastDays ?? 7),
  )

  const url = new URL(OPEN_METEO_BASE_URL)
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('hourly', 'temperature_2m,cloud_cover')
  url.searchParams.set('forecast_days', String(forecastDays))
  // Fixed UTC timezone so the "naive" timestamps Open-Meteo returns can be
  // treated as UTC unambiguously (see the `Z` suffix added below).
  url.searchParams.set('timezone', 'UTC')

  const response = await fetchFn(url.toString())
  if (!response.ok) {
    throw new Error(
      `Open-Meteo request failed: ${response.status} ${response.statusText}`,
    )
  }

  const data = (await response.json()) as OpenMeteoHourlyResponse
  const {
    time,
    temperature_2m: temperatures,
    cloud_cover: cloudCover,
  } = data.hourly

  return time.map((isoTimeNaive, i) => {
    // Open-Meteo returns "2026-09-12T13:00" (no offset, no seconds) when
    // timezone=UTC; append ":00Z" to make it an unambiguous UTC ISO 8601
    // timestamp matching the shared `HourlyClimate` shape.
    const timestamp = isoTimeNaive.endsWith('Z')
      ? isoTimeNaive
      : `${isoTimeNaive}:00Z`
    const date = new Date(timestamp)

    const elevation = solarElevationDegrees(latitude, longitude, date)
    const clearSkyGhi = clearSkyGhiWm2(elevation)
    const ghiWm2 = attenuateForCloudCover(clearSkyGhi, cloudCover[i])

    return {
      timestamp,
      temperatureC: temperatures[i],
      ghiWm2,
    }
  })
}
