/**
 * Panel power output.
 *
 * Converts plane-of-array (POA) irradiance into actual AC/DC-equivalent
 * power output for a specific panel, accounting for cell-temperature
 * derating and system losses. See
 * docs/decisions/0013-poa-transposition-and-power-model.md for the model
 * choices below.
 *
 * Pure function — no I/O, no dependency on any other module. Intended to
 * be used with `poaIrradiance()`'s output as `poaIrradianceWm2`.
 */

/**
 * Minimal panel specification, compatible with (a subset of) the
 * `PanelPreset` type defined in `panel-presets/` (issue #5). Defined
 * locally rather than imported from `panel-presets/` to keep
 * `solar-physics/` dependency-free, per the module boundary in the M1
 * design spec.
 */
export interface PanelSpec {
  /** Rated power output at Standard Test Conditions (STC: 1000 W/m² POA, 25°C cell temp), in watts-peak. */
  ratedWattsPeak: number
  /**
   * Module efficiency at STC, as a percentage (e.g. 21.4 for 21.4%). Not
   * used directly in the power calculation below — `ratedWattsPeak` is
   * already the manufacturer's STC-measured output and is the more
   * physically grounded basis for scaling with irradiance (it captures
   * real module losses that a naive `efficiency * area` computation
   * would miss). Kept in the type for shape-compatibility with
   * `PanelPreset` and for callers that want to display/cross-check it.
   */
  efficiencyPercent: number
  /** Approximate module area, in square meters. Not used in the power calculation (see `efficiencyPercent`); optional. */
  areaM2?: number
  /**
   * Temperature coefficient of power (Pmax), in %/°C. Always negative for
   * real panels: output drops as cell temperature rises above the 25°C
   * STC reference. E.g. -0.34 means power drops 0.34% per °C above 25°C.
   */
  tempCoefficientPercentPerC: number
}

/**
 * Nominal Operating Cell Temperature (NOCT), in °C — the cell temperature
 * a panel reaches under standardized reference conditions (800 W/m² POA
 * irradiance, 20°C ambient air temperature, 1 m/s wind). 45°C is a
 * typical value for crystalline-silicon modules and is used as a fixed
 * default here since M1 has no per-panel NOCT input. See ADR 0013.
 */
export const DEFAULT_NOCT_C = 45

/**
 * Estimates PV cell temperature from ambient air temperature and POA
 * irradiance, using the standard NOCT linear approximation:
 * `cellTemp = ambientTemp + (NOCT - 20) / 800 * poaIrradiance`.
 * This is a widely used simplification (e.g. Duffie & Beckman, "Solar
 * Engineering of Thermal Processes") that ignores wind speed and mounting
 * configuration — see ADR 0013 for the known limitation.
 */
function estimateCellTempC(
  ambientTempC: number,
  poaIrradianceWm2: number,
  noctC: number,
): number {
  return ambientTempC + ((noctC - 20) / 800) * poaIrradianceWm2
}

/**
 * Computes actual panel power output, in watts, given plane-of-array
 * irradiance, panel specs, ambient temperature, and system losses.
 *
 * Model:
 * 1. Base DC power scales linearly with irradiance relative to the STC
 *    reference of 1000 W/m²: `ratedWattsPeak * (poaIrradianceWm2 / 1000)`.
 * 2. Cell temperature is estimated from ambient temperature + irradiance
 *    via the NOCT approximation (see `estimateCellTempC`).
 * 3. A temperature-derating factor is applied:
 *    `1 + (tempCoefficientPercentPerC / 100) * (cellTemp - 25)` — this is
 *    < 1 when the cell is hotter than the 25°C STC reference (the normal
 *    case for a panel in sunlight) since the coefficient is negative, and
 *    > 1 for unusually cold cells.
 * 4. System losses (wiring, inverter, soiling, mismatch, etc., as a
 *    single caller-supplied aggregate percentage) are applied last:
 *    `* (1 - systemLossesPercent / 100)`.
 *
 * The result is clamped to be non-negative — an extreme combination of
 * very high irradiance and hot ambient temperature could otherwise drive
 * the temperature-derating factor negative for a panel with an unusually
 * large temperature coefficient, which has no physical meaning as a power
 * output.
 *
 * @param poaIrradianceWm2 Plane-of-array irradiance, in W/m² (e.g. from
 *   `poaIrradiance()`). Non-finite or non-positive values (sun below the
 *   horizon, or an invalid input) return 0 W.
 * @param panelSpec Panel specification — see `PanelSpec`.
 * @param ambientTempC Ambient air temperature, in °C.
 * @param systemLossesPercent Aggregate system losses, as a percentage
 *   (e.g. 14 for 14% losses from wiring, inverter conversion, soiling,
 *   mismatch, etc.).
 * @param noctC Nominal Operating Cell Temperature, in °C. Defaults to
 *   `DEFAULT_NOCT_C`.
 */
export function panelPowerOutput(
  poaIrradianceWm2: number,
  panelSpec: PanelSpec,
  ambientTempC: number,
  systemLossesPercent: number,
  noctC: number = DEFAULT_NOCT_C,
): number {
  if (!Number.isFinite(poaIrradianceWm2) || poaIrradianceWm2 <= 0) {
    return 0
  }

  const basePowerW = panelSpec.ratedWattsPeak * (poaIrradianceWm2 / 1000)

  const cellTempC = estimateCellTempC(ambientTempC, poaIrradianceWm2, noctC)
  const tempDerateFactor =
    1 + (panelSpec.tempCoefficientPercentPerC / 100) * (cellTempC - 25)

  const lossFactor = 1 - systemLossesPercent / 100

  return Math.max(basePowerW * tempDerateFactor * lossFactor, 0)
}
