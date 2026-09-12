# simulation

Orchestration layer — the only module allowed to depend on both
`solar-physics` and `data-sources`. `runTmySimulation({ location,
systemConfig })` fetches NASA POWER's monthly climate normals, disaggregates
each month into a representative day's hourly curve via a clearness-index
model, and runs the result through the full `solar-physics` pipeline to
produce a typed `SimulationResult` (representative-day hourly curves per
month, monthly totals, and an annual total) for the chart UI to consume.

See `docs/decisions/0080-tmy-disaggregation-approach.md` for the
disaggregation method and known limitations, and
`docs/superpowers/specs/2026-09-12-solarly-m1-design.md` for the module's
place in the overall data flow.
