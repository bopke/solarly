# simulation

Orchestration layer — the only module allowed to depend on both
`solar-physics` and `data-sources`. Takes `{location, systemConfig, mode}`
and returns a typed time-series result (`SimulationResult`) for the UI to
render. See `docs/superpowers/specs/2026-09-12-solarly-m1-design.md`.

## `runLiveSimulation` (Live forecast mode, issue #10)

`runLiveSimulation({ location, systemConfig }) -> Promise<SimulationResult>`
fetches an Open-Meteo hourly forecast (`data-sources`) and runs each hour's
GHI + temperature through the `solar-physics` pipeline
(`sunPosition -> decomposeGhi -> poaIrradiance -> panelPowerOutput`) to
produce an hourly power series for the Forecast chart tab (issue #17). See
`docs/decisions/0016-live-forecast-orchestration.md` for the notable
decisions: the sun-position/GHI-averaging-window midpoint adjustment, the
`systemLossesPercent` / `manualShadingPercent` loss-stacking formula, and
the `SimulationResult` shape (shared with TMY mode, issue #9).
