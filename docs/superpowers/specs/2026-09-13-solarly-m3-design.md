# Solarly — M3 Design: Geometric Shadow-Casting

## Purpose

M2 shipped a 3D scene editor where a user traces real roof faces and ground plots, places panels and obstructions (trees, buildings), and applies the result as a multi-array `SystemConfig` — but every array's shading is still a single manually-entered `manualShadingPercent`, and the obstructions placed in the 3D view have no effect on the simulated output. M3 closes that gap: it replaces the manual shading input with real per-hour, per-panel occlusion computed by raycasting the sun's actual position against M2's scene geometry, and adds a sun-position scrubber to the 3D view so the user can see the shadows that produce that number.

## Roadmap context (not part of this spec)

- **M1** (shipped): core solar-physics engine, data sources, simulation orchestration, chart UI, manual single-array config.
- **M2** (shipped): 3D scene editor — trace roof/ground shapes over satellite imagery, configure tilt/azimuth per shape, place panels (auto-filled) and obstructions in a 3D view, apply the resulting multi-array configuration to the simulation. Shading was manual (`manualShadingPercent`, defaulted to 0).
- **M3** (this doc): real geometric shadow-casting — raycast sun position against M2's scene geometry per hour, per panel, replacing each array's manual shading input with a computed one when a 3D scene has been applied.
- **M4** (future spec): financial/ROI — system cost, local electricity price, payback period, degradation-adjusted lifetime generation projection. Sequenced after M3 since ROI numbers are only as trustworthy as the generation estimate underneath them.
- **M5** (backlog, unsequenced): P50/P90 year-to-year variability bands, save/export a scenario, battery storage modeling, and smaller items (browser geolocation, unit toggle, inverter DC/AC clipping).

## Scope decisions

These were settled during brainstorming and drive the architecture below:

