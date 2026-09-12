import { useRef, useState } from 'react'
import {
  AppShell,
  DailyChart,
  ForecastChart,
  Heatmap,
  LocationPicker,
  MonthlyChartTab,
  SystemConfigForm,
  type Mode,
  type ResolvedLocation,
  type SystemConfig as UiSystemConfig,
  type TabId,
} from './ui'
import {
  runLiveSimulation,
  runTmySimulation,
  type LiveSimulationResult,
  type TmySimulationResult,
} from './simulation'

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
  // actively misleading. See PR #43 review finding #1.
  function clearStaleResults() {
    setResults(EMPTY_RESULTS)
  }

  function handleUpdate({ mode }: { mode: Mode; activeTab: TabId }) {
    if (!location || !systemConfig || !isSystemConfigValid) {
      return
    }

    setIsLoading(true)
    const requestId = ++latestRequestId.current

    const run =
      mode === 'tmy'
        ? runTmySimulation({ location, systemConfig })
        : runLiveSimulation({ location, systemConfig })

    // Error-state UI is out of scope for this issue (see #18) — an
    // unhandled rejection is an acceptable, if rough, failure mode for
    // now. `isLoading` is still reset on failure so the shell doesn't get
    // stuck in a permanent loading state.
    run
      .then((result) => {
        if (requestId !== latestRequestId.current) return
        setResults((prev) => ({ ...prev, [result.mode]: result }))
      })
      .finally(() => {
        if (requestId !== latestRequestId.current) return
        setIsLoading(false)
      })
  }

  return (
    <AppShell
      hasLocation={location !== undefined}
      isLoading={isLoading}
      onUpdate={handleUpdate}
      updateDisabled={!location || !isSystemConfigValid}
      locationSlot={
        <LocationPicker
          onLocationChange={(loc) => {
            setLocation(loc)
            clearStaleResults()
          }}
        />
      }
      systemConfigSlot={
        <SystemConfigForm
          onChange={(config, isValid) => {
            setSystemConfig(config)
            setIsSystemConfigValid(isValid)
            clearStaleResults()
          }}
        />
      }
      tabContent={{
        daily: <DailyChart result={results.tmy} />,
        monthly: <MonthlyChartTab result={results.tmy} />,
        heatmap: <Heatmap result={results.tmy} />,
        forecast: <ForecastChart result={results.live} />,
      }}
    />
  )
}

export default App
