# Solarly

Solarly is a shareable, public web tool for estimating photovoltaic (PV)
panel electricity generation. A user picks a location and describes a
panel system (tilt, azimuth, capacity, panel model), and the tool shows
predicted generation over time — both long-term climate-normal estimates
(for an investment decision) and a short-term weather forecast.

## Status

**M1 in progress** — core solar-physics generation engine and chart UI.
This repo currently contains the project scaffold (build/test/lint
tooling, module folder structure, deploy config) from issue #1; the
generation engine, data sources, and chart UI land in follow-up issues.
See the design spec linked below for the full M1 scope and the roadmap
beyond it.

The app is **not yet deployed live**. A Cloudflare Pages deploy config
exists (`wrangler.toml`, `.github/workflows/deploy.yml`) but has not been
used to trigger an actual deploy — see
[`docs/decisions/0001-project-scaffolding.md`](docs/decisions/0001-project-scaffolding.md)
for details and what's needed to complete it.

## Local development

Requires Node.js 20+.

```bash
npm install       # install dependencies
npm run dev       # start the Vite dev server with HMR
npm run build     # type-check and produce a static production bundle in dist/
npm run preview   # locally preview the production build
npm test          # run the Vitest test suite once
npm run test:watch  # run tests in watch mode
npm run lint      # run ESLint
npm run format    # format the codebase with Prettier
npm run format:check  # check formatting without writing changes
```

## Project structure

The `src/` directory follows the module boundaries described in the
design spec:

- `src/solar-physics/` — pure sun-position, irradiance, and power-output
  calculations.
- `src/data-sources/` — API clients for NASA POWER, Open-Meteo, and
  Nominatim.
- `src/panel-presets/` — curated panel model presets.
- `src/simulation/` — orchestration layer wiring `solar-physics` and
  `data-sources` together.
- `src/ui/` — React components.

Each folder has its own `README.md` with more detail.

## Docs

- [M1 design spec](docs/superpowers/specs/2026-09-12-solarly-m1-design.md)
  — architecture, module boundaries, data flow, UI/UX, and error handling
  for the current milestone.
- [Architecture decision records](docs/decisions/) — lightweight ADRs
  documenting notable technical decisions and their rationale.

## Contributing

All work happens on feature branches with pull requests against `main`.
Never push directly to `main`.
