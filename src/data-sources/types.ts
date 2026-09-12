/**
 * Shared normalized climate time-series shapes produced by
 * `data-sources` clients (NASA POWER, Open-Meteo, ...).
 *
 * Kept in their own file, separate from any single client's module, so
 * clients built in parallel (e.g. the NASA POWER client and a sibling
 * Open-Meteo client) can share it without stepping on each other's
 * changes to the same file.
 *
 * There are two distinct shapes here, not one - see
 * `docs/decisions/0035-climate-data-type-split.md` for why. In short:
 * `HourlyClimate.ghiWm2` is an instantaneous(-ish) hourly-resolution
 * reading, while `MonthlyClimateNormal.dailyInsolationKWhM2` is a
 * 20-year monthly-normal daily total. The two are not interchangeable
 * and must never be merged back into one type/field name.
 */

/**
 * An hourly-resolution climate sample: one instantaneous(-ish) reading
 * per hour, as produced by e.g. the Open-Meteo client.
 */
export interface HourlyClimate {
  /** ISO 8601 timestamp for this sample. */
  timestamp: string
  /** Ambient air temperature, degrees Celsius. */
  temperatureC: number
  /** All-sky global horizontal irradiance, instantaneous(-ish) W/m^2 for this sample. */
  ghiWm2: number
}

/**
 * A 20-year climatological monthly normal: one value per calendar
 * month, as produced by the NASA POWER climatology client. This is
 * *not* hourly-resolution data - each entry summarizes an entire
 * month, so it must not be conflated with {@link HourlyClimate}.
 */
export interface MonthlyClimateNormal {
  /** Calendar month, 1 (January) through 12 (December). */
  month: number
  /** Ambient air temperature, degrees Celsius, averaged over the month. */
  temperatureC: number
  /**
   * All-sky global horizontal irradiance, daily total in kWh/m^2/day -
   * NASA POWER's native unit for this field (`ALLSKY_SFC_SW_DWN`).
   * Kept in this native unit (rather than converted to an average
   * W/m^2, which would be lossy and easy to mistake for
   * {@link HourlyClimate.ghiWm2}'s very different, much larger
   * magnitude) so no precision is lost and the two fields can't be
   * accidentally treated as the same kind of number.
   */
  dailyInsolationKWhM2: number
}
