import { useState } from 'react'
import { AppShell } from './ui'

function App() {
  // Real location state arrives with the location-picker issue; a local
  // placeholder is enough for the shell to demonstrate its empty state.
  const [hasLocation] = useState(false)

  return <AppShell hasLocation={hasLocation} />
}

export default App
