/**
 * Shared normalized climate time-series shape produced by every
 * `data-sources` client (NASA POWER, Open-Meteo, ...).
 *
 * Kept in its own file, separate from any single client's module, so
 * clients built in parallel (e.g. this NASA POWER client and a sibling
 * Open-Meteo client) can share it without stepping on each other's
 * changes to the same file.
 */
export interface HourlyClimate {
  /** ISO 8601 timestamp for this sample. */
  timestamp: string
  /** Ambient air temperature, degrees Celsius. */
  temperatureC: number
  /** All-sky global horizontal irradiance, average W/m^2 for this sample. */
  ghiWm2: number
}
