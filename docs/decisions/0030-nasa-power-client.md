# 0030. NASA POWER client: climatology endpoint, monthly granularity, error classification

Status: accepted

## Context

Issue #6 asked for a `data-sources/` client fetching NASA POWER "hourly/
monthly climate normals (TMY-style)" for a lat/lon, using POWER's
all-sky GHI field directly (not re-derived from cloud %) plus ambient
temperature, normalized into the shared `HourlyClimate` shape
(`{ timestamp, temperatureC, ghiWm2 }`) described in
`docs/superpowers/specs/2026-09-12-solarly-m1-design.md`.

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
  `HourlyClimate` entry per calendar month (12 entries), using a fixed
  arbitrary reference year (2001, the start of POWER's climatology
  window) and the 15th of the month at 12:00 UTC as each entry's
  timestamp, purely so entries have a well-formed, sortable ISO
  timestamp — the year/day/time have no independent meaning since these
  are multi-year normals, not readings from an actual date. Producing a
  true synthetic 8760-hour TMY profile (e.g. applying a diurnal shape
  driven by `solar-physics`'s sun-position calculation on top of these
  monthly normals) is left to the `simulation` layer, which already
  owns combining `data-sources` output with `solar-physics`.
- **Unit conversion**: POWER reports GHI from this endpoint as a daily
  total, `kW-hr/m^2/day`. Converted to the shared shape's `ghiWm2`
  (average W/m^2) via `(kWhPerDay * 1000) / 24`. This is an average
  over the full day, not a peak or a diurnal curve — consistent with
  the monthly-normal granularity above.
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
    shape) but every month's value for both parameters equals POWER's
    documented `fill_value` sentinel (`-999`, read from the response's
    own `header.fill_value` rather than hard-coded, falling back to
    `-999` if absent). This is POWER's way of saying "no data here",
    distinct from a broken request.
  - A location with only _some_ months missing (partial fill) is
    treated as neither: those individual months are dropped from the
    result rather than fabricated or treated as a hard failure, since
    in practice POWER's climatology coverage is effectively global for
    these two reanalysis-backed parameters (verified against open-ocean
    and polar test points, which returned real — if extreme — values
    rather than fill). An all-fill response is more likely a
    location genuinely outside the dataset (e.g. coordinates in a
    body of water POWER excludes, or right at a boundary) than a
    partial one is, so it's the one case this client treats as
    `NasaPowerNoDataError`. The no-data fixture used in tests is
    therefore synthetic (hand-constructed all-`-999` JSON) rather than
    a captured live response, since a live all-missing response could
    not be found during implementation — POWER's real coverage for
    `ALLSKY_SFC_SW_DWN`/`T2M` turned out to be broader than expected.

## Consequences

- The `simulation` layer receives 12 monthly climate points per
  location, not an hourly TMY profile. It's responsible for turning
  that into the hour-by-hour generation curve the UI needs (per the
  spec's `solar-physics` sun-position + irradiance model already doing
  the hourly work) — this client does not attempt to fake hourly
  resolution.
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
