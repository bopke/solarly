# data-sources

Thin API clients (NASA POWER, Open-Meteo, Nominatim) that normalize
responses into a shared internal `HourlyClimate` shape. See
`docs/superpowers/specs/2026-09-12-solarly-m1-design.md`.

The shared `HourlyClimate` type lives in its own file, `types.ts`, kept
separate from any one client so clients built in parallel don't collide
on the same file.

## nasa-power/

`fetchNasaPowerClimateNormals({ latitude, longitude })` fetches NASA
POWER's 20-year monthly climatology (all-sky GHI + 2m air temperature)
for a location and normalizes it into `HourlyClimate[]` (one entry per
calendar month). See `docs/decisions/0030-nasa-power-client.md` for why
the climatology endpoint was chosen and how errors are classified.
