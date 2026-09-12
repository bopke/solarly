# simulation

Orchestration layer — the only module allowed to depend on both
`solar-physics` and `data-sources`. Takes `{location, systemConfig, mode}`
and returns a typed time-series result (`SimulationResult`, a discriminated
union of `TmySimulationResult` and `LiveSimulationResult`) for the UI to
render. See `docs/superpowers/specs/2026-09-12-solarly-m1-design.md`.

## `runLiveSimulation` (Live forecast mode, issue #10)

`runLiveSimulation({ location, systemConfig }) -> Promise<LiveSimulationResult>`
fetches an Open-Meteo hourly forecast (`data-sources`) and runs each hour's
GHI + temperature through the `solar-physics` pipeline
(`sunPosition -> decomposeGhi -> poaIrradiance -> panelPowerOutput`) to
produce an hourly power series for the Forecast chart tab (issue #17). See
`docs/decisions/0016-live-forecast-orchestration.md` for the notable
decisions: the sun-position/GHI-averaging-window midpoint adjustment, the
`systemLossesPercent` / `manualShadingPercent` loss-stacking formula, and
the `SimulationResult` shape (shared with TMY mode, issue #9).

## `runTmySimulation` (TMY climate-normal mode, issue #9)

`runTmySimulation({ location, systemConfig }) -> Promise<TmySimulationResult>`
fetches NASA POWER's monthly climate normals, disaggregates each month into
a representative day's hourly curve via a clearness-index model, and runs
the result through the full `solar-physics` pipeline to produce a typed
`TmySimulationResult` (representative-day hourly curves per month, monthly
totals, and an annual total) for the Daily (#14), Monthly (#15), and
Heatmap (#16) chart tabs to consume.

See `docs/decisions/0080-tmy-disaggregation-approach.md` for the
disaggregation method and known limitations, and
`docs/superpowers/specs/2026-09-12-solarly-m1-design.md` for the module's
place in the overall data flow.
