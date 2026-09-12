/**
 * Shared `simulation/` types. See docs/decisions/0016-live-forecast-orchestration.md
 * for the rationale behind the `SimulationResult` shape.
 */

/** Geographic location, matching the shape used throughout `simulation/` and `ui/`. */
export interface Location {
  /** Latitude in degrees, positive north (-90 to 90). */
  lat: number
  /** Longitude in degrees, positive east (-180 to 180). */
  lon: number
}

/**
 * User-editable PV system configuration, as collected by the system-config
 * form (issue #13). Field names intentionally match the form's field names
 * 1:1 so `simulation/` callers can pass the form state straight through.
 */
export interface SystemConfig {
  /** Panel tilt from horizontal, in degrees (0 = flat, 90 = vertical). */
  tiltDeg: number
  /** Panel's facing direction, in degrees clockwise from true north (0-360). */
  azimuthDeg: number
  /** Number of panels in the array. */
  panelCount: number
  /** Rated power per panel at STC, in watts-peak. */
  wattsPerPanel: number
  /** Module efficiency at STC, as a percentage. Not used in the power calculation (see `solar-physics`'s `PanelSpec`); kept for display/cross-check. */
  efficiencyPercent: number
  /** Temperature coefficient of power (Pmax), in %/°C. Always negative for real panels. */
  tempCoefficientPercentPerC: number
  /** Aggregate system losses (wiring, inverter, soiling, mismatch, etc.), as a percentage. */
  systemLossesPercent: number
  /**
   * Manual shading derate, as a percentage, entered directly by the user
   * (M1 has no geometric shading model — see the M1 design doc's M2/M3
   * roadmap notes). Applied as an additional multiplicative loss factor
   * alongside `systemLossesPercent` — see ADR 0016 for the stacking
   * formula.
   */
  manualShadingPercent: number
}

/** One point of an hourly power time series. */
export interface HourlyPowerPoint {
  /**
   * ISO 8601 UTC timestamp identifying the hour this power value applies
   * to. For live/forecast results this is exactly the source
   * `HourlyClimate.timestamp` (the `HH:00Z` interval-end stamp Open-Meteo
   * publishes) — NOT the midpoint-adjusted instant used internally to
   * compute sun position for that hour. See ADR 0016.
   */
  timestamp: string
  /** Panel array power output for this hour, in watts. Non-negative. */
  watts: number
}

/** Which climate data source/mode produced a `SimulationResult`. */
export type SimulationMode = 'live' | 'tmy'

/**
 * Typed time-series result of running the `solar-physics` pipeline over a
 * climate data series, for chart components to render. Shared across both
 * Live (issue #10, this module) and TMY (issue #9) modes so chart code can
 * consume a single shape regardless of mode — see ADR 0016's "SimulationResult
 * shape" section for the reasoning and what TMY mode is expected to add.
 */
export interface SimulationResult {
  /** Which mode produced this result. */
  mode: SimulationMode
  /** The location the simulation was run for. */
  location: Location
  /**
   * Hourly power output series across the simulated horizon, ordered by
   * timestamp ascending. For Live mode this spans Open-Meteo's forecast
   * horizon (typically 3-7 days, see the M1 design doc); may have gaps if
   * the underlying climate data source dropped hours (e.g. Open-Meteo's
   * null-padded short-horizon variables).
   */
  hourlyWattsSeries: HourlyPowerPoint[]
}
