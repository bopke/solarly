/**
 * Public types for SystemConfigForm.
 *
 * These describe the shape of a solar panel system's configuration as
 * edited by the user in the sidebar form. Consumers (e.g. the app shell,
 * or eventually `simulation`) should depend only on these types, not on
 * the form's internal state representation.
 */

/** The set of system-config fields the form manages. */
export interface SystemConfig {
  /**
   * Id of the currently-selected panel preset, or `null` if the fields
   * have been customized away from any preset (or none was ever picked).
   * Purely informational — selecting a preset only prefills the fields
   * below, which remain independently editable afterwards.
   */
  presetId: string | null
  /** Panel tilt angle from horizontal, in degrees. Valid range: 0-90. */
  tiltDeg: number
  /**
   * Panel azimuth (compass direction the panel array faces), in degrees
   * clockwise from true north (0=N, 90=E, 180=S, 270=W). Valid range: 0-360.
   */
  azimuthDeg: number
  /** Number of panels in the array. Must be a positive integer. */
  panelCount: number
  /** Panel efficiency at STC, as a percentage. Valid range: 0-100. */
  efficiencyPercent: number
  /**
   * Temperature coefficient of power (Pmax), in %/°C. Typically negative
   * (output drops as cell temperature rises above the 25°C STC reference).
   */
  tempCoefficientPercentPerC: number
  /** System losses (wiring, inverter, soiling, etc.), as a percentage. Valid range: 0-100. */
  systemLossesPercent: number
  /**
   * Manual shading factor, as a percentage of output lost to shading.
   * Stand-in for a future 3D-derived shading estimate (see M2/M3 in the
   * design spec) — valid range: 0-100.
   */
  manualShadingPercent: number
}

/** Field-level validation errors, keyed by `SystemConfig` field name (excluding `presetId`). */
export type SystemConfigFieldErrors = Partial<
  Record<Exclude<keyof SystemConfig, 'presetId'>, string>
>

/**
 * Callback invoked whenever the form's config or validity changes.
 *
 * `config` reflects the best-effort parsed numeric values (an invalid or
 * empty field falls back to its last valid value, or 0, so the shape is
 * always a complete `SystemConfig`) — always check `isValid` before
 * treating `config` as trustworthy input to a calculation, since invalid
 * values are surfaced inline rather than clamped or rejected outright.
 */
export type SystemConfigChangeHandler = (
  config: SystemConfig,
  isValid: boolean,
) => void
