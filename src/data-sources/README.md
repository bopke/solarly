# data-sources

Thin API clients (NASA POWER, Open-Meteo, Nominatim) that normalize
responses into shared internal climate shapes. See
`docs/superpowers/specs/2026-09-12-solarly-m1-design.md`.

Two distinct shapes live in `types.ts`, kept in its own file separate
from any one client so clients built in parallel don't collide on the
same file:

- `HourlyClimate` - hourly-resolution instantaneous(-ish) readings
  (used by the Open-Meteo client).
- `MonthlyClimateNormal` - 20-year climatological monthly normals, one
  entry per calendar month, using GHI's native `kWh/m^2/day` unit
  (used by the NASA POWER client below).

These are **not** interchangeable - see
`docs/decisions/0035-climate-data-type-split.md` for why they were
split into two types instead of sharing one, and for how `simulation/`
is expected to turn `MonthlyClimateNormal[]` into an hourly series.

## nasa-power/

`fetchNasaPowerClimateNormals({ latitude, longitude })` fetches NASA
POWER's 20-year monthly climatology (all-sky GHI + 2m air temperature)
for a location and normalizes it into `MonthlyClimateNormal[]` (one
entry per calendar month). See `docs/decisions/0030-nasa-power-client.md`
for why the climatology endpoint was chosen and how errors are
classified.

Note: several fixtures are hand-built/synthetic rather than captured
live responses, since the scenarios they cover either can't be
produced against the real API on demand, or are unlikely enough that
waiting to find one live isn't practical. Don't try to re-capture
these against the live API:

- `climatology-no-data.json` - all fields set to POWER's `-999` fill
  sentinel for both parameters, every month. Its `(-140, -85)`
  coordinates demonstrably return real (non-fill) data live and its
  `elevation` doesn't match what that real response reports, so it's
  internally synthetic.
- `climatology-ghi-missing.json` / `climatology-temperature-missing.json` -
  one parameter is all-`-999` while the other has real values for
  every month, modeling the real scenario where `ALLSKY_SFC_SW_DWN`
  (SYN1DEG-backed) and `T2M` (MERRA2-backed) have independently
  different coverage. Covers the "zero usable months" no-data trigger
  when only one parameter is missing (see
  `docs/decisions/0030-nasa-power-client.md`).
- `climatology-polar-zero-ghi.json` - GHI is a real `0.0` (not fill)
  for several months, modeling polar winter. Illustrative values loosely
  based on a real `(-140, -85)` API response rather than a byte-for-byte
  capture; used to lock in that a real `0.0` is preserved rather than
  mistaken for the fill sentinel.
## Open-Meteo (live forecast)

`open-meteo.ts` fetches an hourly cloud-cover + temperature forecast from
the Open-Meteo forecast API and normalizes it into `HourlyClimate[]`.
Open-Meteo doesn't publish irradiance for this use case, so GHI is
estimated by attenuating a clear-sky GHI estimate (`clear-sky.ts`, Haurwitz
model driven by solar elevation) against the forecast cloud cover, using
the Kasten & Czeplak (1980) empirical cloud-cover attenuation curve. See
`docs/decisions/0040-open-meteo-client.md` for the full rationale.

`types.ts` defines the shared `HourlyClimate` shape. A sibling PR for the
NASA POWER client may also define this type independently — reconcile into
one definition if both land.
