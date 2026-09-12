import { useState } from 'react'
import { AppShell, DailyChart } from './ui'
import type { SimulationResult } from './simulation'

function App() {
  // Real location state arrives with the location-picker issue; a local
  // placeholder is enough for the shell to demonstrate its empty state.
  const [hasLocation] = useState(false)
  // Real simulation results arrive once the location picker (#12), system
  // config form (#13), and an update-trigger wire-up land and call
  // `runTmySimulation` here. Until then this stays `undefined`, so
  // `DailyChart` renders via its own empty-state (its slot is only ever
  // consulted once `hasLocation` is true anyway — see `MainArea`'s panel
  // priority order).
  const [simulationResult] = useState<SimulationResult | undefined>(undefined)

  return (
    <AppShell
      hasLocation={hasLocation}
      tabContent={{ daily: <DailyChart result={simulationResult} /> }}
    />
  )
}

export default App
