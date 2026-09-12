/**
 * NOAA's simplified solar position algorithm.
 *
 * Computes the sun's altitude and azimuth angle for a given geographic
 * location and UTC timestamp, to roughly the same precision as NOAA's
 * published solar calculator (https://gml.noaa.gov/grad/solcalc/):
 * altitude to ~0.01 degrees, azimuth to ~0.01 degrees typically but
 * degrading to ~0.05-0.1 degrees near solar zenith, where the azimuth
 * formula is inherently ill-conditioned. The algorithm is transcribed
 * from NOAA's published equations
 * (https://gml.noaa.gov/grad/solcalc/solareqns.PDF) and cross-checked
 * against the formulas in NOAA's own calculator source
 * (https://gml.noaa.gov/grad/solcalc/main.js). See
 * docs/decisions/0010-solar-position-algorithm.md for the algorithm
 * choice and accuracy notes.
 *
 * Pure function — no I/O, no dependency on any other module.
 */

export interface SunPosition {
  /** Angle of the sun above the horizon, in degrees. Negative when below the horizon.
   * Includes NOAA's standard atmospheric refraction correction, matching the
   * "corrected elevation" the NOAA solar calculator displays. */
  altitude: number
  /** Sun's azimuth angle, in degrees clockwise from true north (0-360). */
  azimuth: number
}

const MS_PER_DAY = 86400000
/** Julian Day of the Unix epoch (1970-01-01T00:00:00Z). */
const UNIX_EPOCH_JULIAN_DAY = 2440587.5

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

/** Normalizes an angle in degrees to the [0, 360) range. */
function normalizeDegrees(deg: number): number {
  const wrapped = deg % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

function julianDay(timestampUtc: Date): number {
  return timestampUtc.getTime() / MS_PER_DAY + UNIX_EPOCH_JULIAN_DAY
}

/** Julian centuries since J2000.0 (2000-01-01T12:00:00 TT), NOAA's `t`. */
function julianCentury(jd: number): number {
  return (jd - 2451545.0) / 36525.0
}

function geomMeanLongSunDeg(t: number): number {
  return normalizeDegrees(280.46646 + t * (36000.76983 + t * 0.0003032))
}

function geomMeanAnomalySunDeg(t: number): number {
  return 357.52911 + t * (35999.05029 - 0.0001537 * t)
}

function eccentricityEarthOrbit(t: number): number {
  return 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
}

/** Equation of center, in degrees. */
function sunEqOfCenterDeg(t: number, geomMeanAnomalyDeg: number): number {
  const m = degToRad(geomMeanAnomalyDeg)
  return (
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289
  )
}

function meanObliquityOfEclipticDeg(t: number): number {
  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))
  return 23.0 + (26.0 + seconds / 60.0) / 60.0
}

function obliquityCorrectionDeg(t: number, meanObliquityDeg: number): number {
  const omega = 125.04 - 1934.136 * t
  return meanObliquityDeg + 0.00256 * Math.cos(degToRad(omega))
}

function sunApparentLongDeg(t: number, sunTrueLongDeg: number): number {
  const omega = 125.04 - 1934.136 * t
  return sunTrueLongDeg - 0.00569 - 0.00478 * Math.sin(degToRad(omega))
}

function sunDeclinationDeg(
  obliquityCorrDeg: number,
  appLongDeg: number,
): number {
  return radToDeg(
    Math.asin(
      Math.sin(degToRad(obliquityCorrDeg)) * Math.sin(degToRad(appLongDeg)),
    ),
  )
}

/** Equation of time, in minutes. */
function equationOfTimeMinutes(
  obliquityCorrDeg: number,
  geomMeanLongDeg: number,
  geomMeanAnomalyDeg: number,
  eccentricity: number,
): number {
  const y = Math.tan(degToRad(obliquityCorrDeg / 2)) ** 2
  const l0 = degToRad(geomMeanLongDeg)
  const m = degToRad(geomMeanAnomalyDeg)

  const eTime =
    y * Math.sin(2 * l0) -
    2 * eccentricity * Math.sin(m) +
    4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
    0.5 * y * y * Math.sin(4 * l0) -
    1.25 * eccentricity * eccentricity * Math.sin(2 * m)

  return 4 * radToDeg(eTime)
}

/**
 * NOAA's atmospheric refraction correction for a given (uncorrected) solar
 * elevation angle, in degrees. Returns the correction to add to the
 * geometric elevation to get the apparent elevation.
 */
