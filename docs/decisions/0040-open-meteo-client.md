# 0040. Open-Meteo client: endpoint and direct-GHI fetch

Status: accepted

## Context

Issue #7 asks for a `data-sources/` client that fetches an hourly forecast
from Open-Meteo for a given lat/lon and normalizes it into the shared
`HourlyClimate` shape (`{ timestamp, temperatureC, ghiWm2 }`) described in
`docs/superpowers/specs/2026-09-12-solarly-m1-design.md`.

**Correction to an earlier assumption in this ADR (and in the design
spec):** an earlier version of this decision, and
`docs/superpowers/specs/2026-09-12-solarly-m1-design.md:32`, assumed
Open-Meteo's free forecast API "doesn't publish irradiance for this use
case", and built `ghiWm2` by reconstructing it from a cloud-cover forecast
(Kasten & Czeplak (1980) attenuation applied to a self-contained Haurwitz
clear-sky estimate in a now-deleted `clear-sky.ts`). That assumption was
false: the free, keyless Open-Meteo forecast API does publish irradiance
directly. Requesting `shortwave_radiation` as an hourly variable returns
global horizontal irradiance (GHI, W/m^2) for exactly this use case,
alongside `direct_radiation`, `diffuse_radiation`,
`direct_normal_irradiance`, and `global_tilted_irradiance` if ever needed.
This was caught in review (verified live against the API and against
https://open-meteo.com/en/docs) and is corrected here. The design spec's
data-sources section (`...m1-design.md:32`) is now slightly stale on this
point — it is not being edited as part of this ADR, but a future spec pass
should update it to match.

**Correction to a second earlier claim in this ADR, caught in re-review:**
an earlier version of this ADR also described `shortwave_radiation` as
"instantaneous". That is wrong. Open-Meteo's own docs state it plainly:
`shortwave_radiation` is "shortwave solar radiation as average of the
preceding hour" — a backward-looking hourly mean, not a point sample.
Open-Meteo separately publishes a `shortwave_radiation_instant` variable
("solar radiation averaged over the past hour; use instant for radiation
at the indicated time") which _is_ instantaneous. This was confirmed both
against the docs and empirically: on a live pull, the unsuffixed series
visibly lags the `_instant` series (e.g. an evening hour after sunset
still reports a small positive `shortwave_radiation` because the sun was
still up for part of the preceding hour, while `_instant` is already 0).
See "Instantaneous vs. hourly-mean irradiance" below for why the
non-instantaneous variable was kept anyway.

## Decision

- **Endpoint and parameters**: `GET https://api.open-meteo.com/v1/forecast`
  with `hourly=temperature_2m,shortwave_radiation`, `timezone=UTC`, and
  `forecast_days` defaulting to 7 (clamped to Open-Meteo's documented
  `[1, 16]` range; non-integer or non-finite values are rejected rather
  than silently coerced or forwarded as-is). `timezone=UTC` is used so the
  "naive" hourly timestamps Open-Meteo returns (no UTC offset) can be
  treated as UTC unambiguously — the client appends `:00Z` to produce ISO
  8601 UTC timestamps for `HourlyClimate.timestamp`. 7 days matches the top
  of the "3-7 days" forecast horizon called out in the design doc and
  issue; `forecastDays` is exposed as an option for callers that want
  fewer.

- **GHI is read directly from `shortwave_radiation`** — no cloud-cover
  reconstruction. This replaces the original design (cloud-cover
  attenuation of a self-contained clear-sky estimate): it's simpler (one
  fewer moving part, no second solar-position implementation living in
  `data-sources/`) and more accurate (a real forecasted irradiance value
  from Open-Meteo's underlying weather model, rather than three compounding
  approximations: approximate solar position -> approximate clear-sky ->
  empirical cloud curve). `cloud_cover` is no longer requested since
  nothing in this client uses it.

  This also resolves a duplication concern from the original design:
  `src/data-sources/clear-sky.ts` (a temporary, reduced-precision
  reimplementation of sun-position/clear-sky physics, built only to
  support the attenuation approach) and its tests have been deleted
  outright, along with `attenuateForCloudCover`. There is no longer a
  second solar-position/clear-sky implementation living in `data-sources/`
  to reconcile once `solar-physics/` lands.

- **Null-padded hours are dropped, not defaulted.** Open-Meteo pads
  variables whose source model has a shorter horizon than the requested
  `forecast_days` with JSON `null` (the `time` array is always fully
  populated; other arrays may contain `null` entries at the tail). Both
  `temperature_2m` and `shortwave_radiation` are typed as
  `Array<number | null>` in the response, and any hour where either is
  `null` is filtered out of the returned `HourlyClimate[]` entirely — it is
  never coerced to `0` (which would misrepresent an unknown value as "no
  temperature" or "no sun") and never passed through as `null` in a
  `number`-typed field. `HourlyClimate` itself keeps `ghiWm2` and
  `temperatureC` as plain `number` — the "unknown" case is represented by
  the hour's absence from the array, not by a nullable field, so consumers
  never need to null-check every entry.

- **Response validation**: a `200` response missing the `hourly` field
  throws a clear, specific error instead of letting a raw destructuring
  `TypeError` propagate. If `temperature_2m` or `shortwave_radiation`
  aren't the same length as `time`, the client throws rather than silently
  emitting `undefined`/`NaN` entries.

- **Error responses surface Open-Meteo's actual reason.** Open-Meteo
  returns `{"error":true,"reason":"..."}` in the body on failure, and
  `statusText` is frequently empty over HTTP/2. The client reads `reason`
  from the body (best-effort; falls back to just the status if the body
  isn't parseable JSON) and includes it in the thrown error message.

- **Instantaneous vs. hourly-mean irradiance**: `shortwave_radiation` (used
  here) is a backward-looking hourly mean, not an instantaneous sample —
  the value stamped at timestamp `HH:00Z` is the average irradiance over
  `(HH-1):00Z` to `HH:00Z`. `shortwave_radiation_instant` exists and is a
  genuine point sample at `HH:00Z`, but the hourly mean was kept
  deliberately: for hourly PV energy, `Wh/m² = mean W/m² × 1 h` exactly,
  whereas a point sample at the hour boundary is a biased estimator of the
  hour's actual energy (worse near sunrise/sunset, where irradiance changes
  fastest within the hour). The trade-off is that pairing this value with a
  sun position computed exactly _at_ `HH:00Z` (as a solar-position/POA
  transposition step would) introduces a ~30-minute misalignment between
  the irradiance interval and the sun-geometry instant — see the
  `HourlyClimate.ghiWm2` doc comment in `src/data-sources/types.ts` and the
  Consequences section below. A future `simulation` module (issue #9/#10)
  that combines this data with `solar-physics` sun-position calculations
  should account for this rather than treating the two as time-aligned.

- **Shared `HourlyClimate` type**: defined in `src/data-sources/types.ts`
  on this branch since it didn't already exist. A sibling PR for the NASA
  POWER client is being built in parallel and may define this type
  independently — whichever PR merges second should reconcile onto a
  single definition rather than keeping two copies in sync.

## Consequences

- `ghiWm2` in `HourlyClimate` produced by this client is now a real,
  directly-forecasted GHI value from Open-Meteo (a backward-looking hourly
  mean, not an instantaneous sample — see above), rather than a derived
  estimate — more accurate than the original cloud-cover attenuation
  approach, and with strictly less code to maintain. The ~30-minute
  interval-vs-instant misalignment described above is a known limitation
  the future `simulation` module (issue #9/#10) needs to account for.
- Hours with null-padded source data are simply absent from the result
  rather than present with a wrong or fabricated value; callers that need
  a fixed-length hourly series (e.g. for a chart x-axis) should build it by
  keying off `timestamp`, not by assuming one entry per requested hour.
- `HourlyClimate` may need a follow-up merge/rename pass once both this PR
  and the NASA POWER client PR exist, per the note in
  `src/data-sources/types.ts`.
- This ADR keeps its assigned number (`0040`). `docs/decisions/README.md`
  has been updated (in this same change) to explicitly permit reserved
  number blocks for parallel workstreams (0010s, 0020s, 0030s, 0040s, ...),
  so this number is no longer a gap against an unstated rule.
