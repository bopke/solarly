# scene

The M2 3D scene editor: tracing a roof/ground-mount plot's real outline over
satellite imagery, configuring per-shape tilt/azimuth, laying out panels and
obstructions in a 3D view, and deriving the resulting multi-array
`SystemConfig` (plus M3's `SceneGeometry`, for real shadow-casting) from that
session. See `docs/superpowers/specs/2026-09-13-solarly-m2-design.md`'s
"New module: `src/scene/`" section and
`docs/superpowers/specs/2026-09-13-solarly-m3-design.md`.

Mirrors the project's existing module-boundary convention (pure logic
separated from UI, UI depending only on typed outputs) rather than
introducing a new one. Depends on `solar-physics` (`scene/scene`'s
`sunDirection.ts` reuses `sunPosition` for the 3D scrubber's real-time
shadow preview) and `panel-presets` (panel dimensions/electrical specs used
to auto-fill and derive arrays), and produces the same `SystemConfig` /
`SceneGeometry` types `simulation/` already consumes from the manual
single-array form — `scene/` itself never imports `data-sources` or `ui`.
Unlike `ui/`, `scene/`'s entry point (`flow/`'s `SceneEditorFlow`) is wired
directly from `App.tsx`, not from inside `ui/`, since the M2 spec's "Design
in 3D" overlay sits alongside (not inside) the existing sidebar/chart
layout.

## `tracing/`

The 2D trace-over-satellite-imagery step (MapLibre + Mapbox Satellite raster
source + `@mapbox/mapbox-gl-draw`). Outputs a list of traced shapes
(`TracedShape`: `{ id, kind: 'roof-face' | 'ground-array', polygon }`).
`drawStyles.ts` is a hand-maintained copy of mapbox-gl-draw's default theme
(pinned to the installed version, with one deliberate `line-dasharray` fix —
see its own comment and `drawStyles.test.ts` for the drift check against the
installed package).

## `derive/`

Pure geometry functions, unit-testable in isolation like `solar-physics/`:
polygon → tilted-plane 3D extrusion geometry
(`polygonToExtrusionGeometry`), azimuth auto-suggestion from a traced
polygon's longest edge (`suggestAzimuth`), and panel auto-fill within a
shape's footprint given a panel preset's real dimensions
(`panelAutoFillGrid`). No dependency on React, Three.js/R3F, or MapLibre.

## `configure/`

The step-2 UI (`ConfigureShapes`) for reviewing/editing each traced shape's
suggested tilt and azimuth before it's used to build 3D geometry — field
validation (`validation.ts`) and preset tilt values (`defaults.ts`).

## `scene/`

The React Three Fiber 3D view (`Scene3DView`) — tilted planes auto-filled
with a panel grid, a free orbit camera, a north-arrow gizmo, and placed
obstructions (trees/buildings) with a small property panel. Has its own
`README.md` (`src/scene/scene/README.md`) with the fuller write-up,
including the M3 sun-position scrubber / real-time shadow preview
(`sunDirection.ts`) — the module's scope and internals are involved enough
to warrant that dedicated doc rather than a section here.

## `apply/`

Pure derivation functions run when the flow is applied: `deriveSystemConfig.ts`
turns a finished scene-design session into the multi-array `SystemConfig`
`simulation/` already accepts (one `PanelArrayConfig` per traced shape), and
`deriveSceneGeometry.ts` (M3, issue #75) derives the geometric `SceneGeometry`
the per-hour shadow-occlusion pipeline iterates — both from the same
`SceneDesignState`, kept as separate functions/files since their outputs have
independent consumers and neither needs the other's result. See each file's
own doc comment for the shared scene-local coordinate frame and the
resolvable-shape agreement between the two derivations
(`isShapeGeometryResolvable`).

## `flow/`

`SceneEditorFlow` — the stateful multi-step overlay ("Design in 3D") that
wires `tracing/` → `configure/` → `scene/` together, owns the in-progress
`SceneDesignState` for the session, and calls `apply/`'s derivations on
submit. `types.ts` defines `SceneDesignState` (traced shapes, per-shape
configs, obstructions, and panel layouts) and `SceneFlowLocation`.

## Testing

Per the M2 spec's testing section: pure functions (`derive/`, `apply/`) get
full unit-test coverage; the R3F scene component gets light rendering-smoke
tests with `@react-three/fiber`/`@react-three/drei` mocked out, since
WebGL/Canvas is hard to meaningfully exercise under jsdom. **Manual browser
verification (`npm run dev`) is the real check** for camera orbit, visual
tilt/azimuth correctness, panel-grid sizing, and (for the modal focus-trap
in `flow/SceneEditorFlow.tsx`) actual keyboard/focus behavior — see each
PR's description for what was checked.
