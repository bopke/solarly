# scene/scene

The React Three Fiber 3D view for M2's plot scene editor
(`docs/superpowers/specs/2026-09-13-solarly-m2-design.md`'s "3D scene"
step, issue #57).

`Scene3DView` renders one or more already-configured shapes — each an
`ExtrusionGeometry` from `scene/derive` (tilted-plane geometry derived from
a traced polygon's tilt/azimuth) plus a panel preset's real
`widthMm`/`heightMm` — as a tilted plane auto-filled with a panel grid
(via `scene/derive`'s `panelAutoFillGrid`), with a free orbit camera
(`@react-three/drei`'s `OrbitControls`) and a north-arrow gizmo for
orientation.

This component is intentionally self-contained: it takes derived geometry
as props and renders it. It does **not**:

- trace shapes or edit tilt/azimuth (that's the tracing step and issue
  #59's config UI),
- place or render obstructions (issue #58),
- wire into the app's data flow / provide an entry point (issue #60).

Depends on `scene/derive` (for `ExtrusionGeometry`, `PanelDimensions`, and
`panelAutoFillGrid`) and, for panel dimensions, whatever the caller reads
out of `panel-presets/` — this module doesn't import `panel-presets/`
itself, it only needs the `widthMm`/`heightMm` shape.

## Files

- `Scene3DView.tsx` — the `<Canvas>`-based component and its props.
- `geometryBuilders.ts` — pure `THREE.BufferGeometry`/bounds/offset helpers
  used by `Scene3DView`, kept free of any React/R3F import so the actual
  vertex math is unit-testable under plain Vitest (no WebGL/Canvas
  needed to build a `BufferGeometry`, only to render one).
- `NorthArrowGizmo.tsx` — a small custom scene-anchored compass arrow
  (not one of drei's viewport-fixed `GizmoHelper`/`GizmoViewport` axis
  cubes, which show render-space X/Y/Z rather than true north).

## Testing

Per the M2 spec's testing section and this project's existing MapLibre
precedent (`src/ui/LocationPicker.test.tsx`): R3F/WebGL is hard to
meaningfully exercise under jsdom. `geometryBuilders.ts`'s pure functions
get real unit tests (`geometryBuilders.test.ts`); `Scene3DView.test.tsx` is
a light rendering smoke test with `@react-three/fiber`/`@react-three/drei`
mocked out. **Manual browser verification (`npm run dev`) is the real
check** for camera orbit, visual tilt/azimuth correctness, and panel-grid
sizing — see the PR description for what was checked.
