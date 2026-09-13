# Solarly — M2 Design: 3D Plot Scene Editor

## Purpose

M1 shipped the core generation engine and chart UI with manual, single-array system configuration (one tilt, one azimuth, one panel count, entered by hand). M2 adds a 3D scene editor: the user traces the real outline of their roof face(s) or ground-mount plot over satellite imagery, places panels and obstructions in a 3D view, and that scene becomes the source of truth for the simulation — replacing the manual single-array assumption with real, possibly multi-array, geometry. This is the original "visual representation of a plot of land" vision from the project's initial brainstorm, and the milestone the project owner has chosen to prioritize over the newer practical feature ideas (financial/ROI, multi-array accuracy, save/export, battery modeling) that came up in a later session.

M2 is **camera/scene placement and multi-array wiring only** — it does not calculate real shadows from placed obstructions. That's M3, which reuses this milestone's scene geometry.

## Roadmap context (not part of this spec)

- **M1** (shipped): core solar-physics engine, data sources, simulation orchestration, chart UI, manual single-array config.
- **M2** (this doc): 3D scene editor — trace roof/ground shapes over satellite imagery, configure tilt/azimuth per shape, place panels (auto-filled) and obstructions (trees/buildings) in a 3D view, apply the resulting multi-array configuration to the simulation.
- **M3** (future spec): real geometric shadow-casting — raycast sun position (already available via `solar-physics/sunPosition`) against M2's scene geometry per hour, replacing each array's manual shading-percent input with a computed one.
- **M4** (future spec): financial/ROI — system cost, local electricity price, payback period, degradation-adjusted lifetime generation projection. Deliberately sequenced after M3 rather than right after M1, since ROI numbers are only as trustworthy as the generation estimate underneath them.
- **M5** (backlog, unsequenced): P50/P90 year-to-year variability bands, save/export a scenario, battery storage modeling, and smaller items (browser geolocation, unit toggle, inverter DC/AC clipping).

## Architecture

### New dependencies

