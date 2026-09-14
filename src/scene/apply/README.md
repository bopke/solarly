# scene/apply

Pure derivation functions run when the scene editor flow is applied
(`flow/`'s `handleApply`, issue #60's step 4).

- `deriveSystemConfig.ts` — `deriveSystemConfigFromScene` turns a finished
  `SceneDesignState` into the multi-array `SystemConfig` `simulation/`
  already accepts, one `PanelArrayConfig` per traced shape, using that
  shape's step-2 tilt/azimuth, its step-3 panel count, and the caller's
  panel preset (issue #61).
- `deriveSceneGeometry.ts` — `deriveSceneGeometryFromScene` (M3, issue #75)
  derives the geometric `SceneGeometry` the per-hour shadow-occlusion
  pipeline iterates, from that same `SceneDesignState`.

Both derivations run from the same `SceneDesignState` snapshot (see
`SceneApplyResult`'s doc comment in `flow/SceneEditorFlow.tsx`) but are kept
as separate functions/files rather than merged into one, since their
outputs have independent consumers and neither needs the other's result.
See each file's own doc comment for the shared scene-local coordinate frame
and the resolvable-shape agreement between the two derivations
(`isShapeGeometryResolvable`).

No dependency on React, Three.js/R3F, or MapLibre — like `scene/derive/`,
this is plain, directly unit-testable logic.

This is a short module by design (two derivation files); see
`src/scene/README.md`'s "`apply/`" section for the one-paragraph summary
kept there too — the two aren't meant to duplicate each other in depth, just
to give this directory the same "has its own README" treatment as every
other `src/` module per the project convention (issue #92).
