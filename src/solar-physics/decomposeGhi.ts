/**
 * GHI decomposition: splits a single global horizontal irradiance (GHI)
 * value into horizontal direct (beam) + diffuse components, using the
 * Erbs correlation (Erbs, D.G., Klein, S.A., Duffie, J.A., "Estimation of
 * the diffuse radiation fraction for hourly, daily and monthly-average
 * global radiation", Solar Energy, vol 28, pp. 293-302, 1982).
 *
 * Real-world GHI data sources (NASA POWER's daily climatology, issue #6;
 * Open-Meteo's hourly forecast, issue #7) report a single combined GHI
 * value, not the direct/diffuse split `poaIrradiance()` (issue #4) needs.
 * Erbs estimates the diffuse fraction `kd = diffuse / GHI` as a piecewise
 * function of the clearness index `kt = GHI / extraterrestrialHorizontal`
 * — how much of the theoretical top-of-atmosphere irradiance actually
 * reached the ground, which is a good proxy for how overcast/hazy the sky
 * was for that observation. It is one of the most widely published and
 * cited GHI-decomposition correlations (used as a baseline/reference model
 * in pvlib-python's `irradiance.erbs`), well suited to this module's "pure,
 * dependency-free function transcribed from published equations" pattern
 * (matching `clearSkyIrradiance`/`sunPosition`).
 *
 * Pure function — no I/O, no dependency on any other module. Intended to
 * be used with `sunPosition()`'s output as the `sunPosition` argument, and
 * its output fed directly into `poaIrradiance()`'s `horizontalIrradiance`
 * argument, but deliberately decoupled from both so it stays independently
 * testable.
 *
 * IMPORTANT — horizontal-beam convention, not DNI: `directWm2` below is
 * `GHI - diffuseWm2`, i.e. the *horizontal* beam component, exactly the
 * convention `poaIrradiance()`'s `horizontalIrradiance.direct` documents
 * itself as expecting ("direct horizontal irradiance already equals DNI *
 * cos(zenith)") and exactly what `clearSkyIrradiance()`'s `direct` output
 * already is. This function's output can be passed straight into
 * `poaIrradiance()` with no unit conversion needed.
 *
 * IMPORTANT — refraction coupling: like `clearSkyIrradiance`, this model's
 * `cos(zenith)` term is computed from `sunPosition().altitude`'s apparent
 * (refraction-corrected) convention, not geometric altitude — see
 * `clearSkyIrradiance.ts`'s module doc for the same caveat, which applies
 * identically here since both functions derive `cos(zenith)` the same way.
 *
 * Known limitation (see docs/decisions/0014-ghi-decomposition-erbs.md):
 * no Earth-Sun distance eccentricity correction on the extraterrestrial
 * irradiance used to compute `kt` — matches the same documented gap in
 * `clearSkyIrradiance` (ADR 0011), for the same reason (no date input).
 */

export interface GhiDecomposition {
  /** Direct (beam) irradiance on a horizontal surface, in W/m². */
  directWm2: number
  /** Diffuse sky irradiance on a horizontal surface, in W/m². */
  diffuseWm2: number
}

export interface SunPositionInput {
  /** Angle of the sun above the horizon, in degrees. Negative when below the horizon. */
  altitude: number
  /** Sun's azimuth angle, in degrees clockwise from true north (0-360). Unused by this model, kept for a consistent `sunPosition()`-shaped input across `solar-physics`. */
  azimuth: number
}

/**
 * Solar constant, W/m² (mean extraterrestrial irradiance, no eccentricity
 * correction). Matches `clearSkyIrradiance`'s `SOLAR_CONSTANT_W_M2` for
 * consistency across the module — see that module's doc comment for the
 * vintage/justification note.
 */
const SOLAR_CONSTANT_W_M2 = 1361

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Erbs (1982) piecewise diffuse-fraction correlation: estimates
 * `kd = diffuse / GHI` from the clearness index `kt`.
 *
 * - `kt <= 0.22`: mostly-diffuse (overcast) regime, diffuse fraction near 1,
 *   decreasing slowly with `kt`.
 * - `0.22 < kt <= 0.80`: the transition regime, a degree-4 polynomial fit.
 * - `kt > 0.80`: clear-sky regime, diffuse fraction flattens to a low
 *   constant (mostly beam).
 *
 * Coefficients as published in Erbs, Klein & Duffie (1982) and reproduced
 * in Duffie & Beckman, _Solar Engineering of Thermal Processes_, and in
 * pvlib-python's `irradiance.erbs` reference implementation.
 */
function erbsDiffuseFraction(kt: number): number {
  if (kt <= 0.22) {
    return 1 - 0.09 * kt
  }
  if (kt <= 0.8) {
    return (
      0.9511 -
      0.1604 * kt +
      4.388 * kt ** 2 -
      16.638 * kt ** 3 +
      12.336 * kt ** 4
    )
  }
  return 0.165
}

/**
 * Decomposes a single global horizontal irradiance (GHI) value into
 * horizontal direct (beam) + diffuse components, using the Erbs
 * correlation.
 *
 * @param ghiWm2 Global horizontal irradiance, in W/m² (e.g. from
 *   NASA POWER or Open-Meteo). Non-finite or non-positive values return
 *   `{ directWm2: 0, diffuseWm2: 0 }`.
 * @param sunPosition Sun altitude + azimuth, in degrees (e.g. from
 *   `sunPosition()`). Altitude at or below 0, or non-finite, is treated as
 *   "sun below/at the horizon" and returns zero for both components —
 *   consistent with `clearSkyIrradiance`'s and `poaIrradiance`'s
 *   below-horizon handling, and avoiding a division by a zero/negative
 *   `cos(zenith)` when computing the clearness index.
 */
export function decomposeGhi(
  ghiWm2: number,
  sunPosition: SunPositionInput,
): GhiDecomposition {
  const sunAltitude = sunPosition.altitude

  if (
    !Number.isFinite(ghiWm2) ||
    ghiWm2 <= 0 ||
    !Number.isFinite(sunAltitude) ||
    sunAltitude <= 0
  ) {
    return { directWm2: 0, diffuseWm2: 0 }
  }

  const cosZenith = Math.sin(degToRad(sunAltitude))
  const extraterrestrialHorizontal = SOLAR_CONSTANT_W_M2 * cosZenith

  // extraterrestrialHorizontal > 0 here since sunAltitude > 0 was checked
  // above (cosZenith = sin(sunAltitude) > 0).
  const kt = ghiWm2 / extraterrestrialHorizontal

  // Real-world GHI measurements can push kt slightly above the model's
  // ideal [0, ~1] range (e.g. cloud-edge enhancement briefly exceeding the
  // clear-sky/extraterrestrial estimate). The kt > 0.8 branch already
  // returns a flat constant, so an out-of-range kt doesn't blow up the
  // formula; the diffuse-fraction clamp below is the actual safety net.
  const diffuseFraction = Math.min(Math.max(erbsDiffuseFraction(kt), 0), 1)

  const diffuseWm2 = Math.min(Math.max(diffuseFraction * ghiWm2, 0), ghiWm2)
  const directWm2 = Math.max(ghiWm2 - diffuseWm2, 0)

  return { directWm2, diffuseWm2 }
}
