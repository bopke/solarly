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
 * Configuration for a single physical panel array — one tilt/azimuth/panel
 * grouping. Field names/shape are kept consistent with
 * `src/ui/SystemConfigForm`'s `SystemConfig` type (issue #13 / PR #28), with
 * `panelCount` + `wattsPerPanel` replacing that type's single-preset framing
 * so this module doesn't need to depend on `panel-presets/` or `ui/` — per
 * the settled project-owner decision (see issue #9), an array's rated
 * capacity is `panelCount * wattsPerPanel`.
 *
 * One `SystemConfig.arrays` entry per real roof face / ground-mount plot —
 * see the M2 design spec's "Data flow and the multi-array model" section
 * (`docs/superpowers/specs/2026-09-13-solarly-m2-design.md`) for the
 * motivation (the 3D scene editor produces one entry per traced shape) and
 * issue #54 for the generalization from the M1 flat single-array shape.
 */
export interface PanelArrayConfig {
  /** Panel tilt from horizontal, in degrees (0 = flat, 90 = vertical). */
  tiltDeg: number
  /** Panel azimuth, in degrees clockwise from true north (180 = due south). */
  azimuthDeg: number
  /** Number of panels in this array. */
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
  /**
   * Manual shading derate, as a percentage — a user-estimated stand-in for
   * real geometric shadow-casting (deferred to M3, see the M1 design spec's
   * roadmap section). Stacked multiplicatively with `SystemConfig`'s
   * `systemLossesPercent`, as a second independent derate factor rather
   * than summed with it — see
   * `docs/decisions/0080-tmy-disaggregation-approach.md`. Per-array since
   * different arrays (e.g. differently-oriented roof faces) can be shaded
   * differently.
   */
  manualShadingPercent: number
}

/**
 * User-editable PV system configuration: one or more physical panel arrays
 * plus system-wide losses. Generalized from a flat single-array object to
 * this multi-array shape in issue #54 — see the M2 design spec's "Data flow
 * and the multi-array model" section
 * (`docs/superpowers/specs/2026-09-13-solarly-m2-design.md`) for the full
 * rationale. `src/ui/SystemConfigForm` (single-array UI) adapts its output
 * into a single-element `arrays` array; the M2 3D scene editor will produce
 * one entry per traced shape.
 */
export interface SystemConfig {
  /** The system's physical panel arrays. At least one entry. */
  arrays: PanelArrayConfig[]
  /**
   * Aggregate system-wide losses (wiring, inverter, soiling, mismatch,
   * etc.), as a percentage. Not per-array, since it isn't meaningfully a
   * property of an individual array — see the M2 design spec.
   */
  systemLossesPercent: number
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
  /**
   * Plane-of-array irradiance for this hour, in W/m². For a multi-array
   * `SystemConfig`, this is a panel-count-weighted average across arrays —
   * a display/diagnostic aggregate only, not fed back into `powerW` (each
   * array's own POA irradiance is used for its own power contribution
   * before summing) — see `runTmySimulation`'s `simulateMonth`.
   */
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

/**
 * A point in 3D local meters: x = east, y = north, z = up (ENU). This is a
 * deliberate structural duplicate of `scene/derive/polygonToExtrusionGeometry`'s
 * own `Vec3` (and `solar-physics`'s, used by M3's shadow-casting primitives)
 * rather than an import of either — `simulation/types.ts` stays a plain-data
 * module with no dependency on `scene/`'s or `solar-physics`'s internals, the
 * same call made for `scene/tracing`'s `LatLon` vs. `data-sources`' location
 * types (see issue #66's tracked follow-up). All three `Vec3` shapes are
 * structurally identical by construction, so values flow between them with
 * no conversion needed.
 */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * The geometric scene M3's shadow-casting reads: every traced shape's real
 * 3D extruded plane, every placed obstruction, and every real panel's 3D
 * position — all in one shared scene-local ENU-meters coordinate frame (see
 * `scene/apply/deriveSceneGeometry.ts`'s doc comment for exactly how that
 * frame is established and how each field is derived from
 * `SceneDesignState`).
 *
 * Plain, serializable data — `simulation/` has no dependency on `scene/`
 * code, this type just flows in as data alongside `SystemConfig`, the same
 * way `SystemConfig` itself already flows in from `scene/apply/` today (see
 * `deriveSystemConfigFromScene`). Optional on `runTmySimulation`/
 * `runLiveSimulation`'s inputs — see the M3 design spec's "Simulation loop
 * changes" section (issue #77) for how the per-hour loop uses it once
 * supplied; building this type and its derivation is this issue's (#75)
 * entire scope, using it in the simulation loop is out of scope here.
 */
export interface SceneGeometry {
  /**
   * One entry per traced shape with resolvable geometry (a valid
   * tilt/azimuth config — see `deriveSceneGeometryFromScene`'s doc for what
   * "resolvable" means), each shape's real extruded 3D plane vertices, in
   * the shared scene-local ENU-meters frame described above. `id` matches
   * the traced shape's own id (`SceneDesignState.tracedShapes[].id`), the
   * same keying `SceneDesignState.shapeConfigs`/`panelLayouts` already use.
   */
  shapes: { id: string; vertices: Vec3[] }[]
  /**
   * Every placed obstruction (tree/building), read directly from
   * `SceneDesignState.obstructions` — already in the shared scene-local
   * frame with no translation needed (see `Obstruction.position`'s own doc
   * comment), so this is close to a direct field-for-field copy.
   */
  obstructions: {
    kind: 'tree' | 'building'
    position: { x: number; y: number }
    heightM: number
    radiusM: number
  }[]
  /**
   * One entry per real panel across every shape's panel layout — each
   * panel's actual 3D center position (on its shape's tilted plane), in the
   * shared scene-local ENU-meters frame, keyed by the shape it belongs to
   * (`shapeId`, matching `shapes[].id` above) so a per-array consumer (issue
   * #77) can filter panels to just the array being simulated.
   */
  panels: { shapeId: string; position: Vec3 }[]
}
