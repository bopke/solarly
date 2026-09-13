import { useEffect, useMemo, useState } from 'react'
import { SceneTracing } from '../tracing'
import type { TracedShape } from '../tracing'
import { ConfigureShapes } from '../configure'
import type { ShapeConfig } from '../configure'
import { Scene3DView } from '../scene'
import type { Obstruction, Scene3DShape } from '../scene'
import { polygonToExtrusionGeometry, type PanelDimensions } from '../derive'
import { PANEL_PRESETS } from '../../panel-presets'
import type { SceneDesignState, SceneFlowLocation } from './types'
import styles from './SceneEditorFlow.module.css'

type Step = 1 | 2 | 3 | 4

const STEP_LABELS: Record<Step, string> = {
  1: 'Trace',
  2: 'Configure',
  3: '3D scene',
  4: 'Apply',
}

const STEPS: Step[] = [1, 2, 3, 4]

/**
 * `polygonToExtrusionGeometry` only accepts `tiltDeg` in `[0, 90)` — see
 * its own doc comment for why 90 (a vertical wall) has no well-defined
 * plan-view footprint to invert. `ConfigureShapes`'s validation allows a
 * tilt of exactly 90, matching `SystemConfigForm`'s existing 0-90 range,
 * so this clamp is purely a rendering-safety measure for the 3D preview
 * (step 3) — it does not alter the configured `tiltDeg` value stored in
 * `shapeConfigs`/`SceneDesignState`, which is what issue #61 will
 * eventually read.
 */
const MAX_RENDER_TILT_DEG = 89.9

const DEFAULT_PANEL: PanelDimensions = (() => {
  const preset = PANEL_PRESETS.find(
    (p) => p.id === 'generic-residential-default',
  )
  return preset
    ? { widthMm: preset.widthMm, heightMm: preset.heightMm }
    : { widthMm: 1000, heightMm: 2000 }
})()

export interface SceneEditorFlowProps {
  /**
   * Whether the overlay is currently visible. `SceneEditorFlow` stays
   * mounted regardless of this value (see the component doc comment
   * below) — toggling it only shows/hides the overlay, it never resets
   * in-progress work.
   */
  open: boolean
  /** The already-resolved location from the app's location picker — used to center the trace map and for ground-array defaults in step 2. */
  location: SceneFlowLocation
  /** Called when the user dismisses the overlay (the close button, or the browser Escape key). */
  onClose: () => void
  /**
   * Called whenever the aggregated scene-design state changes (any
   * traced shape, per-shape config, or obstruction added/edited/
   * removed) — lets a parent (e.g. `App.tsx`) keep a compact "N shapes
   * traced" sidebar summary up to date without needing to duplicate this
   * component's internal step state.
   */
  onStateChange?: (state: SceneDesignState) => void
  /**
   * Called when the user clicks step 4's "Apply" button, with the full
   * current `SceneDesignState`. This is a placeholder hook for issue #61
   * ("Apply": derive the multi-array `SystemConfig` from this state and
   * feed it into the simulation) — actually deriving that config is
   * explicitly out of scope here. When omitted, the Apply button is
   * still shown (so the step-4 shell exists) but does nothing on click.
   */
  onApply?: (state: SceneDesignState) => void
  /** Panel dimensions used to auto-fill the 3D preview when a shape doesn't specify its own. Defaults to the `generic-residential-default` preset. */
  defaultPanel?: PanelDimensions
  /** Passed through to `SceneTracing` — mainly for tests; real callers should rely on the `VITE_MAPBOX_API_KEY` env var instead. */
  mapboxApiKey?: string
}

