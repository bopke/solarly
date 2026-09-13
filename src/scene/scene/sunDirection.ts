/**
 * Pure helpers converting `solar-physics/sunPosition`'s altitude/azimuth
 * output into the ENU (x=east, y=north, z=up) unit direction vector this
 * scene renders in, plus a small day-of-year/hour-of-day <-> `Date`
 * conversion for the sun-position scrubber (issue #76). Kept free of
 * React/Three.js imports, mirroring `geometryBuilders.ts`'s split, so the
 * conversion math is directly unit-testable under Vitest without a WebGL
 * context.
 */

import { sunPosition } from '../../solar-physics/sunPosition'
import type { Vec3 } from '../derive'

/**
 * Converts a sun altitude/azimuth pair (as returned by
 * `solar-physics/sunPosition`) into a unit ENU direction vector pointing
 * *from the scene toward the sun* — i.e. the direction a `DirectionalLight`
 * placed along this vector (scaled out from the scene) should shine back
 * *against* to illuminate the scene the way the real sun would.
 *
 * `sunPosition`'s `azimuth` is degrees clockwise from true north (0-360,
 * see its own doc comment) — the same convention
 * `scene/derive/polygonToExtrusionGeometry.ts` and `geometryBuilders.ts`'s
 * `liftToPlane` already use for a roof's slope direction
 * (`{ x: sin(azimuthRad), y: cos(azimuthRad) }`), so this reuses that
 * exact `x = sin, y = cos` mapping rather than inventing a new one:
 * azimuth 0 (north) -> +y, 90 (east) -> +x, 180 (south) -> -y, 270
 * (west) -> -x. `altitude` is degrees above the horizon (negative when
 * the sun is below it); `cos(altitude)` scales the horizontal (x, y)
 * component down as the sun climbs toward zenith, and `sin(altitude)`
 * gives the vertical (z) component, so at altitude=90 (straight up) this
 * correctly collapses to `(0, 0, 1)` regardless of azimuth.
 */
export function sunAltitudeAzimuthToEnuDirection(
  altitudeDeg: number,
  azimuthDeg: number,
): Vec3 {
  const altRad = (altitudeDeg * Math.PI) / 180
  const azRad = (azimuthDeg * Math.PI) / 180
  const horizontal = Math.cos(altRad)
  return {
    x: horizontal * Math.sin(azRad),
    y: horizontal * Math.cos(azRad),
    z: Math.sin(altRad),
  }
}

/** One scrubber-driven sun-light configuration, computed for a location and moment. */
export interface SunLightState {
  /** Sun altitude, degrees above the horizon (negative = below, i.e. night). */
  altitudeDeg: number
  /** Sun azimuth, degrees clockwise from true north. */
  azimuthDeg: number
  /**
   * Unit ENU direction from the scene toward the sun — see
   * `sunAltitudeAzimuthToEnuDirection`. `null` when the sun is at or
   * below the horizon (`altitudeDeg <= 0`): there's no physically
   * meaningful sun-lit direction to render a shadow-casting light from,
   * so callers should skip rendering the shadow light entirely rather
   * than pointing it below the ground plane (see `Scene3DView`'s "night
   * handling" doc comment for the full rationale).
   */
  direction: Vec3 | null
}

/**
 * Computes the scrubber-driven sun light state for a location and UTC
 * instant, by calling `solar-physics/sunPosition` (unmodified, per issue
 * #76's scope) and converting its result via
 * `sunAltitudeAzimuthToEnuDirection`.
 */
export function computeSunLightState(
  lat: number,
  lon: number,
  timestampUtc: Date,
): SunLightState {
  const { altitude, azimuth } = sunPosition(lat, lon, timestampUtc)
  return {
    altitudeDeg: altitude,
    azimuthDeg: azimuth,
    direction:
      altitude > 0 ? sunAltitudeAzimuthToEnuDirection(altitude, azimuth) : null,
  }
}

/** A non-leap reference year used to turn the scrubber's day-of-year (1-365) into a concrete `Date` — see `dayHourToUtcDate`'s doc. */
export const SCRUBBER_REFERENCE_YEAR = 2025

/**
 * Turns the scrubber's day-of-year (1-365) and hour-of-day (0-23.99...)
 * controls into a concrete UTC `Date` for `sunPosition`. Uses a fixed
 * non-leap reference year (`SCRUBBER_REFERENCE_YEAR`) since the scrubber
 * itself only exposes day-of-year/hour-of-day, not a real calendar date —
 * this is a real-time *visual preview* (per the design spec's scope cut,
 * it doesn't feed the simulation), so which specific year is used doesn't
 * matter, only which day-of-year/time-of-day, which determines
 * declination and hour angle.
 *
 * The scrubber's "hour of day" is treated as UTC directly (not converted
 * through the location's real local time zone) — this project has no
 * timezone-lookup dependency anywhere else (see `solar-physics/sunPosition`'s
 * own UTC-only contract), and for a visual preview showing *relative*
 * sun movement as the scrubber moves, an absolute UTC/local offset is
 * immaterial.
 */
export function dayHourToUtcDate(dayOfYear: number, hourOfDay: number): Date {
  const msPerDay = 86400000
  const startOfYear = Date.UTC(SCRUBBER_REFERENCE_YEAR, 0, 1)
  return new Date(
    startOfYear + (dayOfYear - 1) * msPerDay + hourOfDay * 3600000,
  )
}
