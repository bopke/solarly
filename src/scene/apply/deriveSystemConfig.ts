/**
 * scene/apply — the pure "Apply" derivation for issue #61 (the last M2
 * step, see `docs/superpowers/specs/2026-09-13-solarly-m2-design.md`'s
 * "Apply" step under UI/UX).
 *
 * Turns a `SceneDesignState` (traced shapes, per-shape tilt/azimuth from
 * `scene/configure`, and the panel layouts `scene/scene`'s `Scene3DView`
 * actually rendered) into the multi-array `SystemConfig` shape issue #54
 * added to `simulation/types.ts` — one `PanelArrayConfig` per traced
 * shape, feedable straight into `runTmySimulation`/`runLiveSimulation`.
 *
 * Deliberately a standalone pure function rather than something baked into
 * `SceneEditorFlow` itself, so it can be unit-tested the same way as
 * `scene/derive`'s geometry functions (per the M2 spec's "Testing"
 * section) without needing to render any React/Three.js/MapLibre
 * component.
 */

import type { PanelPreset } from '../../panel-presets'
import type { PanelArrayConfig, SystemConfig } from '../../simulation'
import type { SceneDesignState } from '../flow/types'
import { isShapeGeometryResolvable } from './deriveSceneGeometry'

/**
 * M2 doesn't compute real shadow-casting from placed obstructions — that's
 * M3 (see the M2 spec's purpose section: "M2 is camera/scene placement and
 * multi-array wiring only — it does not calculate real shadows"). Every
 * derived array's `manualShadingPercent` defaults to this until then,
 * matching `SystemConfigForm`'s own default for the equivalent
 * single-array field (`src/ui/SystemConfigForm/SystemConfigForm.tsx`'s
 * `DEFAULT_VALUES.manualShadingPercent`).
 */
export const DEFAULT_SCENE_MANUAL_SHADING_PERCENT = 0

/**
 * `systemLossesPercent` (wiring/inverter/soiling losses) is system-wide,
 * not per-shape (see `SystemConfig`'s doc comment), and nothing upstream
 * of the Apply step lets the user pick it — so this is the fallback used
 * when the caller doesn't supply one. Matches `SystemConfigForm`'s own
 * default for the equivalent field
 * (`DEFAULT_VALUES.systemLossesPercent`), for consistency between the two
 * `SystemConfig` sources.
 */
export const DEFAULT_SCENE_SYSTEM_LOSSES_PERCENT = 14

export interface DeriveSystemConfigOptions {
  /**
   * The panel model whose `ratedWattsPeak`/`efficiencyPercent`/
   * `tempCoefficientPercentPerC` are used for every derived array — the
   * 3D scene editor doesn't (yet) support a different panel model per
   * shape, matching the single panel grid `Scene3DView` auto-fills every
   * shape with.
   */
  panelPreset: PanelPreset
  /** System-wide losses, as a percentage. Defaults to {@link DEFAULT_SCENE_SYSTEM_LOSSES_PERCENT}. */
  systemLossesPercent?: number
  /**
   * Manual shading derate applied to every derived array, as a
   * percentage. Defaults to {@link DEFAULT_SCENE_MANUAL_SHADING_PERCENT}
   * — see that constant's doc comment for why (M3 scope).
   */
  manualShadingPercent?: number
}

/**
 * Derives a multi-array `SystemConfig` from a scene-design session: one
 * `PanelArrayConfig` per traced shape that has both a resolved step-2
 * tilt/azimuth configuration (`state.shapeConfigs`) and a step-3 panel
 * layout (`state.panelLayouts`) — using the *exact* panel count
 * `Scene3DView` rendered (see `ShapePanelLayout`'s doc comment on why this
 * isn't independently recomputed here), not a fresh area-based estimate.
 *
 * A traced shape without a matching `shapeConfigs` entry (shouldn't happen
 * once step 2 has validated every shape — see `SceneEditorFlow`'s
 * `canAdvanceFromStep2` gating) is skipped defensively rather than
 * producing a garbage array. A shape with a config but no panel-layout
 * entry (step 3 was never visited, or its geometry couldn't be built —
 * see `ShapePanelLayout`'s doc comment) still produces an array, with
 * `panelCount: 0` — it contributes zero generation rather than silently
 * vanishing from the derived config, so its tilt/azimuth is still visible
 * if a caller inspects/displays `arrays`.
 *
 * ## `shapeId` population (issue #78)
 *
 * Each derived array's `shapeId` is set to the traced shape's own `id` —
 * the same identity `deriveSceneGeometryFromScene` uses for
 * `SceneGeometry.shapes[].id`/`panels[].shapeId` — but ONLY when that
 * shape's geometry is actually resolvable, via the shared
 * `isShapeGeometryResolvable` check (exported by `deriveSceneGeometry.ts`
 * specifically so both derivations agree on this).
 *
 * This function's own array-inclusion condition (a matching `shapeConfigs`
 * entry) is looser than `deriveSceneGeometryFromScene`'s (a matching
 * config AND a non-degenerate polygon/tilt combination — see that
 * function's doc comment): a shape can pass here but be skipped there,
 * e.g. a self-intersecting polygon that slipped through step-1 validation
 * with a still-present step-2 config. Rather than change which arrays this
 * function produces (that would drop a shape's tilt/azimuth/panel-count
 * from the applied `SystemConfig` entirely, changing this issue's own
 * behavior beyond its scope), such an array is still produced but with
 * `shapeId: undefined` — explicitly opting it out of #77's occlusion path
 * rather than setting an id that `SceneGeometry.shapes` will never contain
 * (which `resolveArrayScenePanels` would also fall back safely on, but
 * leaving that to an incidental lookup-miss rather than an explicit
 * decision is exactly the "accidental" behavior this issue's scope calls
 * out to fix). Such an array instead uses the pre-M3
 * `manualShadingPercent` flat-derate path unchanged, same as before this
 * field existed.
 */
export function deriveSystemConfigFromScene(
  state: SceneDesignState,
  options: DeriveSystemConfigOptions,
): SystemConfig {
  const {
    panelPreset,
    systemLossesPercent = DEFAULT_SCENE_SYSTEM_LOSSES_PERCENT,
    manualShadingPercent = DEFAULT_SCENE_MANUAL_SHADING_PERCENT,
  } = options

  const arrays: PanelArrayConfig[] = state.tracedShapes.flatMap((shape) => {
    const config = state.shapeConfigs.find((c) => c.shapeId === shape.id)
    if (!config) return []
    const layout = state.panelLayouts.find((l) => l.shapeId === shape.id)
    const panelCount = layout?.panelCount ?? 0
    const shapeId = isShapeGeometryResolvable(shape, config)
      ? shape.id
      : undefined

    return [
      {
        tiltDeg: config.tiltDeg,
        azimuthDeg: config.azimuthDeg,
        panelCount,
        wattsPerPanel: panelPreset.ratedWattsPeak,
        efficiencyPercent: panelPreset.efficiencyPercent,
        tempCoefficientPercentPerC: panelPreset.tempCoefficientPercentPerC,
        manualShadingPercent,
        shapeId,
      },
    ]
  })

  return { arrays, systemLossesPercent }
}
