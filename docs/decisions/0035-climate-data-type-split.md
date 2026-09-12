# 0035. Split the shared climate type: `HourlyClimate` vs `MonthlyClimateNormal`

Status: accepted

## Context

`src/data-sources/types.ts` originally defined a single shared shape,
`HourlyClimate` (`{ timestamp: string, temperatureC: number, ghiWm2:
number }`), that every `data-sources` client was meant to normalize
its output into. Two clients were built against it in parallel:

- The Open-Meteo client (issue #7) returns genuinely hourly-resolution
  data: `ghiWm2` there is an instantaneous(-ish) reading for a specific
  hour, peaking around 800-1000 W/m^2 for sunny conditions.
- The NASA POWER client (issue #6, ADR 0030) uses POWER's
  `temporal/climatology/point` endpoint, which only ever returns
  20-year monthly normals - one value per calendar month, not per
  hour. To fit `HourlyClimate`, it packed each month's normal into one
  entry (using an arbitrary fixed reference-year timestamp on the
  15th of the month) and converted POWER's native daily-total unit
  (`kWh/m^2/day`) into an average W/m^2 by dividing by 24 - for a
  sunny Colorado January, this comes out to roughly 105 W/m^2.

Both clients satisfied the `HourlyClimate` interface. Both were
individually correct and well-documented (ADR 0030 is explicit that
its output is a daily _average_, not a peak or diurnal curve). But a
downstream consumer of `HourlyClimate[]` - `simulation/`, not yet
built (issue #9) - would see two producers of the identical type and
field name, `ghiWm2`, whose values differ by roughly 4-8x for
physically comparable conditions, with nothing in the type system or
the value itself to distinguish "this is an hourly instantaneous
reading" from "this is a monthly daily-mean". A caller that assumed
either meaning uniformly (exactly the assumption the Open-Meteo type
doc comment invited: "`simulation/` consumes this shape uniformly
regardless of which underlying API/mode produced it") would silently
under- or over-predict generation by several-fold, with no error or
type mismatch to catch it. This was flagged in review of PR #24 (the
NASA POWER client) once both clients existed and could be compared
side by side.

## Decision

Split the one shared type into two, both in `src/data-sources/types.ts`:

- **`HourlyClimate`** - unchanged shape, `{ timestamp: string,
temperatureC: number, ghiWm2: number }`. Now documented as
  hourly-resolution, instantaneous(-ish) data specifically. This is
  the Open-Meteo client's output type.
- **`MonthlyClimateNormal`** - new, `{ month: number, temperatureC:
number, dailyInsolationKWhM2: number }`.
  - `month` is 1 (January) through 12 (December) - there's no real
    date to anchor a monthly normal to, so this drops the
    manufactured-timestamp workaround entirely instead of stretching
    `HourlyClimate`'s timestamp field to cover a non-hourly shape.
  - `dailyInsolationKWhM2` keeps NASA POWER's native unit
    (`ALLSKY_SFC_SW_DWN` reports `kWh/m^2/day`) instead of converting
    to a lossy average-W/m^2 figure. Two things motivate keeping the
    native unit specifically: no precision/information is lost in a
    unit conversion nobody asked for, and a field named
    `dailyInsolationKWhM2` cannot be mistaken for - or silently
    averaged together with - `HourlyClimate.ghiWm2`, unlike the
    previous setup where both were `ghiWm2` and only a doc comment
    (easy to miss, easy to go stale) explained the difference. This is
    the NASA POWER client's output type (`fetchNasaPowerClimateNormals`
    in `src/data-sources/nasa-power/client.ts`).

`HourlyClimate`'s shape is intentionally left untouched (not renamed,
no fields added) so that this branch and the Open-Meteo branch, which
independently defined the identical interface, reconcile without
conflict when both land.

## Consequences

- `data-sources` clients now produce two distinct, non-interchangeable
  shapes. Any future client must pick whichever actually matches its
  data's resolution rather than defaulting to `HourlyClimate` for
  convenience - if a client's data is monthly, seasonal, or otherwise
  not per-hour, it should get its own type (or reuse
  `MonthlyClimateNormal` if it's genuinely a monthly normal) rather
  than forcing a mismatched shape.
- **This creates work for `simulation/` (issue #9, TMY orchestration),
  not yet built.** `simulation/` now needs to accept
  `MonthlyClimateNormal[]` from the NASA POWER path and turn it into
  an hourly time series itself, rather than consuming a
  pre-flattened-to-hourly array uniformly regardless of source. The
  expected technique is a standard clearness-index disaggregation:
  for each month, take `solar-physics`'s clear-sky diurnal curve
  (already computed from sun position) as the _shape_ of the day, and
  scale it so its integral over the days in that month matches the
  month's known `dailyInsolationKWhM2` total - rather than assuming
  clear-sky conditions exactly, which would ignore the very averaging
  (cloud cover, etc.) that the monthly normal already encodes. This is
  materially different from how the Open-Meteo (`HourlyClimate`) path
  is consumed, which already has real hourly values and needs no
  disaggregation - `simulation/`'s orchestration logic should branch
  on which shape it received (or take them via two distinct code
  paths/functions) rather than trying to unify them into one internal
  representation before this disaggregation happens.
- ADR 0030 (NASA POWER client) is updated in place to reference
  `MonthlyClimateNormal` and the native `kWh/m^2/day` unit instead of
  `HourlyClimate`/`ghiWm2`; its endpoint choice, monthly-granularity
  reasoning, and error classification are otherwise unaffected by this
  split.
