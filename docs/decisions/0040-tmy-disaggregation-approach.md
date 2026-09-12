# 0040. TMY disaggregation approach

Status: accepted

## Context

`simulation/runTmySimulation` (issue #9) needs to turn NASA POWER's
climate normals — one `{ temperatureC, dailyInsolationKWhM2 }` pair per
calendar month (`MonthlyClimateNormal`, issue #6) — into the hourly-ish
time series the `solar-physics` pipeline operates on
(`sunPosition` → `clearSkyIrradiance`/`decomposeGhi` → `poaIrradiance` →
`panelPowerOutput`). NASA POWER's climatology endpoint only exposes
monthly daily-mean insolation, not an hourly curve, so this module has to
synthesize a plausible hourly shape from that single monthly number.

`simulation` is the only module allowed to depend on both
`solar-physics` and `data-sources` per the M1 design spec, so this
disaggregation logic — and its approximations — lives entirely here.

## Decision

### Clearness-index disaggregation

For each month with usable NASA POWER data:

1. Pick a **representative day** for the month (day 15, see below) in a
   **fixed reference year** (`REFERENCE_YEAR = 2025`, a non-leap year, so
   February consistently has 28 days). TMY data has no real year attached
   — this just anchors calendar arithmetic (day-of-year, days-in-month).
2. For every hour of that day, compute `sunPosition()` and
   `clearSkyIrradiance()` to get an hourly clear-sky horizontal GHI
   (direct + diffuse summed), and sum all 24 hours to get that day's
   total **clear-sky** daily insolation.
3. Compute a **clearness factor** =
   `month.dailyInsolationKWhM2 / clearSkyDailyInsolationKWhM2`, i.e. how
   much of the theoretical clear-sky insolation NASA POWER's real-world
   (cloud-inclusive) average actually achieved for that month.
4. Clamp the clearness factor to **`[0, 1.2]`**. The upper bound is
   deliberately > 1: real-world GHI can slightly exceed a simplified
   clear-sky estimate around solar noon under cloud-edge enhancement
   (light reflecting off nearby cloud edges into an otherwise clear sky),
   which is a known effect in irradiance modeling, not a bug in either
   input. 1.2 is a generous but bounded allowance for that; without any
   upper clamp, a location whose real climate normal exceeds this
   module's fixed-turbidity clear-sky model for other reasons (e.g. very
   low real-world turbidity, high altitude — neither of which
   `clearSkyIrradiance` accounts for, see ADR 0011) could otherwise
   produce runaway hourly irradiance once re-scaled.
5. Scale each hour's clear-sky GHI by the clearness factor to get an
   estimated actual hourly GHI, then run that back through
   `decomposeGhi()` to re-derive direct/diffuse. This re-decomposes a
   value that was already direct+diffuse from the clear-sky step — that's
   intentional: scaling a clear-sky GHI down by a uniform factor changes
   the real-world diffuse/direct balance (an overcast hour is
   proportionally far more diffuse than a clear one), and `decomposeGhi`'s
   clearness-index-based Erbs model is exactly the tool for re-deriving
   that balance from the _scaled_ GHI value, not the pre-scaling one.
6. Feed each hour's decomposed direct/diffuse through `poaIrradiance()`
   (system tilt/azimuth) and `panelPowerOutput()` (panel spec, see below),
   using the month's `temperatureC` as a flat ambient temperature for
   every hour (see "Flat monthly temperature" below).
7. Sum the day's 24 hourly power values to get `representativeDayTotalKWh`
   (treating each hourly sample as that hour's average, so a sum of watts
   over 24 samples is a Wh total), then multiply by the reference year's
   actual days-in-month to get `monthlyTotalKWh`. Sum all months for
   `annualTotalKWh`.

### Representative-day-per-month, not a full 365-day simulation

Each month is represented by a single day (the 15th) rather than
simulating all ~30 days individually with day-to-day insolation
variation. NASA POWER's climatology endpoint gives us exactly one number
per month, so there is no real day-to-day signal to simulate anyway — a
365-day simulation built from this input would just repeat the same
representative day with (at best) synthetic noise, adding computational
cost without adding real information. Day 15 is used as a simple
astronomical mid-month approximation without needing a "day where solar
declination equals the month's mean" lookup table; it's a small,
conventional simplification (e.g. also used in some
"typical day of month" solar-resource references).

**Consequence for the heatmap (#16):** the design spec calls for an
hour-of-day × day-of-year heatmap. This gives 12 sparse data points along
the day-of-year axis (`MonthlySimulation.dayOfYear`), not 365 continuous
ones. This is simpler to compute and, given the underlying data really is
monthly-resolution, arguably more honest than interpolating a false
sense of daily precision. The chart is expected to interpolate/fade
between the 12 sampled days. **Possible future enhancement:** a
day-of-year interpolation of clearness factor (e.g. smoothly blending
between adjacent months' factors for days between the two representative
dates) would give a higher-resolution heatmap without needing
higher-resolution input data — flagged as an enhancement, not needed for
M1's acceptance criteria.

### Flat monthly temperature

Every hour of a month's representative day uses the same
`ambientTemperatureC`, taken directly from `MonthlyClimateNormal`, rather
than modeling a diurnal temperature curve (real ambient temperature is
lowest before dawn and peaks in the afternoon, not constant). NASA
POWER's climatology endpoint doesn't provide hourly or min/max
temperature data, only a monthly mean, so any diurnal curve would be
synthesized without real signal behind its shape.

**Known consequence — this slightly over-predicts output.** Generation is
concentrated at midday, when real-world temperature is typically _above_
the daily mean, and the panel temperature-derating term
(`panelPowerOutput`) is more punishing exactly then. Using the flat daily
mean instead of a warmer midday value under-estimates midday cell
temperature, which under-estimates the temperature derate, which slightly
over-estimates midday (and thus total) power output. This is a known,
one-directional bias, not a random error. **Follow-up:** a simple diurnal
temperature model (e.g. a sinusoidal curve anchored to the daily mean and
a typical diurnal range) would reduce this bias without needing better
input data — flagged as a future enhancement.

### Manual shading stacks multiplicatively with system losses

`SystemConfig.manualShadingPercent` and `SystemConfig.systemLossesPercent`
are combined into a single aggregate loss percentage for
`panelPowerOutput`'s `systemLossesPercent` parameter by multiplying their
**retention factors**: `combined = 1 - (1 - systemLosses/100) * (1 -
manualShading/100)`, not by summing the two percentages directly.

This matches how independent loss mechanisms compose physically (each
derate applies to what's left after the others, not to the original
100%), and avoids a `systemLosses + manualShading > 100` edge case
producing a physically meaningless negative power output for two
individually-reasonable percentages (e.g. 60% system losses + 60% shading
would sum to 120%, but multiplicatively retains a sensible
`0.4 * 0.4 = 16%`). `panelPowerOutput` itself already clamps its result
to be non-negative as a last-resort safety net, but the multiplicative
stacking avoids relying on that clamp in ordinary cases.

### `SystemConfig` field naming

`simulation`'s `SystemConfig` type mirrors `src/ui/SystemConfigForm`'s
`SystemConfig` (issue #13 / PR #28) field-for-field where the concepts
overlap (`tiltDeg`, `azimuthDeg`, `efficiencyPercent`,
`tempCoefficientPercentPerC`, `systemLossesPercent`,
`manualShadingPercent`), but replaces that type's `presetId` framing with
an explicit `panelCount` + `wattsPerPanel` pair (rated system capacity =
`panelCount * wattsPerPanel`), per the project owner's decision (issue
#9) — `simulation` doesn't depend on `panel-presets/` or `ui/`, so it
needs its own self-contained representation of "how much rated power this
array has" rather than a preset reference.

## Consequences

- The whole physics + data pipeline can run end-to-end from nothing but a
  lat/lon and a system config, producing a chart-ready `SimulationResult`
  for the Daily (#14), Monthly (#15), and Heatmap (#16) tabs to consume
  directly.
- Accuracy is bounded by how well a single mid-month day's clear-sky
  shape, uniformly scaled by one clearness factor, represents a whole
  month's actual day-to-day variability (which real weather has and this
  model does not) — this is a coarse but standard-in-spirit approach
  (comparable to how simplified TMY-style tools disaggregate monthly
  climate normals) and is expected to be reasonable for investment-decision-grade
  estimates, not a substitute for real hourly TMY datasets.
- Known, documented one-directional biases: the flat-monthly-temperature
  simplification slightly **over-predicts** output (see above). The
  clearness-factor upper clamp at 1.2 bounds, but does not eliminate,
  any mismatch between a location's real clear-sky conditions and this
  project's fixed-turbidity clear-sky model (ADR 0011).
- Follow-up opportunities, not required for M1: a simple diurnal
  temperature model; day-of-year interpolation between representative
  days for a higher-resolution heatmap; a full 365-day simulation if a
  future climate-data source provides genuine daily resolution.