function atmosphericRefractionDeg(elevationDeg: number): number {
  let correctionArcsec: number

  if (elevationDeg > 85) {
    correctionArcsec = 0
  } else if (elevationDeg > 5) {
    const te = Math.tan(degToRad(elevationDeg))
    correctionArcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5
  } else if (elevationDeg > -0.575) {
    correctionArcsec =
      1735 +
      elevationDeg *
        (-518.2 +
          elevationDeg *
            (103.4 + elevationDeg * (-12.79 + elevationDeg * 0.711)))
  } else {
    const te = Math.tan(degToRad(elevationDeg))
    correctionArcsec = -20.774 / te
  }

  return correctionArcsec / 3600.0
}

/**
 * Computes the sun's altitude and azimuth for a location and UTC instant,
 * using NOAA's simplified solar position algorithm (~0.01 degree accuracy
 * for altitude; azimuth is typically ~0.01 degree but degrades to
 * ~0.05-0.1 degree near solar zenith).
 *
 * @param lat Latitude in degrees, positive north (-90 to 90).
 * @param lon Longitude in degrees, positive east (-180 to 180).
 * @param timestampUtc The instant to compute sun position for.
 */
export function sunPosition(
  lat: number,
  lon: number,
  timestampUtc: Date,
): SunPosition {
  const jd = julianDay(timestampUtc)
  const t = julianCentury(jd)

  const geomMeanLongDeg = geomMeanLongSunDeg(t)
  const geomMeanAnomalyDeg = geomMeanAnomalySunDeg(t)
  const eccentricity = eccentricityEarthOrbit(t)
  const eqOfCenterDeg = sunEqOfCenterDeg(t, geomMeanAnomalyDeg)

  const sunTrueLongDeg = geomMeanLongDeg + eqOfCenterDeg
  const sunAppLongDeg = sunApparentLongDeg(t, sunTrueLongDeg)

  const meanObliquityDeg = meanObliquityOfEclipticDeg(t)
  const obliquityCorrDeg = obliquityCorrectionDeg(t, meanObliquityDeg)

  const declinationDeg = sunDeclinationDeg(obliquityCorrDeg, sunAppLongDeg)
  const eqOfTimeMin = equationOfTimeMinutes(
    obliquityCorrDeg,
    geomMeanLongDeg,
    geomMeanAnomalyDeg,
    eccentricity,
  )

  const utcMinutesOfDay =
    timestampUtc.getUTCHours() * 60 +
    timestampUtc.getUTCMinutes() +
    timestampUtc.getUTCSeconds() / 60 +
    timestampUtc.getUTCMilliseconds() / 60000

  // True solar time in minutes, using UTC as the "time zone offset = 0"
  // reference per NOAA's formula (timezone offset cancels out with
  // longitude since timestampUtc is already in UTC).
  let trueSolarTimeMin = (utcMinutesOfDay + eqOfTimeMin + 4 * lon) % 1440
  if (trueSolarTimeMin < 0) trueSolarTimeMin += 1440

  const hourAngleDeg =
    trueSolarTimeMin / 4 < 0
      ? trueSolarTimeMin / 4 + 180
      : trueSolarTimeMin / 4 - 180

  const latRad = degToRad(lat)
  const declRad = degToRad(declinationDeg)
  const haRad = degToRad(hourAngleDeg)

  const cosZenith = Math.max(
    -1,
    Math.min(
      1,
      Math.sin(latRad) * Math.sin(declRad) +
        Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad),
    ),
  )
  const zenithDeg = radToDeg(Math.acos(cosZenith))
  const elevationDeg = 90 - zenithDeg

  const refractionDeg = atmosphericRefractionDeg(elevationDeg)
  const correctedElevationDeg = elevationDeg + refractionDeg

  const zenithRad = degToRad(zenithDeg)

  // NOAA's azimuth formula divides by cos(lat) * sin(zenith), which
  // approaches zero near the poles and at solar zenith/nadir. Rather than
  // clamping the resulting near-infinite ratio into [-1, 1] (which yields a
  // plausible-looking but wrong azimuth), replicate NOAA's own guard
  // (main.js:303-322): below this threshold, the azimuth is degenerate and
  // NOAA reports a fixed value based on hemisphere instead of computing it.
  const azimuthDenom = Math.cos(latRad) * Math.sin(zenithRad)

  let azimuthDeg: number
  if (Math.abs(azimuthDenom) > 0.001) {
    const azimuthCosArg = Math.max(
      -1,
      Math.min(
        1,
        (Math.sin(latRad) * Math.cos(zenithRad) - Math.sin(declRad)) /
          azimuthDenom,
      ),
    )
    const azimuthBase = radToDeg(Math.acos(azimuthCosArg))

    azimuthDeg =
      hourAngleDeg > 0
        ? normalizeDegrees(azimuthBase + 180)
        : normalizeDegrees(540 - azimuthBase)
  } else {
    azimuthDeg = lat > 0 ? 180 : 0
  }

  return { altitude: correctedElevationDeg, azimuth: azimuthDeg }
}
