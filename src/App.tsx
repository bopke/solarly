import { useRef, useState } from 'react'
import {
  AppShell,
  DailyChart,
  ForecastChart,
  Heatmap,
  LocationPicker,
  MonthlyChartTab,
  SimulationErrorBanner,
  SystemConfigForm,
  type Mode,
  type ResolvedLocation,
  type SystemConfig as UiSystemConfig,
} from './ui'
import {
  runLiveSimulation,
  runTmySimulation,
  type LiveSimulationResult,
  type SystemConfig,
  type TmySimulationResult,
} from './simulation'
import { NasaPowerNoDataError } from './data-sources'
import { SceneEditorFlow, type SceneDesignState } from './scene/flow'
import styles from './App.module.css'

/**
 * Adapts `SystemConfigForm`'s single-array UI config into the simulation
 * module's multi-array `SystemConfig` shape (issue #54) — a single-element
 * `arrays` array, which sums to the same output as the old flat shape (see
 * the M2 design spec's "Data flow and the multi-array model" section).
 * `presetId` is UI-only and intentionally dropped here.
 */
function toSimulationSystemConfig(config: UiSystemConfig): SystemConfig {
  return {
    arrays: [
      {
        tiltDeg: config.tiltDeg,
        azimuthDeg: config.azimuthDeg,
        panelCount: config.panelCount,
        wattsPerPanel: config.wattsPerPanel,
        efficiencyPercent: config.efficiencyPercent,
        tempCoefficientPercentPerC: config.tempCoefficientPercentPerC,
        manualShadingPercent: config.manualShadingPercent,
      },
    ],
    systemLossesPercent: config.systemLossesPercent,
  }
}

/**
 * The two simulation modes' results, kept independently rather than in a
 * single `SimulationResult | undefined` slot, so switching mode (TMY <->
 * Live) doesn't discard an already-computed result for the other mode —
 * see PR #43 review finding #6. Either or both can be `undefined` (no run
 * for that mode yet, or invalidated by an input change — see
 * `clearStaleResults`).
 */
interface SimulationResults {
  tmy: TmySimulationResult | undefined
  live: LiveSimulationResult | undefined
}

const EMPTY_RESULTS: SimulationResults = { tmy: undefined, live: undefined }

/**
 * A failed `handleUpdate` run, remembered per-mode so switching tabs/mode
 * doesn't surface a stale error for whichever mode isn't currently being
 * looked at (see `App`'s render below, which only ever renders the entry
 * for the currently-active `mode`).
 *
 * `retryable` distinguishes the two failure scenarios from issue #18:
 * - `true` — a generic climate API failure or rate limit
 *   (`NasaPowerRequestError`, an Open-Meteo request failure, etc.). The
 *   same inputs might well succeed on a second attempt, so a "Retry"
 *   button is offered.
 * - `false` — `NasaPowerNoDataError`: the location simply has no usable
 *   NASA POWER coverage (e.g. open ocean). Retrying with the same inputs
 *   will fail identically every time, so no retry action is offered —
 *   only the informational message.
 */
interface SimulationError {
  mode: Mode
  message: string
  retryable: boolean
}

const GENERIC_FAILURE_MESSAGE =
  "Couldn't reach the climate service. Please try again."
const NO_COVERAGE_MESSAGE = 'No climate data available for this location.'

function describeSimulationError(error: unknown): {
  message: string
  retryable: boolean
} {
  if (error instanceof NasaPowerNoDataError) {
    return { message: NO_COVERAGE_MESSAGE, retryable: false }
  }
  return { message: GENERIC_FAILURE_MESSAGE, retryable: true }
}