/**
 * The M2 "Design in 3D" full-screen overlay (issue #60): composes the
 * four already-built steps —
 * `SceneTracing` (#56), `ConfigureShapes` (#59), `Scene3DView` (#57/#58),
 * and a step-4 Apply shell (real logic in #61) — with step navigation
 * and state that survives moving back and forth between steps, and
 * survives the overlay being closed and reopened ("Edit scene").
 *
 * ## Why this component never unmounts its own children
 *
 * `SceneTracing` has no way to be seeded with previously-traced polygons
 * (see its props) — it always starts from an empty `mapbox-gl-draw`
 * session on mount, and its very first `onShapesChange` call (empty) would
 * otherwise clobber any shapes already recorded in this component's state.
 * So rather than conditionally rendering only the active step's component
 * (which would remount it every time the user navigates away and back),
 * every step's component is mounted at most once, the first time its step
 * is reached, and then kept mounted for the rest of this component's own
 * lifetime — including while the overlay is closed via `open={false}` — with
 * only CSS visibility toggled. That's also why the overlay is expected to
 * stay in the render tree at all times (see `App.tsx`): `open={false}`
 * hides it, it does not unmount it.
 *
 * `Scene3DView` and `ConfigureShapes` don't strictly need this (the
 * former is fully controlled via `obstructions`/`onObstructionsChange`,
 * the latter accepts `initialConfigs` to reseed on remount), but keeping
 * all three consistent avoids relying on those two components' fallback
 * paths as load-bearing behavior.
 */
