/**
 * Public types for the `simulation` module. See `runTmySimulation.ts` and
 * `runLiveSimulation.ts` for the orchestration logic that produce
 * {@link TmySimulationResult} and {@link LiveSimulationResult} respectively,
 * `docs/decisions/0080-tmy-disaggregation-approach.md` for the TMY modeling
 * choices, and `docs/decisions/0016-live-forecast-orchestration.md` for the
 * live/forecast orchestration and the rationale behind the discriminated
 * `SimulationResult` union.
 */

/** A geographic location, in decimal degrees. */
export interface Location {
  /** Latitude, positive north (-90 to 90). */
  lat: number
  /** Longitude, positive east (-180 to 180). */
  lon: number
  /**
   * A rough whole-hour UTC offset for this location, when known — see
   * `ResolvedLocation.utcOffsetHours` in `src/ui/LocationPicker.tsx` for
   * where this comes from (a longitude-derived approximation, not a real
   * IANA timezone lookup). Optional and orchestration-agnostic: TMY mode
   * has no use for it today, and Live mode's `runLiveSimulation` just
   * passes the input `location` through unchanged, so this field survives
   * onto `LiveSimulationResult.location` whenever the caller supplied it.
   * Consumers (e.g. `ForecastChart`) can use it to format timestamps in
   * the panel's local time instead of the viewer's browser timezone.
   */
  utcOffsetHours?: number
}

/**
 * User-editable PV system configuration, as collected by the system-config
 * form (issue #13). Field names/shape are kept consistent with
 * `src/ui/SystemConfigForm`'s `SystemConfig` type (issue #13 / PR #28), with
 * `panelCount` + `wattsPerPanel` replacing that type's single-preset framing
 * so this module doesn't need to depend on `panel-presets/` or `ui/` — per
 * the settled project-owner decision (see issue #9), the simulation's rated
 * system capacity is `panelCount * wattsPerPanel`.
 */
export interface SystemConfig {
  /** Panel tilt from horizontal, in degrees (0 = flat, 90 = vertical). */
  tiltDeg: number
  /** Panel azimuth, in degrees clockwise from true north (180 = due south). */
  azimuthDeg: number
  /** Number of panels in the array. */
  panelCount: number
  /** Rated power per panel at STC, in watts-peak. */
  wattsPerPanel: number
  /** Module efficiency at STC, as a percentage. Not used in the power
   * calculation (see `solar-physics/panelPowerOutput`'s `PanelSpec` doc) —
   * kept here for shape-compatibility with the UI's config type and for
   * display purposes. */
  efficiencyPercent: number
  /** Temperature coefficient of power (Pmax), in %/°C. Negative for real panels. */
  tempCoefficientPercentPerC: number
  /** Aggregate system losses (wiring, inverter, soiling, mismatch, etc.), as a percentage. */
  systemLossesPercent: number
  /**
   * Manual shading derate, as a percentage — a user-estimated stand-in for
   * real geometric shadow-casting (deferred to M3, see the M1 design spec's
   * roadmap section). Stacked multiplicatively with `systemLossesPercent`,
   * as a second independent derate factor rather than summed with it — see
   * `docs/decisions/0080-tmy-disaggregation-approach.md`.
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

/** One hour of a representative day's simulated output. */
export interface HourlyPoint {
  /** Hour of day, 0-23, in local solar time (approximated as a longitude offset from UTC — see the ADR's note on the representative-day convention). */
  hour: number
  /** Plane-of-array irradiance for this hour, in W/m². */
  poaIrradianceWm2: number
  /** Panel array power output for this hour, in watts. */
  powerW: number
}

/** Simulated results for one calendar month's representative day. */
export interface MonthlySimulation {
  /** Calendar month, 1 (January) through 12 (December). */
  month: number
  /** Day-of-year (1-366) of this month's representative day in the fixed reference year — see `REFERENCE_YEAR`. Intended as the heatmap's sparse day-of-year axis value for this month. */
  dayOfYear: number
  /** Flat ambient temperature used for every hour of the representative day, taken directly from the month's climate normal. */
  ambientTemperatureC: number
  /** Clearness scale factor applied to clear-sky irradiance to approximate this month's real-world average conditions, clamped to `[0, 1.2]` — see the ADR. */
  clearnessFactor: number
  /** Hourly curve for the representative day, 24 entries (hour 0-23). */
  representativeDayHourly: HourlyPoint[]
  /** Total energy generated by the representative day, in kWh. */
  representativeDayTotalKWh: number
  /** Number of calendar days in this month, in the fixed reference year. */
  daysInMonth: number
  /** Estimated monthly total energy: `representativeDayTotalKWh * daysInMonth`, in kWh. */
  monthlyTotalKWh: number
}

/** Which climate data source/mode produced a `SimulationResult`. */
export type SimulationMode = 'live' | 'tmy'

/**
 * Full TMY (long-term climate-normal) simulation result: a representative
 * day per available calendar month, plus monthly and annual aggregates.
 * Designed to be consumed directly by the Daily (#14), Monthly (#15), and
 * Heatmap (#16) chart tabs.
 */
export interface TmySimulationResult {
  /** Discriminant identifying this as a TMY-mode result. */
  mode: 'tmy'
  location: Location
  systemConfig: SystemConfig
  /**
   * Fixed calendar year used to derive each representative day's date and
   * days-in-month — see `REFERENCE_YEAR`. Not a forecast year; TMY data has
   * no real year attached, this just anchors calendar arithmetic.
   */
  referenceYear: number
  /**
   * Per-month simulation results, one entry per month NASA POWER had
   * usable data for (1-12 entries, ascending by `month` — see
   * `MonthlyClimateNormal`'s "months may be dropped" note). Index by the
   * `month` field, not array position.
   */
  months: MonthlySimulation[]
  /** Estimated total annual energy generation, summed across `months`, in kWh. */
  annualTotalKWh: number
}

/**
 * Typed time-series result of running the `solar-physics` pipeline over a
 * live/forecast climate data series, for chart components to render. See
 * ADR 0016's "SimulationResult shape" section for the reasoning.
 */
export interface LiveSimulationResult {
  /** Discriminant identifying this as a Live-mode result. */
  mode: 'live'
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

/**
 * Result of running the `solar-physics` pipeline, discriminated by `mode`.
 * Shared across both Live (issue #10) and TMY (issue #9) modes so callers
 * can narrow on `mode` to get the shape appropriate to each — see ADR 0016.
 */
export type SimulationResult = TmySimulationResult | LiveSimulationResult
