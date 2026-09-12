/**
 * Simplified Ineichen & Perez clear-sky irradiance model.
 *
 * Estimates direct (beam) and diffuse irradiance on a horizontal surface,
 * in W/m², for a cloudless sky, given only the sun's altitude angle and an
 * (optional) Linke turbidity value.
 *
 * Model: Ineichen, P. and Perez, R., "A new airmass independent
 * formulation for the Linke turbidity coefficient", Solar Energy, vol 73,
 * pp. 151-157, 2002. The equations below are the sea-level form of that
 * model (site altitude / atmospheric pressure = 0, i.e. `fh1 = fh2 = 1`),
 * which matches the widely-used pvlib-python `clearsky.ineichen`
 * reference implementation with `perez_enhancement=False` (pvlib's
 * default — the enhancement term is documented there as producing
 * spurious results near the horizon, which M1 needs to handle well for
 * sunrise/sunset hours).
 *
 * Air mass: Kasten, F. and Young, A.T., "Revised optical air mass tables
 * and approximation formula", Applied Optics 28(22), pp. 4735-4738, 1989.
 *
 * Known limitations (see docs/decisions/0011-clear-sky-irradiance-model.md):
 * - Linke turbidity is a single fixed climatology constant (default 3.5),
 *   not looked up per-location/season. Real-time or location-specific
 *   turbidity data is explicitly out of scope for M1 per the design spec
 *   (docs/superpowers/specs/2026-09-12-solarly-m1-design.md).
 * - No site-altitude/pressure correction (sea-level assumed) — the
 *   function only takes sun altitude, not location elevation.
 * - The solar constant is a fixed 1361 W/m², ignoring the ~±3.3% annual
 *   eccentricity variation in Earth-Sun distance (the function has no
 *   date input to derive it from).
 *
 * Pure function — no I/O, no dependency on any other module. Intended to
 * be used with `sunPosition().altitude` as its input, but deliberately
 * decoupled from it so it stays independently testable.
 */

export interface ClearSkyIrradiance {
  /** Direct (beam) irradiance on a horizontal surface, in W/m². */
  direct: number
  /** Diffuse sky irradiance on a horizontal surface, in W/m². */
  diffuse: number
}

/** Solar constant, W/m² (mean extraterrestrial irradiance, no eccentricity correction). */
const SOLAR_CONSTANT_W_M2 = 1361

/**
 * Default Linke turbidity, a fixed climatology constant representing a
 * moderately clean continental atmosphere (annual-average conditions).
 * See docs/decisions/0011-clear-sky-irradiance-model.md for the source
 * and justification of this value.
 */
export const DEFAULT_LINKE_TURBIDITY = 3.5

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Kasten & Young (1989) relative optical air mass, from zenith angle in
 * degrees. Valid for zenith angles up to 90° (air mass ~38 at the
 * horizon).
 */
function relativeAirMass(zenithDeg: number): number {
  return (
    1 /
    (Math.cos(degToRad(zenithDeg)) +
      0.50572 * Math.pow(96.07995 - zenithDeg, -1.6364))
  )
}

/**
 * Computes clear-sky direct and diffuse irradiance on a horizontal
 * surface using the sea-level-simplified Ineichen & Perez (2002) model.
 *
 * @param sunAltitude Sun altitude angle above the horizon, in degrees
 *   (e.g. from `sunPosition().altitude`). Values at or below 0 (sun below
 *   the horizon) return zero irradiance.
 * @param turbidity Linke turbidity factor. Defaults to a fixed
 *   climatology constant — see `DEFAULT_LINKE_TURBIDITY` and the ADR for
 *   the known fixed-turbidity limitation.
 */
export function clearSkyIrradiance(
  sunAltitude: number,
  turbidity: number = DEFAULT_LINKE_TURBIDITY,
): ClearSkyIrradiance {
  if (sunAltitude <= 0) {
    return { direct: 0, diffuse: 0 }
  }

  const zenithDeg = 90 - sunAltitude
  const cosZenith = Math.sin(degToRad(sunAltitude))
  const am = relativeAirMass(zenithDeg)

  // Sea-level simplification of the Ineichen model: altitude = 0 metres,
  // so the altitude-dependent correction terms fh1/fh2/cg1/cg2 reduce to
  // fixed constants.
  const fh1 = 1
  const fh2 = 1
  const cg1 = 0.868
  const cg2 = 0.0387

  const ghiAttenuation = Math.exp(-cg2 * am * (fh1 + fh2 * (turbidity - 1)))
  const ghi =
    cg1 * SOLAR_CONSTANT_W_M2 * cosZenith * Math.max(ghiAttenuation, 0)

  const beamCoefficient = 0.664 + 0.163 / fh1
  const beamNormalClearSky =
    SOLAR_CONSTANT_W_M2 *
    Math.max(
      beamCoefficient * Math.exp(-0.09 * am * (turbidity - 1)),
      0,
    )

  const diffuseFractionLimit = Math.min(
    Math.max(
      (1 - (0.1 - 0.2 * Math.exp(-turbidity)) / (0.1 + 0.882 / fh1)) /
        cosZenith,
      0,
    ),
    1e20,
  )
  const beamNormalFromGhi = ghi * diffuseFractionLimit

  const dni = Math.max(Math.min(beamNormalClearSky, beamNormalFromGhi), 0)

  const direct = dni * cosZenith
  const diffuse = Math.max(ghi - direct, 0)

  return { direct, diffuse }
}
