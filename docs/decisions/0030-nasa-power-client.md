# 0030. NASA POWER client: climatology endpoint, monthly granularity, error classification

Status: accepted

## Context

Issue #6 asked for a `data-sources/` client fetching NASA POWER "hourly/
monthly climate normals (TMY-style)" for a lat/lon, using POWER's
all-sky GHI field directly (not re-derived from cloud %) plus ambient
temperature, normalized into a shared shape described in
`docs/superpowers/specs/2026-09-12-solarly-m1-design.md`.

**Update (see ADR 0035):** this client originally normalized its
output into the same `HourlyClimate` shape (`{ timestamp, temperatureC,
ghiWm2 }`) as the sibling Open-Meteo client, on the theory that both
clients should produce one shared type. That turned out to be wrong -
`HourlyClimate.ghiWm2` is an hourly-resolution instantaneous(-ish)
reading (Open-Meteo), while this client only ever has a 20-year
monthly-normal daily total to offer, roughly 4-8x smaller in magnitude
for physically similar conditions. `docs/decisions/0035-climate-data-type-split.md`
splits the shared type in two; this client now returns
`MonthlyClimateNormal[]` (`{ month, temperatureC, dailyInsolationKWhM2 }`),
keeping POWER's native `kWh/m^2/day` unit rather than converting to an
average W/m^2. The rest of this ADR is otherwise unchanged and still
describes the endpoint choice, monthly granularity, and error
classification correctly.