export function SceneEditorFlow({
  open,
  location,
  onClose,
  onStateChange,
  onApply,
  defaultPanel = DEFAULT_PANEL,
  mapboxApiKey,
}: SceneEditorFlowProps) {
  const [step, setStep] = useState<Step>(1)
  const [visitedSteps, setVisitedSteps] = useState<ReadonlySet<Step>>(
    () => new Set(),
  )

  const [tracedShapes, setTracedShapes] = useState<TracedShape[]>([])
  const [hasInvalidTracedShapes, setHasInvalidTracedShapes] = useState(false)
  const [shapeConfigs, setShapeConfigs] = useState<ShapeConfig[]>([])
  const [isShapeConfigValid, setIsShapeConfigValid] = useState(true)
  const [obstructions, setObstructions] = useState<Obstruction[]>([])

  // Mount step 1 as soon as the overlay is first opened, and mount each
  // later step the first time it's actually reached — then never drop
  // any of them again for this component's lifetime. See the component
  // doc comment above for why.
  useEffect(() => {
    if (!open) return
    setVisitedSteps((prev) => {
      if (prev.has(step)) return prev
      const next = new Set(prev)
      next.add(step)
      return next
    })
  }, [open, step])

  const state = useMemo<SceneDesignState>(
    () => ({
      tracedShapes,
      hasInvalidTracedShapes,
      shapeConfigs,
      isShapeConfigValid,
      obstructions,
    }),
    [
      tracedShapes,
      hasInvalidTracedShapes,
      shapeConfigs,
      isShapeConfigValid,
      obstructions,
    ],
  )

  useEffect(() => {
    onStateChange?.(state)
    // `onStateChange` is intentionally excluded: a parent passing an
    // inline arrow function (the common case, see `App.tsx`) would
    // otherwise re-fire this effect on every parent render even when
    // `state` itself hasn't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // `ConfigureShapes` only ever consults `initialConfigs` "the first time
  // [a shape] is seen" (its own doc comment) — once it has field state for
  // a given shape id, further changes to this map for that id are inert.
  // Since `ConfigureShapes` is kept mounted for this component's whole
  // lifetime (see the doc comment above) rather than remounted on each
  // visit to step 2, this mainly matters for a shape traced *after* step 2
  // was first reached; recomputing it fresh from the latest
  // `shapeConfigs` on every render is simplest and safe either way.
  const initialShapeConfigs = useMemo(
    () =>
      Object.fromEntries(
        shapeConfigs.map((c) => [
          c.shapeId,
          { tiltDeg: c.tiltDeg, azimuthDeg: c.azimuthDeg },
        ]),
      ),
    [shapeConfigs],
  )

  const scene3DShapes = useMemo<Scene3DShape[]>(() => {
    return tracedShapes.flatMap((shape) => {
      const config = shapeConfigs.find((c) => c.shapeId === shape.id)
      if (!config) return []
      const safeTilt = Math.min(config.tiltDeg, MAX_RENDER_TILT_DEG)
      try {
        const geometry = polygonToExtrusionGeometry(
          shape.polygon,
          safeTilt,
          config.azimuthDeg,
        )
        return [{ id: shape.id, geometry }]
      } catch {
        // A shape whose config can't yet produce valid geometry (e.g. an
        // edited-but-not-yet-submitted field) is simply omitted from the
        // 3D preview rather than crashing it.
        return []
      }
    })
  }, [tracedShapes, shapeConfigs])

  const hasTracedShapes = tracedShapes.length > 0
  const canAdvanceFromStep1 = hasTracedShapes && !hasInvalidTracedShapes
  const canAdvanceFromStep2 = isShapeConfigValid

  const nextDisabled =
    (step === 1 && !canAdvanceFromStep1) || (step === 2 && !canAdvanceFromStep2)

  function goNext() {
    if (nextDisabled) return
    setStep((s) => (s < 4 ? ((s + 1) as Step) : s))
  }

  function goBack() {
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s))
  }

  function handleApply() {
    onApply?.(state)
  }

  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  return (
    <div
      className={styles.overlay}
      data-open={open}
      role="dialog"
      aria-modal="true"
      aria-label="Design in 3D"
      aria-hidden={!open}
    >
      <div className={styles.header}>
        <ol className={styles.stepNav} aria-label="Steps">
          {STEPS.map((s) => (
            <li
              key={s}
              className={
                s === step
                  ? `${styles.stepNavItem} ${styles.stepNavItemActive}`
                  : styles.stepNavItem
              }
              aria-current={s === step ? 'step' : undefined}
            >
              {s}. {STEP_LABELS[s]}
            </li>
          ))}
        </ol>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close"
        >
          &times;
        </button>
      </div>

      <div className={styles.stepsWrapper}>
        {visitedSteps.has(1) && (
          <div
            className={styles.stepPanel}
            data-visible={step === 1}
            aria-hidden={step !== 1}
          >
            <SceneTracing
              center={location}
              mapboxApiKey={mapboxApiKey}
              onShapesChange={(shapes, hasInvalid) => {
                setTracedShapes(shapes)
                setHasInvalidTracedShapes(hasInvalid)
              }}
            />
          </div>
        )}

        {visitedSteps.has(2) && (
          <div
            className={styles.stepPanel}
            data-visible={step === 2}
            aria-hidden={step !== 2}
          >
            <ConfigureShapes
              shapes={tracedShapes}
              location={location}
              initialConfigs={initialShapeConfigs}
              onChange={(configs, isValid) => {
                setShapeConfigs(configs)
                setIsShapeConfigValid(isValid)
              }}
            />
          </div>
        )}

        {visitedSteps.has(3) && (
          <div
            className={styles.stepPanel}
            data-visible={step === 3}
            aria-hidden={step !== 3}
          >
            <Scene3DView
              shapes={scene3DShapes}
              defaultPanel={defaultPanel}
              obstructions={obstructions}
              onObstructionsChange={setObstructions}
              className={styles.scene3D}
            />
          </div>
        )}

        {visitedSteps.has(4) && (
          <div
            className={styles.stepPanel}
            data-visible={step === 4}
            aria-hidden={step !== 4}
          >
            <div className={styles.applyStep}>
              <h2 className={styles.applyTitle}>Apply</h2>
              <p className={styles.applyBody}>
                {tracedShapes.length} shape
                {tracedShapes.length === 1 ? '' : 's'} traced,{' '}
                {obstructions.length} obstruction
                {obstructions.length === 1 ? '' : 's'} placed. Applying will
                replace the manual single-array configuration with this scene.
              </p>
              <button
                type="button"
                className={styles.applyButton}
                onClick={handleApply}
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          onClick={goBack}
          disabled={step === 1}
          className={styles.navButton}
        >
          Back
        </button>
        {step < 4 ? (
          <button
            type="button"
            onClick={goNext}
            disabled={nextDisabled}
            className={styles.navButton}
          >
            Next
          </button>
        ) : null}
      </div>
    </div>
  )
}