function App() {
  const [location, setLocation] = useState<ResolvedLocation | undefined>(
    undefined,
  )
  const [systemConfig, setSystemConfig] = useState<UiSystemConfig | undefined>(
    undefined,
  )
  const [isSystemConfigValid, setIsSystemConfigValid] = useState(false)
  const [results, setResults] = useState<SimulationResults>(EMPTY_RESULTS)
  const [isLoading, setIsLoading] = useState(false)
  const [simulationError, setSimulationError] = useState<
    SimulationError | undefined
  >(undefined)

  // Controlled here (rather than left uncontrolled inside AppShell) so
  // `simulationError` can be filtered against the mode currently being
  // looked at — see `SimulationError`'s doc comment. AppShell's `mode`/
  // `onModeChange` controlled-prop pair exists for exactly this: a parent
  // that needs to observe mode continuously, not just at the moment
  // `onUpdate` fires.
  const [mode, setMode] = useState<Mode>('tmy')

  // The M2 "Design in 3D" scene editor overlay (issue #60). `isSceneOpen`
  // only controls whether the overlay is *visible* — `SceneEditorFlow`
  // stays mounted regardless (see its own doc comment), so closing it and
  // reopening via "Edit scene" never loses traced shapes, per-shape
  // config, or placed obstructions from an earlier session. `sceneState`
  // mirrors the overlay's aggregated state (via `onStateChange`) purely so
  // the sidebar can render a compact summary/button label without
  // reaching into the overlay component itself; it is not fed back into
  // `SceneEditorFlow` as a prop.
  const [isSceneOpen, setIsSceneOpen] = useState(false)
  const [sceneState, setSceneState] = useState<SceneDesignState | undefined>(
    undefined,
  )
  const hasScene = (sceneState?.tracedShapes.length ?? 0) > 0

  // Bumped on every location change to force `SceneEditorFlow` to remount
  // (via the `key` prop below) — see `handleLocationChange`'s doc comment
  // for why.
  const [sceneResetKey, setSceneResetKey] = useState(0)

  // Identifies the most recently started `handleUpdate` run. A response is
  // only applied if its request is still the latest one when it resolves —
  // otherwise a slower, now-stale in-flight request (e.g. Update clicked,
  // inputs changed, Update clicked again before the first resolves) could
  // overwrite a newer result, or clear `isLoading` while a newer run is
  // still pending. See PR #43 review finding #4.
  const latestRequestId = useRef(0)

  // Both mode's results go stale together whenever location or system
  // config changes — neither remaining result describes the new inputs
  // anymore. Clearing (rather than e.g. a stale-data banner) is
  // deliberate: a chart with no cue that it's showing old data is
  // actively misleading. See PR #43 review finding #1. Any pending
  // simulation error is stale for the same reason — it describes a fetch
  // for inputs that no longer apply.
  //
  // Also bumps `latestRequestId`, invalidating any run still in flight
  // from before this change: without this, a `handleUpdate` started
  // against the old inputs would still pass the `requestId !==
  // latestRequestId.current` guard when it eventually settles, so its
  // stale success/error could land on screen attributed to inputs the
  // user never actually ran (see PR #48 review). Clearing `isLoading`
  // too, since the stale run's own `.finally()` is now guarded off and
  // would otherwise never reset it.
  function clearStaleResults() {
    latestRequestId.current += 1
    setResults(EMPTY_RESULTS)
    setSimulationError(undefined)
    setIsLoading(false)
  }

  // A location change already clears both simulation-result slots (see
  // `clearStaleResults`'s doc comment) — but it did NOT touch the 3D
  // scene-design session (`SceneEditorFlow`'s traced shapes/configs/
  // obstructions), so a roof traced over one location's satellite
  // imagery could silently persist and later get "Applied" against a
  // different location once issue #61 lands, producing a wrong-answer
  // bug (PR #70 review finding 3).
  //
  // `SceneEditorFlow` is deliberately never unmounted for the rest of its
  // own lifetime (see its doc comment — that's what lets "Edit scene"
  // preserve state across the overlay being closed and reopened), so
  // there's no prop that would reset its internal state in place. Forcing
  // a full remount via a changing `key` is the simplest way to get a
  // clean step-1 slate here — it's the *same* operation `SceneEditorFlow`
  // otherwise avoids (an intentional exception, not an accident), and is
  // safe specifically because a location change is exactly the case where
  // losing an in-progress scene is *correct*, not a state-preservation
  // bug: the alternative is silently keeping a scene traced against a
  // location that no longer applies. The overlay is also closed and
  // `sceneState` cleared immediately, rather than left to catch up once
  // the remounted instance's own `onStateChange` effect fires, so there's
  // no stale-summary flash in the sidebar.
  function handleLocationChange(loc: ResolvedLocation) {
    setLocation(loc)
    clearStaleResults()
    setIsSceneOpen(false)
    setSceneState(undefined)
    setSceneResetKey((key) => key + 1)
  }

  function handleUpdate(runMode: Mode) {
    if (!location || !systemConfig || !isSystemConfigValid) {
      return
    }

    setIsLoading(true)
    // Clear any previously-shown error for this mode immediately, so a
    // retry shows the loading skeleton rather than leaving the stale error
    // banner up underneath it (MainArea's priority order shows `error`
    // ahead of `isLoading`).
    setSimulationError((prev) => (prev?.mode === runMode ? undefined : prev))
    const requestId = ++latestRequestId.current

    const simulationSystemConfig = toSimulationSystemConfig(systemConfig)
    const run =
      runMode === 'tmy'
        ? runTmySimulation({ location, systemConfig: simulationSystemConfig })
        : runLiveSimulation({
            location,
            systemConfig: simulationSystemConfig,
          })

    run
      .then((result) => {
        if (requestId !== latestRequestId.current) return
        setResults((prev) => ({ ...prev, [result.mode]: result }))
      })
      .catch((error: unknown) => {
        if (requestId !== latestRequestId.current) return
        // Deliberately does NOT touch `results` — a failed run leaves the
        // last successful result (if any) visible, per the M1 spec's
        // error-handling section, rather than clearing the chart.
        setSimulationError({ mode: runMode, ...describeSimulationError(error) })
      })
      .finally(() => {
        if (requestId !== latestRequestId.current) return
        setIsLoading(false)
      })
  }

  // Only ever surface the error for the mode currently being looked at —
  // a TMY failure shouldn't show a banner while the user has switched to
  // the Forecast tab in Live mode (or vice versa).
  const activeSimulationError =
    simulationError?.mode === mode ? simulationError : undefined

  return (
    <>
      <AppShell
        hasLocation={location !== undefined}
        isLoading={isLoading}
        error={
          activeSimulationError && (
            <SimulationErrorBanner
              message={activeSimulationError.message}
              onRetry={
                activeSimulationError.retryable
                  ? () => handleUpdate(mode)
                  : undefined
              }
            />
          )
        }
        onUpdate={({ mode: updateMode }) => handleUpdate(updateMode)}
        updateDisabled={!location || !isSystemConfigValid}
        mode={mode}
        onModeChange={setMode}
        locationSlot={
          <LocationPicker
            isHero={location === undefined}
            onLocationChange={handleLocationChange}
          />
        }
        systemConfigSlot={
          <>
            <SystemConfigForm
              onChange={(config, isValid) => {
                setSystemConfig(config)
                setIsSystemConfigValid(isValid)
                clearStaleResults()
              }}
            />
            <div className={styles.sceneSection}>
              <button
                type="button"
                className={styles.sceneButton}
                disabled={!location}
                onClick={() => setIsSceneOpen(true)}
              >
                {hasScene ? 'Edit scene' : 'Design in 3D'}
              </button>
              {hasScene && (
                <p className={styles.sceneSummary}>
                  {sceneState?.tracedShapes.length} shape
                  {sceneState?.tracedShapes.length === 1 ? '' : 's'} traced
                  {sceneState && sceneState.obstructions.length > 0
                    ? `, ${sceneState.obstructions.length} obstruction${
                        sceneState.obstructions.length === 1 ? '' : 's'
                      }`
                    : ''}
                </p>
              )}
            </div>
          </>
        }
        tabContent={{
          daily: <DailyChart result={results.tmy} />,
          monthly: <MonthlyChartTab result={results.tmy} />,
          heatmap: <Heatmap result={results.tmy} />,
          forecast: <ForecastChart result={results.live} />,
        }}
      />
      {location && (
        <SceneEditorFlow
          key={sceneResetKey}
          open={isSceneOpen}
          location={location}
          onClose={() => setIsSceneOpen(false)}
          onStateChange={setSceneState}
          onApply={() => {
            // Real Apply logic (deriving the multi-array SystemConfig and
            // feeding it into the simulation) is issue #61 — this shell
            // just closes the overlay for now.
            setIsSceneOpen(false)
          }}
        />
      )}
    </>
  )
}

export default App
