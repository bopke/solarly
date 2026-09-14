import { useEffect, useMemo, useRef, useState } from 'react'
import { SceneTracing } from '../tracing'
import type { TracedShape } from '../tracing'
import { ConfigureShapes } from '../configure'
import type { ShapeConfig } from '../configure'
import { Scene3DView } from '../scene'
import type { Obstruction, Scene3DShape, ShapePanelLayout } from '../scene'
import { polygonToExtrusionGeometry, type PanelDimensions } from '../derive'
import {
  deriveSceneGeometryFromScene,
  deriveSystemConfigFromScene,
} from '../apply'
import { PANEL_PRESETS, type PanelPreset } from '../../panel-presets'
import type { SceneGeometry, SystemConfig } from '../../simulation'
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

const FALLBACK_PANEL_PRESET: PanelPreset = {
  id: 'fallback-panel',
  make: 'Generic',
  model: 'Fallback',
  ratedWattsPeak: 400,
  efficiencyPercent: 20,
  widthMm: 1000,
  heightMm: 2000,
  areaM2: 2,
  tempCoefficientPercentPerC: -0.35,
  isGeneric: true,
  notes: '',
}

/**
 * Used for both the 3D preview's panel dimensions (`defaultPanel`) and,
 * per issue #61, the panel model every derived array's `wattsPerPanel`/
 * `efficiencyPercent`/`tempCoefficientPercentPerC` comes from — the scene
 * editor doesn't yet support choosing a different panel preset per shape
 * (or at all), matching the single panel grid `Scene3DView` auto-fills
 * every shape with. `PANEL_PRESETS.find` should never actually miss (the
 * id is a fixture of this codebase's own curated dataset), but a static
 * fallback keeps this component resilient rather than throwing if that
 * dataset ever changes shape.
 */
const DEFAULT_PANEL_PRESET: PanelPreset =
  PANEL_PRESETS.find((p) => p.id === 'generic-residential-default') ??
  FALLBACK_PANEL_PRESET

const DEFAULT_PANEL: PanelDimensions = {
  widthMm: DEFAULT_PANEL_PRESET.widthMm,
  heightMm: DEFAULT_PANEL_PRESET.heightMm,
}

/** Matches `SystemConfigForm`'s own default for the equivalent field (`DEFAULT_VALUES.systemLossesPercent`). */
const DEFAULT_SYSTEM_LOSSES_INPUT = '14'

/**
 * Elements a standard modal focus trap should treat as reachable via Tab
 * (issue #93). `[tabindex]:not([tabindex="-1"])` covers the overlay's own
 * `tabIndex={-1}` fallback focus target being correctly *excluded* (a
 * programmatic-only focus target isn't part of the Tab sequence).
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * Whether `element` sits inside a currently-hidden step panel (this
 * component keeps every visited step's panel mounted at all times — see
 * the component doc comment — with only `aria-hidden`/`data-visible`
 * toggled) rather than one only invisible via CSS `visibility` that jsdom's
 * layout-free test environment can't observe. Filtering on `aria-hidden`
 * instead keeps the focus trap's notion of "reachable" correct under both
 * a real browser and this project's jsdom-based component tests.
 */
function isReachable(element: HTMLElement): boolean {
  return element.closest('[aria-hidden="true"]') === null
}

/** The Tab-reachable focusable elements currently inside `container`, in DOM order. */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(isReachable)
}

/**
 * Mirrors `SystemConfigForm/validation.ts`'s `PLAIN_DECIMAL_PATTERN` —
 * `scene/` deliberately doesn't import from `ui/` (no cross-module
 * dependency in that direction, see the M2 spec's module boundaries), so
 * this small amount of validation logic is duplicated locally rather than
 * shared.
 */
const PLAIN_DECIMAL_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)$/

/** Validates the Apply step's "System losses (%)" field. `null` means valid. */
function validateSystemLossesPercent(rawValue: string): string | null {
  const trimmed = rawValue.trim()
  if (trimmed === '') return 'System losses is required'
  if (!PLAIN_DECIMAL_PATTERN.test(trimmed)) {
    return 'System losses must be a number'
  }
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return 'System losses must be a number'
  if (value < 0) return 'System losses must be at least 0'
  if (value > 100) return 'System losses must be at most 100'
  return null
}

/**
 * Payload handed to `onApply` (issue #78): the multi-array `SystemConfig`
 * (issue #61's `deriveSystemConfigFromScene`, unchanged) alongside the
 * `SceneGeometry` derived from the exact same `SceneDesignState` via
 * issue #75's `deriveSceneGeometryFromScene` — both computed from one
 * `handleApply` call so they always describe the same scene snapshot.
 * `SystemConfig.arrays[].shapeId` correlates entries between the two (see
 * that field's doc comment); a caller passes both straight through to
 * `runTmySimulation`/`runLiveSimulation`'s `systemConfig`/`sceneGeometry`
 * inputs for #77's per-panel occlusion to kick in.
 */
