# simulation

Orchestration layer — the only module allowed to depend on both
`solar-physics` and `data-sources`. Takes `{location, systemConfig, mode}`
and returns a typed time-series result for the UI to render. See
`docs/superpowers/specs/2026-09-12-solarly-m1-design.md`.