- **Visual + computed, not one or the other.** The same raycasting mechanism that computes the real shading number also drives a sun-position scrubber in the 3D scene so the user can see why the number is what it is.
- **Shadow sources: both traced shapes and obstructions.** A roof face can shade another roof face (e.g. a two-story extension over a lower roof) just as much as a placed tree or building can. Row-to-row self-shading *within* a single array (panels shading their own neighbors at low sun angles) is explicitly **out of scope** for M3 — it's a design/spacing concern the user can already address via M2's panel spacing controls, and is a natural follow-up (M3.1) rather than part of this milestone.
- **Direct-only occlusion.** A shadowed panel loses its direct-beam irradiance for that hour but still receives diffuse skylight, matching the existing `decomposeGhi` direct/diffuse split. This is a real per-hour physical model, not a flat percentage multiplier.
- **Per-panel granularity.** Occlusion is tested per individual panel position (already known from M2's `panelAutoFillGrid`), not per array-centroid — so a tree partially shading one row of an array while the rest stays in full sun is represented correctly, which is the actual motivating case for building this milestone.
- **Shadow visuals use the renderer's own shadow mapping**, not a custom overlay driven pixel-for-pixel by the analytical computation. Three.js `DirectionalLight` + `castShadow`/`receiveShadow`, positioned from the scrubber's chosen sun angle. This is a deliberate scope cut: the rendered shadow and the exact analytical number are produced by two different mechanisms and could disagree by a sliver at grazing angles, but the rendered shadow never feeds the actual chart output, so this can't produce a wrong number — only, in rare edge cases, a shadow that looks a hair off from what the number implies.
- **Applies only when a 3D scene has been applied.** The manual single-array form has no 3D geometry to raycast against, so it keeps using `manualShadingPercent` exactly as today — M3 doesn't touch that path at all.

## Architecture

### New pure module: `src/solar-physics/shadowOcclusion.ts`

Generic 3D ray-intersection primitives with no scene/UI knowledge, matching `solar-physics`'s existing "pure functions only" boundary:

- Ray vs. tilted plane (for shape/roof occlusion — a shape's extruded 3D vertices already come from `scene/derive`'s `polygonToExtrusionGeometry`, but this module only deals in raw vertex arrays, not `scene/` types).
- Ray vs. cylinder and ray vs. cone (tree obstructions — approximating the canopy as a cone over a trunk cylinder, matching what's actually rendered).
- Ray vs. box (building obstructions).
- `isPanelOccluded(panelPosition: Vec3, sunDirection: Vec3, obstacles: Obstacle[]): boolean` — the composed entry point `simulation` will call, iterating obstacle primitives and returning true on the first hit.

Gets the same hand-verified, reference-checked unit-test rigor as `sunPosition`/`poaIrradiance` — this module is now on the critical path for the actual generation number, same as the rest of `solar-physics`.

### New type: `SceneGeometry` (in `src/simulation/types.ts`)

A plain, serializable data structure — no module dependency on `scene/`, just data flowing in, exactly like `SystemConfig` itself already flows from `scene/apply/` into `simulation/` today:

```ts
interface SceneGeometry {
  shapes: { id: string; vertices: Vec3[] }[] // extruded 3D plane vertices, ENU meters
  obstructions: {
    kind: 'tree' | 'building'
    position: { x: number; y: number }
    heightM: number
    radiusM: number
  }[]
  panels: { shapeId: string; position: Vec3 }[] // one entry per real panel
}
```

Built by `scene/apply/` (extending `deriveSystemConfigFromScene` or a sibling function) from `SceneDesignState` — which already has traced shape geometry (#55/#57), obstructions (#58), and panel layouts (#57/#70) — and passed into `runTmySimulation`/`runLiveSimulation` as a new **optional** parameter alongside `SystemConfig`.

### Simulation loop changes

`runTmySimulation`/`runLiveSimulation` already loop hour-by-hour, computing sun position once per hour and, per array, calling `poaIrradiance`/`panelPowerOutput` once and multiplying by `panelCount`. When `sceneGeometry` is provided for a given array:

1. Convert the hour's already-computed sun altitude/azimuth into an ENU unit direction vector.
2. For each of that array's real panels (from `sceneGeometry.panels`, filtered by `shapeId`), call `isPanelOccluded` against every *other* shape and every obstruction (a shape never occludes its own panels).
3. If occluded, zero only the direct-beam component before calling `panelPowerOutput` for that panel (diffuse from `decomposeGhi` is untouched, per the direct-only-occlusion decision above).
4. Sum per-panel power into the array total, replacing the `panelPowerOutput(...) * panelCount` shortcut for that array.

When `sceneGeometry` is absent (manual form, or a scene applied before M3 shipped and never re-applied), the existing `manualShadingPercent` flat-reduction path is unchanged — this is purely additive.

Cost is bounded and small: TMY mode only iterates representative days per month (per the existing M1 disaggregation approach, `docs/decisions/0080-tmy-disaggregation-approach.md`), Live mode only iterates the forecast window (≤7 days) — so worst case is on the order of a few hundred hours × tens of panels × a handful of obstacles, comfortably sub-second in-browser.

### 3D scene UI: sun-position scrubber

A new time-of-day/day-of-year scrubber added to Step 3 of the existing `SceneEditorFlow` (`src/scene/scene/Scene3DView.tsx` and friends). Moving it recomputes the sun's ENU direction for the chosen moment (reusing `solar-physics/sunPosition`, already available) and repositions a `DirectionalLight` accordingly; `castShadow`/`receiveShadow` on panel, shape, and obstruction meshes let Three.js's own shadow mapping render the resulting shadows. This is a real-time visual preview only — it does not feed the actual per-hour simulation loop, which runs its own precise analytical raycasting independently (see above).

## Data flow

1. User completes M2's flow as before: trace → configure → place obstructions → (new) preview shadows with the scrubber → Apply.
2. `scene/apply/` derives both the existing `SystemConfig` (unchanged shape) and the new `SceneGeometry`, and the flow's `onApply` callback now carries both.
3. `App.tsx` passes both into `runTmySimulation`/`runLiveSimulation` when a scene has been applied; passes neither (manual path, `manualShadingPercent` as today) when the manual form is in use.
4. Charts render the result exactly as today — no chart-level changes, since the output shape (`TmySimulationResult`/`LiveSimulationResult`) doesn't change.

## Error handling

- Raycasting against degenerate/self-intersecting geometry: `scene/derive`'s existing validation (from #55/#56) already blocks invalid polygons before they reach this stage, so `shadowOcclusion` can assume well-formed input — no new validation layer needed.
- A shape with zero panels (e.g. an unconfigured or emptied array): skipped in the per-panel loop, contributing zero power, consistent with existing zero-array-length handling from M2.
- Obstruction geometry with a non-positive height or radius: already blocked by M2's obstruction property panel validation (#58) — not re-validated here.

## Testing

- `solar-physics/shadowOcclusion.ts`: unit tests against hand-computed/known-geometry reference cases (a panel directly behind a tall thin obstacle at a known sun angle should occlude; the same panel with the sun on the opposite side should not), matching the rigor of the rest of `solar-physics`. This is now correctness-critical for the real generation number, so gets the same bar as `sunPosition`/`poaIrradiance`.
- `simulation`'s per-panel loop: integration tests with fixture `SceneGeometry` (a simple obstruction at a known position, a simple array), asserting that an hour with a known-occluded sun angle produces less power than the same hour with the obstruction removed, and that diffuse-only power remains during occlusion (never fully zero).
- The sun-position scrubber and shadow-map rendering: light rendering tests (mocked Canvas, per the existing R3F testing convention from #57/#58) plus mandatory manual browser verification — moving the scrubber should visibly move shadows across the scene.