export interface SceneApplyResult {
  systemConfig: SystemConfig
  sceneGeometry: SceneGeometry
}

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
   * Called when the user clicks step 4's "Apply" button, with the derived
   * multi-array `SystemConfig` (issue #61) — one `PanelArrayConfig` per
   * traced shape, using that shape's step-2 tilt/azimuth, its step-3
   * panel count, `panelPreset`'s panel-model fields, and the step-4
   * "System losses" field — plus the `SceneGeometry` derived from the same
   * state via `deriveSceneGeometryFromScene` (issue #78), for the caller
   * to thread into `runTmySimulation`/`runLiveSimulation`'s
   * `sceneGeometry` input alongside the `systemConfig`. See
   * `SceneApplyResult`'s doc comment. When omitted, the Apply button is
   * still shown (so the step-4 shell exists) but does nothing on click.
   */
  onApply?: (result: SceneApplyResult) => void
  /** Panel dimensions used to auto-fill the 3D preview when a shape doesn't specify its own. Defaults to `panelPreset`'s dimensions. */
  defaultPanel?: PanelDimensions
  /**
   * The panel model used to fill every derived array's `wattsPerPanel`/
   * `efficiencyPercent`/`tempCoefficientPercentPerC` on Apply (issue #61)
   * — see `DEFAULT_PANEL_PRESET`'s doc comment for why this is a single
   * preset for the whole scene rather than per-shape. Defaults to the
   * `generic-residential-default` preset.
   */
  panelPreset?: PanelPreset
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
  panelPreset = DEFAULT_PANEL_PRESET,
  mapboxApiKey,
}: SceneEditorFlowProps) {
  const [step, setStep] = useState<Step>(1)
  const [systemLossesInput, setSystemLossesInput] = useState(
    DEFAULT_SYSTEM_LOSSES_INPUT,
  )
  const [visitedSteps, setVisitedSteps] = useState<ReadonlySet<Step>>(
    () => new Set(),
  )

  const overlayRef = useRef<HTMLDivElement | null>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  const [tracedShapes, setTracedShapes] = useState<TracedShape[]>([])
  const [hasInvalidTracedShapes, setHasInvalidTracedShapes] = useState(false)
  const [shapeConfigs, setShapeConfigs] = useState<ShapeConfig[]>([])
  const [isShapeConfigValid, setIsShapeConfigValid] = useState(true)
  const [obstructions, setObstructions] = useState<Obstruction[]>([])
  const [panelLayouts, setPanelLayouts] = useState<ShapePanelLayout[]>([])

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
      panelLayouts,
    }),
    [
      tracedShapes,
      hasInvalidTracedShapes,
      shapeConfigs,
      isShapeConfigValid,
      obstructions,
      panelLayouts,
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

  const totalPanelCount = panelLayouts.reduce(
    (sum, layout) => sum + layout.panelCount,
    0,
  )

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

  const systemLossesError = validateSystemLossesPercent(systemLossesInput)
  const applyDisabled = systemLossesError !== null

  function handleApply() {
    if (applyDisabled) return
    const systemConfig = deriveSystemConfigFromScene(state, {
      panelPreset,
      systemLossesPercent: Number(systemLossesInput.trim()),
    })
    const sceneGeometry = deriveSceneGeometryFromScene(state)
    onApply?.({ systemConfig, sceneGeometry })
  }

  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  /**
   * Standard modal focus-trap pattern (issue #93): on open, remember
   * whatever had focus (the "Design in 3D"/"Edit scene" button, in
   * practice) so it can be restored on close, move focus into the dialog,
   * mark the rest of the page `inert`/`aria-hidden` so a screen-reader or
   * keyboard user can't reach `AppShell` behind it, and trap Tab/Shift+Tab
   * within the dialog's currently-reachable focusable elements while it's
   * open. No focus-trap library is a project dependency yet (checked
   * `package.json`), and pulling one in for this one overlay would be
   * scope creep for a polish pass — this hand-rolled version covers the
   * same standard pattern.
   *
   * Runs once per open/close transition (dependency: just `open`) rather
   * than re-running per render, and does its own DOM query for the
   * currently-focusable elements at trap time (inside `handleTabKey`)
   * rather than once up front, since which elements are reachable changes
   * as the user navigates between steps while the overlay stays open.
   */
  useEffect(() => {
    const overlayElement = overlayRef.current
    if (!open || !overlayElement) return
    // Reassigned to a non-null-typed local: TS doesn't otherwise carry the
    // `!overlayElement` narrowing above into the nested `handleTabKey`
    // function declaration below.
    const overlay: HTMLDivElement = overlayElement

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    const initialFocusTarget = getFocusableElements(overlay)[0] ?? overlay
    initialFocusTarget.focus()

    const siblings = overlay.parentElement
      ? Array.from(overlay.parentElement.children).filter(
          (child): child is HTMLElement =>
            child !== overlay && child instanceof HTMLElement,
        )
      : []
    for (const sibling of siblings) {
      sibling.setAttribute('inert', '')
      sibling.setAttribute('aria-hidden', 'true')
    }

    function handleTabKey(event: KeyboardEvent) {
      if (event.key !== 'Tab') return
      const focusable = getFocusableElements(overlay)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const isOutsideTrap = !overlay.contains(document.activeElement)
      if (event.shiftKey) {
        if (isOutsideTrap || document.activeElement === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (isOutsideTrap || document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    overlay.addEventListener('keydown', handleTabKey)

    return () => {
      overlay.removeEventListener('keydown', handleTabKey)
      for (const sibling of siblings) {
        sibling.removeAttribute('inert')
        sibling.removeAttribute('aria-hidden')
      }
      const previouslyFocused = previouslyFocusedRef.current
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [open])

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      data-open={open}
      role="dialog"
      aria-modal="true"
      aria-label="Design in 3D"
      aria-hidden={!open}
      // Fallback focus target (issue #93) for the unlikely case the
      // dialog has no focusable descendant at all — never part of the Tab
      // sequence itself, see `FOCUSABLE_SELECTOR`'s doc comment.
      tabIndex={-1}
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

      {/*
       * Each step panel's `data-visible` is gated on `open` too, not
       * just `step === N` — CSS `visibility` is overridable by a
       * descendant (unlike `display`), so a step panel left
       * `visibility: visible` would otherwise keep rendering (and
       * visually bleeding through onto whatever's behind the overlay,
       * e.g. `App.tsx`'s charts) even after `.overlay` itself goes
       * `visibility: hidden` on close — found while manually verifying
       * issue #61's Apply flow, where step 4 stayed the active step
       * after Apply closed the overlay. See `SceneEditorFlow.module.css`'s
       * comment on why `visibility` (not `display: none`) is used here
       * in the first place.
       */}
      <div className={styles.stepsWrapper}>
        {visitedSteps.has(1) && (
          <div
            className={styles.stepPanel}
            data-visible={open && step === 1}
            aria-hidden={!open || step !== 1}
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
            data-visible={open && step === 2}
            aria-hidden={!open || step !== 2}
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
            data-visible={open && step === 3}
            aria-hidden={!open || step !== 3}
          >
            <Scene3DView
              shapes={scene3DShapes}
              defaultPanel={defaultPanel}
              onPanelLayoutChange={setPanelLayouts}
              obstructions={obstructions}
              onObstructionsChange={setObstructions}
              location={location}
              className={styles.scene3D}
            />
          </div>
        )}

        {visitedSteps.has(4) && (
          <div
            className={styles.stepPanel}
            data-visible={open && step === 4}
            aria-hidden={!open || step !== 4}
          >
            <div className={styles.applyStep}>
              <h2 className={styles.applyTitle}>Apply</h2>
              <p className={styles.applyBody}>
                {tracedShapes.length} shape
                {tracedShapes.length === 1 ? '' : 's'} traced, {totalPanelCount}{' '}
                panel
                {totalPanelCount === 1 ? '' : 's'} laid out,{' '}
                {obstructions.length} obstruction
                {obstructions.length === 1 ? '' : 's'} placed. Applying will
                replace the manual single-array configuration with this scene.
              </p>

              <div className={styles.applyField}>
                <label
                  htmlFor="scene-apply-system-losses"
                  className={styles.applyFieldLabel}
                >
                  System losses (%)
                </label>
                <input
                  id="scene-apply-system-losses"
                  type="number"
                  inputMode="decimal"
                  className={styles.applyFieldInput}
                  value={systemLossesInput}
                  onChange={(event) => setSystemLossesInput(event.target.value)}
                  aria-invalid={systemLossesError ? true : undefined}
                  aria-describedby={
                    systemLossesError
                      ? 'scene-apply-system-losses-error'
                      : undefined
                  }
                />
                {systemLossesError ? (
                  <p
                    id="scene-apply-system-losses-error"
                    role="alert"
                    className={styles.applyFieldError}
                  >
                    {systemLossesError}
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                className={styles.applyButton}
                onClick={handleApply}
                disabled={applyDisabled}
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
