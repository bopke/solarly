# 0016. Live forecast orchestration (`runLiveSimulation`)

Status: accepted

## Context

Issue #10 asks for `simulation/`'s Live mode orchestration:
`runLiveSimulation({ location, systemConfig }) -> SimulationResult`, wiring
the Open-Meteo `data-sources` client (issue #7) through the `solar-physics`
pipeline (issues #2-4, #32). Unlike TMY mode (issue #9), which needs to
disaggregate a climate-normal daily GHI value into synthetic hourly
profiles, Live mode already gets real per-hour GHI from Open-Meteo, so the
orchestration is a straightforward per-hour map:
`sunPosition -> decomposeGhi -> poaIrradiance -> panelPowerOutput`.

Three things needed a decision that weren't fully settled by the upstream
modules alone:

1. Open-Meteo's `shortwave_radiation` (GHI) is a **backward-looking hourly
   mean** — the value stamped at `HH:00Z` is the average irradiance over
   `(HH-1):00Z` to `HH:00Z`, not an instantaneous sample at `HH:00Z` (see
   ADR 0040 and `HourlyClimate.ghiWm2`'s doc comment). `sunPosition()`,
   `decomposeGhi()`, and `poaIrradiance()` all expect a sun-geometry instant
   paired with an irradiance value describing _that_ instant. Naively
   computing sun position at exactly `HH:00Z` pairs an averaged irradiance
   value with the sun geometry from the _end_ of its averaging window — a
   ~30-minute misalignment that's largest (in relative terms) near
   sunrise/sunset, where irradiance and sun altitude both change fastest.
2. How `manualShadingPercent` stacks with `panelPowerOutput()`'s existing
   `systemLossesPercent` parameter.
3. What shape `SimulationResult` should take, given issue #9 (TMY mode)
   hasn't landed yet but is expected to produce a compatible/shared shape
   for chart components (issue #17, the "Forecast" chart tab, plus TMY's
   Daily/Monthly/Heatmap tabs).

## Decision

**1. Sun position at the interval midpoint.** For each `HourlyClimate`
entry stamped `HH:00Z`, `runLiveSimulation` computes `sunPosition()` at
`HH:00Z minus 30 minutes` — the midpoint of the averaging window — rather
than at `HH:00Z` itself. This is the simplest correction that doesn't
require re-deriving Open-Meteo's averaging math: it just shifts the sun
observation point to better represent "the sun position typical of the
period this GHI value describes." The output `HourlyPowerPoint.timestamp`
is still the original `HH:00Z` stamp (matching the source `HourlyClimate`
and what a chart x-axis should show); only the _internal_ sun-position
computation uses the shifted instant.

This is a documented approximation, not an exact fix — real irradiance
within the hour isn't necessarily symmetric around the midpoint (e.g. a
passing cloud), but it's a strict improvement over using the interval-end
instant, is O(1) to implement, and requires no new dependency or model.
The residual error is small except very close to sunrise/sunset, where
`decomposeGhi()`'s and `poaIrradiance()`'s own low-sun guards already limit
how much a small sun-position error can distort the result.

**2. Loss stacking: `systemLossesPercent` and `manualShadingPercent`
multiply as independent derate factors.** `panelPowerOutput()` already
applies `systemLossesPercent` internally. `runLiveSimulation` applies
`manualShadingPercent` as a second, independent multiplicative factor on
top of that function's output:

```
finalWatts = panelPowerOutput(poa, panelSpec, ambientTempC, systemLossesPercent)
           * (1 - manualShadingPercent / 100)
```

i.e. the combined loss factor is
`(1 - systemLossesPercent / 100) * (1 - manualShadingPercent / 100)`, not
`1 - (systemLossesPercent + manualShadingPercent) / 100`. Multiplicative
stacking is the physically correct treatment of two independent loss
mechanisms (wiring/inverter/soiling/mismatch vs. shading) and avoids the
double-counting failure mode of additive stacking once combined
percentages approach 100%. This is the convention `runLiveSimulation`
establishes for `simulation/`; TMY mode (issue #9) should use the same
formula for consistency between modes, reconciling if #9 lands with a
different convention.

**3. `SimulationResult` shape**, defined in `src/simulation/types.ts`:

```ts
interface SimulationResult {
  mode: 'live' | 'tmy'
  location: { lat: number; lon: number }
  hourlyWattsSeries: { timestamp: string; watts: number }[]
}
```

`hourlyWattsSeries` is the shared field both modes are expected to
populate — an hourly power curve, ordered by timestamp, with `timestamp`
as an ISO 8601 UTC string and `watts` as instantaneous(-equivalent) power
output for that hour. For Live mode this spans Open-Meteo's forecast
horizon (3-7 days) and feeds the Forecast chart tab (issue #17) directly.
TMY mode is expected to populate the same field with a representative
year's hourly series (or per-representative-day series — left to #9 to
decide) so Daily/Monthly/Heatmap chart components can share
aggregation/formatting logic where useful; `mode` lets chart code
branch on mode-specific behavior (e.g. only Live mode showing the
Forecast tab, per the M1 design doc) without inspecting the data shape
itself. This is a reasonable-effort shared design made without #9 having
landed yet — if #9's needs turn out to require a different or extended
shape, reconcile then rather than blocking #10 on it.

## Consequences

- The midpoint adjustment is invisible to `SimulationResult` consumers
  (chart components) — it only affects the internal sun-position
  computation, not any exposed timestamp — so it can be revisited later
  (e.g. switching to `shortwave_radiation_instant` if Open-Meteo's
  instantaneous variant is ever preferred) without a breaking type change.
- The loss-stacking formula is now a cross-module convention (`simulation/`
  in general, not just Live mode); if TMY mode's implementation (#9)
  chooses differently, that's a discrepancy worth reconciling explicitly
  rather than silently diverging.
- `SimulationResult`'s shape is provisional pending #9. Fields specific to
  one mode only (e.g. a TMY representative-day selector, if #9 needs one)
  should be added as optional/mode-specific fields alongside
  `hourlyWattsSeries`, not by changing `hourlyWattsSeries`'s meaning.