- **`@react-three/fiber` + `@react-three/drei`** — the 3D scene: panel/obstruction rendering, orbit camera, gizmos. Chosen as the de facto standard for React 3D work, with the largest ecosystem and the most natural fit for a component already built on React state.
- **`@mapbox/mapbox-gl-draw`** — polygon tracing on the map. API-compatible with MapLibre GL (the project's existing map library), and handles vertex editing, undo, and multi-polygon drawing without reimplementing that from scratch.
- **Mapbox Satellite tiles** as a raster source, layered under the existing MapLibre vector style during the tracing step. Requires a Mapbox account and API key — the first API key this project has needed; every prior integration (OpenFreeMap, Nominatim, NASA POWER, Open-Meteo) has been free and keyless. The project owner has explicitly accepted this tradeoff because the tracing step genuinely needs real imagery to be useful.

### New module: `src/scene/`

Mirrors the project's existing module-boundary convention (pure logic separated from UI, UI depending only on typed outputs):

- **`tracing/`** — the 2D trace-over-satellite-imagery UI (MapLibre + Mapbox Satellite raster source + mapbox-gl-draw). Outputs a list of traced shapes: `{ id: string, kind: 'roof-face' | 'ground-array', polygon: LngLat[] }`.
- **`derive/`** — pure functions, unit-testable in isolation like `solar-physics/`:
  - Polygon → 3D extrusion geometry.
  - Azimuth auto-suggestion from a traced polygon's longest edge.
  - Panel auto-fill: given a shape's area, a chosen panel preset's real `widthMm`/`heightMm` (from the existing `panel-presets/` module), and adjustable row/column spacing, produce a grid of panel positions, with a simple "exclude this cell" interaction for obstacles like a chimney or vent pipe.
- **`scene/`** — the React Three Fiber 3D view. Takes traced shapes (each with its derived/edited tilt and azimuth) plus placed obstructions, renders tilted planes with the auto-filled panel grid, an orbit camera, and a north-arrow gizmo for orientation. Obstructions (trees, nearby buildings) are placed by clicking empty ground, with a simple property panel for height/position — geometry only, no shadow math (that's M3).

### Data flow and the multi-array model

Since the existing single-array `SystemConfigForm` stays available as a simpler alternative (see UI/UX below), the simulation engine needs one unified shape rather than two parallel code paths:

- **`SystemConfig` generalizes** from a single flat tilt/azimuth/count object to `{ arrays: PanelArrayConfig[], systemLossesPercent }`, where `PanelArrayConfig` holds what's currently on `SystemConfig` per array (`tiltDeg`, `azimuthDeg`, `panelCount`, `wattsPerPanel`, `efficiencyPercent`, `tempCoefficientPercentPerC`, `manualShadingPercent`). `systemLossesPercent` (inverter/wiring losses) stays system-wide, since it isn't meaningfully a per-array property.
- **`SystemConfigForm`** (existing, unchanged UI) now produces a single-element `arrays` array under the hood — a mechanical adapter change, not a redesign.
- **The new scene editor** produces the same shape with one entry per traced shape.
- **`runTmySimulation`/`runLiveSimulation`** change from computing POA irradiance and power once per hour to looping over `arrays`, running the existing pure `poaIrradiance`/`panelPowerOutput` functions once per array per hour (each with its own tilt/azimuth/shading), and summing the resulting watts before continuing into the existing daily/monthly/annual (or live hourly) aggregation. This is a mechanical extension of the existing pipeline — those physics functions are already pure and per-hour — not a redesign of it. A single-array config sums over an array of length one, so no existing simulation output changes.

## UI/UX

**Entry point:** a new "Design in 3D" action next to the existing `SystemConfigForm` in the sidebar, enabled once a location is set (consistent with the rest of the app). Opens a full-screen overlay for the flow below — tracing and the 3D scene both need far more space than the sidebar affords.

**The existing manual single-array form stays available** as a simpler alternative for a quick rough estimate; the 3D scene is an opt-in richer path, not a replacement. Once a scene is applied, the sidebar shows a compact summary ("3 arrays, 42 panels total") instead of the flat single-array fields, with an "Edit scene" link back into the same overlay that preserves prior traced shapes and placements rather than restarting.

**The flow, four steps:**
1. **Trace** — Mapbox satellite imagery, centered on the already-picked location (reusing the resolved location from the existing location picker). The user draws one or more polygons with `mapbox-gl-draw`, tagging each as a roof face or a ground array as they go.
2. **Configure each traced shape** — roof faces get a manually-entered tilt (satellite imagery is top-down and can't show slope; a few common-pitch presets are offered alongside free entry) and an auto-suggested azimuth from the traced polygon's longest edge, editable. Ground arrays get a single tilt/azimuth for the whole traced plot (typical of fixed-tilt racking), defaulted from the location's latitude and an equator-facing azimuth, both editable — terrain within a ground-array plot is assumed flat, with no elevation data.
3. **3D scene** — an orbit-camera view of the extruded/tilted plane(s) for each configured shape, each auto-filled with a panel grid using the chosen preset's real dimensions from `panel-presets/`. The user can click empty ground to place a tree or building obstruction and adjust its height via a small property panel.
4. **Apply** — derives the multi-array `SystemConfig` described above and feeds it into the existing simulation.

## Error handling

- **Mapbox Satellite request failure** (missing/invalid API key, rate limit, network error): the tracing step falls back to the existing plain MapLibre vector style (less useful for eyeballing a roof, but the drawing tool itself still works), with a clear inline notice rather than blocking the whole flow.
- **Invalid traced polygon** (self-intersecting, near-zero area): inline validation blocks proceeding to the next step with a clear message, consistent with the project's existing non-clamping validation style (e.g. `SystemConfigForm`'s validation).

## Testing

React Three Fiber/WebGL is difficult to meaningfully exercise under jsdom, mirroring the project's existing experience with MapLibre in `LocationPicker.test.tsx` (mocked in tests, manual browser verification does the real check). The same pattern applies here:
- **`derive/`**'s pure functions (polygon → geometry, azimuth suggestion, panel auto-fill grid) get real unit tests, same rigor as `solar-physics/`.
- **`simulation/`**'s multi-array summing gets integration tests with fixture multi-array configs, alongside the existing single-array tests (which must continue passing unchanged).
- **The R3F scene component itself** gets light rendering tests (mocked Canvas) plus mandatory manual browser verification before any PR touching it is considered done — consistent with this project's standing convention for UI changes.
