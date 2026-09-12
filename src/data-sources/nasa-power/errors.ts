/**
 * Raised for network failures, non-2xx responses, and responses that
 * don't match the shape this client expects. Distinct from
 * {@link NasaPowerNoDataError} because the caller should react
 * differently: this is "try again / something is broken", the other is
 * "this location simply has no data".
 */
export class NasaPowerRequestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'NasaPowerRequestError'
  }
}

/**
 * Raised when the request succeeded but NASA POWER has no usable climate
 * data for the requested location (e.g. open ocean / polar coverage gaps
 * in the underlying reanalysis, surfaced as POWER's documented
 * `fill_value` sentinel, -999, in place of real readings).
 */
export class NasaPowerNoDataError extends Error {
  readonly latitude: number
  readonly longitude: number

  constructor(message: string, latitude: number, longitude: number) {
    super(message)
    this.name = 'NasaPowerNoDataError'
    this.latitude = latitude
    this.longitude = longitude
  }
}
