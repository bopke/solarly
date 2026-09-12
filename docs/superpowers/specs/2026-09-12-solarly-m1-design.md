# Solarly — M1 Design: Generation Engine & Charts

## Purpose

Solarly is a shareable, public web tool for estimating photovoltaic (PV) panel electricity generation. A user picks a location and describes a panel system (tilt, azimuth, capacity, panel model), and the tool shows predicted generation over time — both long-term climate-normal estimates (for an investment decision) and a short-term weather forecast.

This document scopes **M1**: the generation-estimation engine and its chart UI, with **manual numeric inputs** for tilt, azimuth, and shading. It deliberately excludes the 3D plot-of-land scene.

## Roadmap context (not part of this spec)

- **M1** (this doc): core solar-physics engine + chart UI, manual system inputs, no 3D.
- **M2** (future spec): 3D scene editor — place a plot of land, panel arrays, and obstructions (trees, buildings) in 3D; camera/scene interaction only, generation numbers still come from M1's manual inputs.
- **M3** (future spec): wire M2's scene geometry into the M1 engine — replace the manual shading input with real geometric shadow-casting (raycasting sun position against scene geometry, per hour/day).

Financial/ROI calculations (system cost, electricity price, payback period) are explicitly out of scope for M1 and any milestone in this document; they will be a separate future milestone once generation numbers are trustworthy.

## Architecture

Vite + React + TypeScript single-page app. Static build, deployed to Cloudflare Pages. No backend — all computation and third-party API calls happen client-side, directly from the browser.

### Modules

- **`solar-physics/`** — pure functions, no React/API/UI knowledge:
  - Sun position (altitude, azimuth) for a given lat/lon/timestamp, using NOAA's simplified solar position algorithm (~0.01° accuracy).
  - Clear-sky irradiance (direct + diffuse, horizontal) from sun altitude, using a simplified Ineichen/Haurwitz-style model with a fixed Linke turbidity climatology constant (real-time turbidity is a documented known limitation, not modeled in M1).
  - Plane-of-array (POA) irradiance transposition from horizontal to the panel's tilt/azimuth plane, using a standard isotropic sky-diffuse model.
  - Power output: POA irradiance × panel rated efficiency × (1 − system losses %) × a temperature-derating term (panel temperature coefficient × ambient temperature).
  - Fully unit-testable in isolation, independent of network or UI.

- **`data-sources/`** — thin API clients, each normalizing responses into a shared internal `HourlyClimate` shape (timestamp, temperature, GHI/cloud cover):
  - NASA POWER — TMY (typical meteorological year) climate normals, including all-sky GHI directly (used as-is rather than re-derived from cloud %, since POWER already models it).
  - Open-Meteo — live cloud-cover forecast, attenuated against clear-sky irradiance via a standard empirical curve to estimate forecast GHI (Open-Meteo doesn't publish irradiance directly).
  - Nominatim — address/place geocoding.
  - All three are free, keyless, CORS-enabled APIs suitable for a pure client-side app.

- **`panel-presets/`** — static curated JSON dataset: ~10-15 well-known real panel models (make/model, rated Wp, efficiency %, temperature coefficient) plus 2-3 generic residential/commercial defaults. Used to prefill the system-config form; all fields remain editable after a preset is chosen.

- **`simulation/`** — orchestration layer, the only module allowed to depend on both `solar-physics` and `data-sources`. Takes `{location, systemConfig, mode}` (mode = TMY or Live) → fetches/derives climate data for the relevant time range → runs the physics pipeline → returns a typed time-series result for the UI to render.

- **`ui/`** — React components. Depends on `simulation`'s output types only, never reaches into `solar-physics` or `data-sources` internals directly:
  - Location picker: address/place search box (Nominatim) + MapLibre GL map with a draggable pin; shows resolved lat/lon/timezone.
  - System config form: panel preset dropdown + editable fields (tilt °, azimuth, capacity/panel count, efficiency %, temp coefficient, system losses %, manual shading factor).
  - Mode toggle: TMY vs Live forecast.
  - Chart tabs: Daily, Monthly, Heatmap (TMY mode); Forecast (Live mode — the only tab shown/active when mode = Live).

### Data flow

User sets location + system config → `simulation` fetches/derives climate data for the active mode → runs the `solar-physics` pipeline over the relevant time range → returns a typed result → chart components render from it. Inputs are debounced but changes are applied via an explicit "Update" trigger rather than live-on-keystroke, since NASA POWER requests take ~1-2s and per-keystroke calls would be wasteful and rate-limit-prone.

## UI / UX

**Layout:** left sidebar (config, collapses to a top accordion on narrow viewports) + main chart area (as validated in the visual companion — layout "A").

Sidebar contents, top to bottom:
1. Location — search box + MapLibre map with draggable pin.
2. System config — preset dropdown, then tilt/azimuth/capacity/efficiency/temp-coefficient/losses/manual-shading fields, all editable regardless of preset.
3. Mode toggle — TMY vs Live.
4. Update button (explicit trigger, per the debounce note above).

Main area: tabs — Daily (with a date/day-of-year slider selecting the representative day shown), Monthly (bar chart of total kWh per month + annual total), Heatmap (hour-of-day × day-of-year, color = power output, styled per the project's dataviz color guidance), Forecast (hourly line chart for the next 3-7 days, as far as Open-Meteo's forecast horizon allows).

**Empty/loading states:** before a location is chosen, main area shows a prompt to search or click the map. While fetching, chart area shows a skeleton/spinner rather than blanking.

## Error handling

- Geocoding failure/no results: inline message under the search box; map remains clickable as a fallback.
- Climate API failure or rate limit: error banner in the chart area with a retry button; the last successful result (if any) remains visible rather than being cleared.
- Invalid form input (e.g. tilt > 90°, negative capacity): inline field validation, blocks the Update trigger rather than silently clamping values.
- Location with no usable NASA POWER coverage (e.g. open ocean): explicit "no climate data available for this location" message.

## Testing

- `solar-physics`: unit tests against known reference values — NOAA solar calculator sun-position outputs for fixed date/location/time; hand-checked clear-sky irradiance for a few reference cases. This module gets the most rigorous coverage since correctness of the whole tool depends on it.
- `data-sources`: unit tests on response normalization using recorded fixture responses (no live network calls in CI).
- `simulation`: integration tests wiring fixture climate data through the physics pipeline, asserting sane end-to-end output shape and magnitude.
- `ui`: component tests for form validation and chart rendering given fixed data; a manual pass in a real browser before M1 is considered done.

## Tech stack summary

- Build: Vite + React + TypeScript, static export to Cloudflare Pages.
- Charts: Recharts (daily curve, monthly bars, forecast line chart); custom SVG/canvas component for the heatmap.
- Map: MapLibre GL JS with free vector tiles (OpenFreeMap or MapTiler free tier) — also sets up shared skills/tooling for the future M2 3D scene.
- Geocoding: Nominatim (OpenStreetMap).
- Climate data: NASA POWER (TMY mode), Open-Meteo (Live/forecast mode).
- Solar physics: hand-written TypeScript module (no external PV-modeling dependency), per the model described above.
