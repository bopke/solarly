# 0040. Open-Meteo client: endpoint, cloud-cover attenuation, and clear-sky estimate

Status: accepted

## Context

Issue #7 asks for a `data-sources/` client that fetches an hourly
cloud-cover and temperature forecast from Open-Meteo for a given lat/lon,
and normalizes it into the shared `HourlyClimate` shape (`{ timestamp,
temperatureC, ghiWm2 }`) described in
`docs/superpowers/specs/2026-09-12-solarly-m1-design.md`. Open-Meteo's free
forecast API does not publish irradiance for this use case, so `ghiWm2`
must be _estimated_ from cloud cover rather than read directly (unlike the
NASA POWER client, which uses POWER's own all-sky GHI as-is). This required
several decisions that aren't fully specified by the issue or the design
doc.

## Decision

- **Endpoint and parameters**: `GET https://api.open-meteo.com/v1/forecast`
  with `hourly=temperature_2m,cloud_cover`, `timezone=UTC`, and
  `forecast_days` defaulting to 7 (clamped to Open-Meteo's documented
  `[1, 16]` range). `timezone=UTC` is used so the "naive" hourly timestamps
  Open-Meteo returns (no UTC offset) can be treated as UTC unambiguously —
  the client appends `:00Z` to produce ISO 8601 UTC timestamps for
  `HourlyClimate.timestamp`. 7 days matches the top of the "3-7 days"
  forecast horizon called out in the design doc and issue; `forecastDays`
  is exposed as an option for callers that want fewer.

- **Cloud-cover attenuation formula**: Kasten & Czeplak (1980), "Solar and
  terrestrial radiation dependent on the amount and type of cloud", _Solar
  Energy_, 24(2), 177-189:

  ```
  GHI = GHI_clear * (1 - 0.75 * (N/8)^3.4)
  ```

  where `N` is cloud cover in oktas (0-8). This is a widely cited, simple
  empirical curve for attenuating clear-sky irradiance by cloud cover (it
  underlies cloud-cover-to-irradiance transforms in several open PV
  toolkits). Open-Meteo reports cloud cover as a percentage (0-100), which
  maps directly onto the `N/8` fraction (0-1) the formula uses, so no unit
  conversion table is needed beyond dividing by 100. Implemented as
  `attenuateForCloudCover` in `src/data-sources/open-meteo.ts`.

- **Clear-sky GHI estimate**: the attenuation formula needs a clear-sky GHI
  to attenuate. The M1 design doc assigns clear-sky irradiance modeling to
  `solar-physics/` (a simplified Ineichen/Haurwitz-style model with a fixed
  Linke turbidity constant), and restricts "depends on both `solar-physics`
  and `data-sources`" to `simulation/` only. `solar-physics/` is not
  implemented yet on this branch (its own issue is still open, and
  `src/solar-physics/index.ts` is an empty stub), so this client cannot
  import a shared implementation without violating that boundary or adding
  a same-PR dependency that could conflict with the parallel
  `solar-physics` work.

  Instead, `src/data-sources/clear-sky.ts` implements a small,
  self-contained clear-sky estimate used _only_ for this attenuation step:
  a reduced NOAA-style solar-elevation calculation (declination +
  equation-of-time approximation, ~±0.3° accuracy — deliberately less
  precise than the ~0.01° algorithm planned for `solar-physics/`, which is
  overkill for an attenuation envelope), feeding the Haurwitz (1945)
  clear-sky model:

  ```
  GHI_clear = 1098 * cos(z) * exp(-0.059 / cos(z))   for cos(z) > 0
  ```

  (Haurwitz, B. (1945), "Insolation in Relation to Cloudiness and Cloud
  Density", _Journal of Meteorology_, 2(3), 154-166.) Haurwitz needs only
  solar zenith angle as input (no turbidity), which keeps this helper
  self-contained and appropriately lightweight for an attenuation baseline
  rather than a load-bearing irradiance model.

  **Known duplication / follow-up**: this duplicates a slice of physics
  that will eventually live in `solar-physics/`. Once that module lands,
  reconcile by either (a) having `open-meteo.ts` import
  `solar-physics`'s sun-position/clear-sky functions and deleting
  `clear-sky.ts`, or (b) moving the cloud-cover attenuation step into
  `simulation/` (which is allowed to depend on both modules) and having
  `data-sources` return raw cloud cover instead of a derived GHI. Left as a
  follow-up rather than blocking this issue on `solar-physics`'s issue.

- **Shared `HourlyClimate` type**: defined in `src/data-sources/types.ts`
  on this branch since it didn't already exist. A sibling PR for the NASA
  POWER client is being built in parallel and may define this type
  independently — whichever PR merges second should reconcile onto a
  single definition rather than keeping two copies in sync.

## Consequences

- The Open-Meteo client works standalone today without waiting on
  `solar-physics/`, but at the cost of a second, lower-precision
  solar-position implementation living temporarily in `data-sources/`.
  This is flagged above as a follow-up, not a permanent design.
- GHI estimates from this client are necessarily approximate (empirical
  cloud-cover curve + approximate clear-sky + approximate solar position,
  compounding three sources of error) and should be presented as a
  forecast estimate, not a precise measurement — consistent with the
  design doc's general framing of Live/forecast mode versus TMY mode.
- `HourlyClimate` may need a follow-up merge/rename pass once both this PR
  and the NASA POWER client PR exist, per the note in
  `src/data-sources/types.ts`.
