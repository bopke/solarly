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
2. For every **local solar hour** of that day (see "Local solar time
   hour-stepping" below), compute `sunPosition()` and
   `clearSkyIrradiance()` to get an hourly clear-sky horizontal GHI
   (direct + diffuse summed).
3. Compute a **clearness factor** =
   `month.dailyInsolationKWhM2 / clearSkyDailyInsolationKWhM2`, i.e. how
   much of the theoretical clear-sky insolation NASA POWER's real-world
   (cloud-inclusive) average actually achieved for that month. The
   denominator is the **month-averaged** clear-sky daily insolation, not
   day 15's alone — see "Month-averaged clear-sky denominator" below.
4. Clamp the clearness factor to **`[0, 1.2]`**, as a rare safety net
   against a genuinely implausible climate normal (e.g. bad input data),
   not as a routine correction — see "Month-averaged clear-sky
   denominator" below for why the clamp used to bind routinely and no
   longer should.
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

### Local solar time hour-stepping

Each representative day's hourly loop steps through **local solar
hours**, approximated as a simple longitude offset from UTC
(`hourOffset = -longitude / 15`, i.e. 15° of longitude ≈ 1 hour), rather
than raw UTC hours of the calendar date. No timezone database or DST
lookup is used — same simple approach used elsewhere in this project
(e.g. the location picker's timezone approximation) — just enough to
align "hour 12" with roughly local solar noon.

**This was originally UTC-stepped, and that was a real bug** (found in
PR #35 review): annual/monthly _totals_ are unaffected by which 24 clock
hours the loop steps through — a fixed relabeling of the same 24 samples
doesn't change their sum — but the hour-by-hour _shape_ was wrapped and
mis-centered for any location far from UTC. Tokyo (UTC+9) would show its
generation peak at "hour 3", and locations near the international date
line (e.g. Fiji) would show a double-lobed curve split across the UTC
midnight boundary. Since `HourlyPoint.hour` is exactly what the Daily
chart (#14) and the hour-of-day × day-of-year heatmap (#16) plot, this
would have rendered as a visibly broken, discontinuous curve for a large
fraction of the world's population — not a subtle numerical bias, a
"this app is buggy" bug. Stepping in local solar time instead centers
every location's peak at hour ≈ 12 and keeps the nighttime hours as one
contiguous block, regardless of longitude.

### Month-averaged clear-sky denominator

The clearness-factor denominator is the **month-averaged** clear-sky
daily insolation — clear-sky insolation computed for every day of the
month and averaged — not a single representative day's (e.g. day 15's)
alone.

**This was originally day-15-only, and that was a real bug** (found in
PR #35 review): a single day's clear-sky estimate can diverge enough from
the month's true average that even a genuinely clear month exceeds it,
which was routinely — not rarely — triggering the `[0, 1.2]` upper clamp
on this project's own Phoenix test fixture (8 of 12 months had a raw
clearness factor above 1.0; January's 1.2075 was clamped, silently
discarding real measured insolation). The clamp's original justification
("cloud-edge enhancement can occasionally push real GHI slightly above a
simplified clear-sky estimate") named the wrong mechanism and the wrong
failure direction: cloud-edge enhancement is a sub-minute effect that
doesn't meaningfully survive a monthly-mean daily total, and the
single-day denominator was the thing causing the truncation, not
protecting against it. Averaging clear-sky insolation across the whole
month removes most of this artificial variance, so the clamp goes back to
being what it should be: a rare safety net against a genuinely
implausible climate normal (e.g. corrupted input data), not a routine
truncation of legitimate high-clearness sites (which, not coincidentally,
are often the most attractive real-world PV locations). The clamp itself
is unchanged (`[0, 1.2]`) and kept for that safety-net role; only its
denominator and its documented rationale changed. Some residual bias
above 1.0 remains for this fixture even after averaging (the fixed
sea-level turbidity and lack of a solar-constant eccentricity correction
in `clearSkyIrradiance`, see ADR 0011, aren't addressed by this fix) —
that's a separate, deeper clear-sky-model calibration question flagged as
a follow-up, not something the denominator choice alone can fully
correct.

This same averaging pass also mitigates (see "Representative-day-per-month"
below) the high-latitude polar-night failure mode: at latitude ≥ ~67°, day
15 of a winter month can itself have zero clear-sky insolation (the sun
never rises that day), which used to force the clearness factor to 0 and
silently discard the entire month's real measured insolation even though
the month has some daylight at its edges. The month-average denominator
is computed from every day in the month, so it stays positive as long as
_any_ day in the month has some daylight — only a month that is
genuinely polar-night on every single day produces a zero denominator,
which is the physically correct case for a zero clearness factor. The
hourly _shape_, however, still defaults to day 15's own curve (a fine
mid-month stand-in on an ordinary day) — for the degenerate case where
day 15 itself has zero daylight but the month average is positive, the
shape falls back to the month's single best-daylight day instead, so the
representative day's curve isn't all-zero for a month that genuinely has
some real insolation. `clearnessFactor` and `monthlyTotalKWh` are also
guarded with an explicit `Number.isFinite` check so a degenerate
division can never leak a `NaN`/`Infinity` into the result; a truly
all-polar-night month reports a genuine `0`, not an artifact.

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
  simplification slightly **over-predicts** output (see above). Some
  residual clearness-factor bias above 1.0 remains even after the
  month-averaged denominator fix, from `clearSkyIrradiance`'s fixed
  sea-level turbidity and lack of a solar-constant eccentricity
  correction (ADR 0011) — the clearness-factor upper clamp at 1.2 exists
  as a rare safety net against a genuinely implausible climate normal,
  not as a routine correction for this residual bias.
- With both fixes (local solar time hour-stepping, month-averaged
  clear-sky denominator) applied, this project's Phoenix test fixture
  produces ~1,960 kWh/kWp/year, which is on the high side of but within a
  PVWatts-style ~1,500-2,200 kWh/kWp plausibility band for a
  well-performing system at a sunny site — consistent with the documented
  one-directional over-prediction bias above (flat monthly temperature +
  no separate inverter-efficiency derate), not a sign of a broken
  pipeline.
- Follow-up opportunities, not required for M1: a simple diurnal
  temperature model; day-of-year interpolation between representative
  days for a higher-resolution heatmap; a full 365-day simulation if a
  future climate-data source provides genuine daily resolution; an
  elevation/eccentricity correction to `clearSkyIrradiance`'s turbidity
  model to remove the residual >1.0 clearness-factor bias noted above.
