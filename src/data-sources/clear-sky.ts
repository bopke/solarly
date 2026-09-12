/**
 * Minimal, self-contained clear-sky GHI estimate used only to attenuate the
 * Open-Meteo cloud-cover forecast into an estimated GHI (see open-meteo.ts).
 *
 * This intentionally duplicates a (much reduced) slice of the sun-position /
 * clear-sky physics described for `solar-physics/` in the M1 design doc.
 * `solar-physics/` is not implemented on this branch yet (its own issue is
 * still open), and the module boundary in the design doc reserves
 * "depends on both solar-physics and data-sources" for `simulation/` only,
 * so this client cannot import a shared implementation. See
 * docs/decisions/0040-open-meteo-client.md for the full rationale and the
 * suggested future reconciliation (replace this file with a call into
 * `solar-physics` once it exists, or have `simulation` do the attenuation
 * instead of `data-sources`).
 */

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  const diffMs = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  )
  return Math.floor((diffMs - start) / 86_400_000) + 1
}

/**
 * Solar elevation angle (degrees above the horizon, negative when the sun is
 * below it) for a given lat/lon and UTC instant.
 *
 * Reduced form of the standard NOAA solar-position equations (fractional-year
 * declination + equation of time approximation). Accurate to roughly
 * +/-0.3 degrees, which is more than sufficient for a clear-sky attenuation
 * envelope — this is not the high-precision (~0.01 degree) algorithm planned
 * for `solar-physics/`.
 */
export function solarElevationDegrees(
  latitude: number,
  longitude: number,
  date: Date,
): number {
  const n = dayOfYear(date)
  const gamma =
    ((2 * Math.PI) / 365) *
    (n -
      1 +
      (date.getUTCHours() +
        date.getUTCMinutes() / 60 +
        date.getUTCSeconds() / 3600 -
        12) /
        24)

  // Equation of time, minutes.
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))

  // Solar declination, radians.
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)

  const timeOffsetMin = eqTime + 4 * longitude
  const trueSolarTimeMin =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    timeOffsetMin

  // Hour angle, degrees (-180..180).
  let hourAngleDeg = trueSolarTimeMin / 4 - 180
  hourAngleDeg = ((hourAngleDeg + 180) % 360) - 180

  const latRad = latitude * DEG_TO_RAD
  const hourAngleRad = hourAngleDeg * DEG_TO_RAD

  const cosZenith =
    Math.sin(latRad) * Math.sin(decl) +
    Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngleRad)
  const zenithDeg = Math.acos(Math.min(1, Math.max(-1, cosZenith))) * RAD_TO_DEG

  return 90 - zenithDeg
}

/**
 * Clear-sky global horizontal irradiance (W/m^2), Haurwitz (1945) model.
 * A standard, simple empirical clear-sky model driven only by solar
 * elevation — no turbidity/atmospheric inputs needed, which keeps this
 * self-contained helper lightweight.
 *
 * Source: Haurwitz, B. (1945), "Insolation in Relation to Cloudiness and
 * Cloud Density", Journal of Meteorology, 2(3), 154-166.
 * GHI_clear = 1098 * cos(z) * exp(-0.059 / cos(z)), for cos(z) > 0.
 */
export function clearSkyGhiWm2(elevationDegrees: number): number {
  if (elevationDegrees <= 0) return 0
  const cosZenith = Math.sin(elevationDegrees * DEG_TO_RAD)
  return 1098 * cosZenith * Math.exp(-0.059 / cosZenith)
}
