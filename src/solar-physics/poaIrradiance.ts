/**
 * Plane-of-array (POA) irradiance transposition.
 *
 * Transposes horizontal direct (beam) and diffuse irradiance onto a
 * tilted panel's plane, using the isotropic sky-diffuse model (Liu &
 * Jordan, 1963 — "The interrelationship and characteristic distribution
 * of direct, diffuse and total solar radiation", Solar Energy 4(3)) plus
 * a standard ground-reflected (albedo) term. This is the simplest widely
 * used transposition model; more accurate anisotropic models (Hay-Davies,
 * Perez) are out of scope for M1 — see
 * docs/decisions/0013-poa-transposition-and-power-model.md.
 *
 * Pure function — no I/O, no dependency on any other module. Intended to
 * be used with `sunPosition()`'s output as the `sunPosition` argument and
 * `clearSkyIrradiance()`'s output as `horizontalIrradiance`, but
 * deliberately decoupled from both so it stays independently testable.
 */

export interface HorizontalIrradiance {
  /** Direct (beam) irradiance on a horizontal surface, in W/m². */
  direct: number
  /** Diffuse sky irradiance on a horizontal surface, in W/m². */
  diffuse: number
}

export interface SunPositionInput {
  /** Angle of the sun above the horizon, in degrees. Negative when below the horizon. */
  altitude: number
  /** Sun's azimuth angle, in degrees clockwise from true north (0-360). */
  azimuth: number
}

/**
 * Ground albedo (reflectance) used for the ground-reflected irradiance
 * component. 0.2 is a standard default for generic ground surfaces (grass,
 * bare soil, mixed suburban terrain) widely used as a fallback in PV
 * modeling tools when the actual surface material is unknown, which is
 * the case here — M1 has no ground-material input. See ADR 0013.
 */
export const DEFAULT_ALBEDO = 0.2

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Transposes horizontal direct + diffuse irradiance onto a tilted panel
 * plane using the isotropic sky-diffuse model.
 *
 * - Direct (beam) component: projected via the angle of incidence (AOI)
 *   between the sun ray and the panel's surface normal. Zero when the sun
 *   is below the horizon or the AOI is >= 90° (sun behind the panel
 *   plane).
 * - Diffuse component: scaled by the isotropic sky-view factor
 *   `(1 + cos(tilt)) / 2` — the fraction of the (uniformly bright,
 *   isotropic) sky dome visible to the tilted plane.
 * - Ground-reflected component: `(horizontal direct + diffuse) * albedo *
 *   (1 - cos(tilt)) / 2` — the complementary view factor for the ground,
 *   scaled by how much of the incident horizontal irradiance the ground
 *   reflects. See `DEFAULT_ALBEDO`.
 *
 * @param horizontalIrradiance Direct + diffuse irradiance on a horizontal
 *   surface, in W/m² (e.g. from `clearSkyIrradiance()`).
 * @param sunPosition Sun altitude + azimuth, in degrees (e.g. from
 *   `sunPosition()`). Altitude at or below 0, or non-finite values, are
 *   treated as "sun below/at the horizon" and contribute no beam
 *   component (diffuse/ground-reflected components, which don't depend on
 *   sun position, still apply).
 * @param panelTilt Panel tilt from horizontal, in degrees (0 = flat/facing
 *   straight up, 90 = vertical wall-mounted).
 * @param panelAzimuth Panel's facing direction, in degrees clockwise from
 *   true north (0-360), same convention as `sunPosition().azimuth` (e.g.
 *   180 = due south, the typical northern-hemisphere-optimal orientation).
 * @param albedo Ground reflectance, 0-1. Defaults to `DEFAULT_ALBEDO`.
 */
export function poaIrradiance(
  horizontalIrradiance: HorizontalIrradiance,
  sunPosition: SunPositionInput,
  panelTilt: number,
  panelAzimuth: number,
  albedo: number = DEFAULT_ALBEDO,
): number {
  const { direct: directHorizontal, diffuse: diffuseHorizontal } =
    horizontalIrradiance
  const tiltRad = degToRad(panelTilt)
  const cosTilt = Math.cos(tiltRad)

  // Diffuse (isotropic sky-view factor) and ground-reflected components
  // don't depend on sun position, only on tilt and the horizontal
  // irradiance values, so they apply even when the sun is below the
  // horizon (which correctly zeroes them too, since both horizontal
  // components are 0 in that case for a physically consistent input).
  const diffusePoa = diffuseHorizontal * ((1 + cosTilt) / 2)
  const groundReflectedPoa =
    (directHorizontal + diffuseHorizontal) * albedo * ((1 - cosTilt) / 2)

  const sunAltitude = sunPosition.altitude
  if (!Number.isFinite(sunAltitude) || sunAltitude <= 0) {
    return Math.max(diffusePoa + groundReflectedPoa, 0)
  }

  const zenithDeg = 90 - sunAltitude
  const cosZenith = Math.sin(degToRad(sunAltitude))

  // Angle of incidence (AOI) between the sun ray and the panel's surface
  // normal: cos(AOI) = cos(zenith)*cos(tilt) + sin(zenith)*sin(tilt)*cos(sunAz - panelAz).
  const zenithRad = degToRad(zenithDeg)
  const azimuthDiffRad = degToRad(sunPosition.azimuth - panelAzimuth)
  const cosAoi =
    Math.cos(zenithRad) * cosTilt +
    Math.sin(zenithRad) * Math.sin(tiltRad) * Math.cos(azimuthDiffRad)

  // Direct horizontal irradiance already equals DNI * cos(zenith), so
  // DNI * cos(AOI) = directHorizontal * cos(AOI) / cos(zenith). Clamp
  // cos(AOI) to >= 0: a negative value means the sun is behind the panel
  // plane, which contributes no direct irradiance.
  const directPoa =
    cosZenith > 0 ? directHorizontal * (Math.max(cosAoi, 0) / cosZenith) : 0

  return Math.max(directPoa + diffusePoa + groundReflectedPoa, 0)
}
