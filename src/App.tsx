import { useState } from 'react'
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
  type SimulationResult,
} from './simulation'

function App() {
  const [location, setLocation] = useState<ResolvedLocation | undefined>(
    undefined,
  )
  const [systemConfig, setSystemConfig] = useState<UiSystemConfig | undefined>(
    undefined,
  )
  const [isSystemConfigValid, setIsSystemConfigValid] = useState(false)
  const [simulationResult, setSimulationResult] = useState<
    SimulationResult | undefined
  >(undefined)
  const [isLoading, setIsLoading] = useState(false)

  function handleUpdate({ mode }: { mode: Mode; activeTab: TabId }) {
    if (!location || !systemConfig || !isSystemConfigValid) {
      return
    }

    setIsLoading(true)

    const run =
      mode === 'tmy'
        ? runTmySimulation({ location, systemConfig })
        : runLiveSimulation({ location, systemConfig })

    // Error-state UI is out of scope for this issue (see #18) — an
    // unhandled rejection is an acceptable, if rough, failure mode for
    // now. `isLoading` is still reset on failure so the shell doesn't get
    // stuck in a permanent loading state.
    run
      .then((result) => setSimulationResult(result))
      .finally(() => setIsLoading(false))
  }

  const tmyResult =
    simulationResult?.mode === 'tmy' ? simulationResult : undefined
  const liveResult =
    simulationResult?.mode === 'live' ? simulationResult : undefined

  return (
    <AppShell
      hasLocation={location !== undefined}
      isLoading={isLoading}
      onUpdate={handleUpdate}
      updateDisabled={!location || !isSystemConfigValid}
      locationSlot={<LocationPicker onLocationChange={setLocation} />}
      systemConfigSlot={
        <SystemConfigForm
          onChange={(config, isValid) => {
            setSystemConfig(config)
            setIsSystemConfigValid(isValid)
          }}
        />
      }
      tabContent={{
        daily: <DailyChart result={tmyResult} />,
        monthly: <MonthlyChartTab result={tmyResult} />,
        heatmap: <Heatmap result={tmyResult} />,
        forecast: <ForecastChart result={liveResult} />,
      }}
    />
  )
}

export default App