NASA POWER (https://power.larc.nasa.gov) exposes several `temporal/*`
point APIs. The two candidates for "climate normals" are:

- **`temporal/climatology/point`** — true multi-year (20-year,
  2001-2020) climatological monthly & annual averages. This is what
  POWER itself calls "Climatologies". Response gives one value per
  calendar month (`JAN`..`DEC`) plus an annual average (`ANN`), per
  parameter.
- **`temporal/hourly/point`** — actual hourly reanalysis/satellite data
  for an explicit `start`/`end` date range. This gives real hourly
  values, but for _specific dates_, not a multi-year normal; building a
  true 8760-hour TMY profile from it would mean fetching and averaging
  many years of hourly data client-side, which is a much heavier and
  slower operation than this "thin client" module is meant to be.

Verified both live against the real API during implementation (e.g.
`GET .../climatology/point?parameters=ALLSKY_SFC_SW_DWN,T2M&community=RE&longitude=-105.27&latitude=40.02&format=JSON`)
to confirm response shapes before writing fixtures from them.

## Decision

- **Use `temporal/climatology/point`**, requesting
  `ALLSKY_SFC_SW_DWN` (all-sky surface shortwave downward irradiance —
  used as-is, not re-derived from cloud cover) and `T2M` (2m air
  temperature), `community=RE`, `format=JSON`. This is the endpoint
  POWER itself designates for climate normals, and matches the spec's
  "TMY (typical meteorological year) climate normals" framing more
  directly than hand-averaging hourly data would.
- **Output is monthly granularity**, not synthesized hourly: one
  `MonthlyClimateNormal` entry per calendar month (12 entries), keyed
  by `month` (1-12) rather than a timestamp — there's no real date to
  anchor these to, since these are multi-year normals, not readings
  from an actual date (see ADR 0035 for why this is a distinct type
  rather than reusing `HourlyClimate`'s timestamp-keyed shape).
  Producing a true synthetic 8760-hour TMY profile (e.g. applying a
  diurnal shape driven by `solar-physics`'s sun-position calculation on
  top of these monthly normals) is left to the `simulation` layer,
  which already owns combining `data-sources` output with
  `solar-physics`.
- **Unit**: POWER reports GHI from this endpoint as a daily total,
  `kW-hr/m^2/day`. This is kept as-is in `dailyInsolationKWhM2` rather
  than converted to an average W/m^2 (see ADR 0035) — no conversion
  happens in this client at all.
- **Error classification** — two distinct error types, since a later
  issue needs to tell these apart in the UI (spec: "Location with no
  usable NASA POWER coverage ... explicit 'no climate data available'
  message" vs. "Climate API failure or rate limit: error banner ... with
  a retry button"):
  - `NasaPowerRequestError` — network failure (fetch rejects),
    non-2xx HTTP response, or a response whose JSON doesn't have the
    expected `properties.parameter.{ALLSKY_SFC_SW_DWN,T2M}` shape.
    Callers should treat this as retryable/transient.
  - `NasaPowerNoDataError` — the request succeeded (HTTP 200, expected
    shape) but every calendar month ends up with zero usable data.
    Per-month, a month is dropped from the result if _either_
    `ALLSKY_SFC_SW_DWN` or `T2M` equals POWER's documented `fill_value`
    sentinel (`-999`, read from the response's own `header.fill_value`
    rather than hard-coded, falling back to `-999` if absent) for that
    month — a month needs both a real GHI and a real temperature to be
    usable. `NasaPowerNoDataError` is thrown whenever that dropping
    leaves the result empty (all 12 months dropped), regardless of
    _why_ each month was dropped.
    - Earlier drafts of this client instead checked for "both
      parameters are fill for every month" as the trigger, independent
      of the per-month drop logic. That was a bug: `ALLSKY_SFC_SW_DWN`
      and `T2M` are backed by different underlying datasets
      (`header.sources` is `["SYN1DEG", "MERRA2"]`) and can have
      independently different coverage, so one parameter can be
      all-fill while the other is entirely real — that case fell
      through the old "both" guard, and the per-month loop then
      dropped every month anyway, resolving with an empty array
      instead of throwing. Tying the no-data trigger directly to "the
      result ended up empty" (rather than re-deriving a separate
      condition on the raw per-parameter fill arrays) makes this
      robust to any distribution of fill across the two parameters,
      without depending on the assumption below about how likely
      partial-vs-total fill is.
  - A location with only _some_ months missing (partial fill in either
    or both parameters) is not a hard failure: those individual months
    are dropped from the result rather than fabricated, and the caller
    gets a shorter (but non-empty) array. In practice POWER's
    climatology coverage is effectively global for these two
    reanalysis-backed parameters (verified against open-ocean and
    polar test points, which returned real — if extreme — values
    rather than fill), so an all-fill (fully empty) result is expected
    to be the more common shape of "no coverage here" than a partial
    one — but the code no longer relies on that assumption for
    correctness, only as color for why full fill is the case worth
    naming. The no-data fixture used in tests is therefore synthetic
    (hand-constructed all-`-999` JSON) rather than a captured live
    response, since a live all-missing response could not be found
    during implementation — POWER's real coverage for
    `ALLSKY_SFC_SW_DWN`/`T2M` turned out to be broader than expected.
    Two more synthetic fixtures cover the single-parameter-all-fill
    case specifically (see `src/data-sources/README.md`).

## Consequences

- The `simulation` layer receives 12 `MonthlyClimateNormal` points per
  location, not an hourly TMY profile. It's responsible for turning
  that into the hour-by-hour generation curve the UI needs (per the
  spec's `solar-physics` sun-position + irradiance model already doing
  the hourly work) — this client does not attempt to fake hourly
  resolution. See ADR 0035 for how that disaggregation is expected to
  work.
- If a future need arises for genuine multi-year-averaged _hourly_
  normals (rather than monthly), that's a different, heavier client
  (or a server-side/cached approach) and should get its own ADR rather
  than extending this one.
- The no-data classification (`NasaPowerNoDataError`) is exercised in
  tests via a synthetic fixture rather than a real captured API
  response, since POWER's actual coverage for these two parameters
  could not be made to produce an all-fill response during testing
  (tried open ocean and near-pole points; both returned real values).
  If POWER's behavior differs from this assumption for some real
  location, the fallback is that such a location surfaces as a
  `NasaPowerRequestError` (missing/malformed shape) instead of
  `NasaPowerNoDataError` — still a distinct, handleable error, just not
  the more specific one.
