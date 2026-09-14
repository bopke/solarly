/**
 * Sun-position-scrubber helpers (issue #76): computing the scrubber-driven
 * sun-light state for a location and moment, plus a small day-of-year/
 * hour-of-day <-> `Date` conversion. Kept free of React/Three.js imports,
 * mirroring `geometryBuilders.ts`'s split, so the conversion math is
 * directly unit-testable under Vitest without a WebGL context.
 *
 * The altitude/azimuth -> ENU direction conversion itself lives in
 * `solar-physics/sunDirection.ts`'s `sunAltitudeAzimuthToEnuDirection` — it
 * used to be duplicated here (this file was originally named
 * `sunDirection.ts`), but since `solar-physics/` is a layer both `scene/`
 * and `simulation/` can import from, there's no boundary reason for
 * `scene/scene/` to keep its own copy of that specific conversion (see
 * issue #91, item 4; `simulation/`'s copy in `solar-physics/sunDirection.ts`
 * predates this fix and stays there since it's already the correct layer).
 */

import { sunPosition } from '../../solar-physics/sunPosition'
import { sunAltitudeAzimuthToEnuDirection } from '../../solar-physics/sunDirection'
import type { Vec3 } from '../derive'

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
