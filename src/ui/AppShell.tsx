import { useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { MainArea } from './MainArea'
import { TABS_BY_MODE, type Mode, type TabId } from './types'
import styles from './AppShell.module.css'

export interface AppShellProps {
  /** Whether a location has been chosen; drives the main area's empty state. */
  hasLocation: boolean
  /** Whether a simulation run is in flight; drives the main area's loading state. */
  isLoading?: boolean
  /**
   * Called when the user clicks "Update". Wire this to the real
   * simulation trigger once `simulation` is integrated; defaults to a
   * console.log no-op.
   */
  onUpdate?: () => void
  /** Disables the Update button (e.g. while sibling form inputs are invalid). */
  updateDisabled?: boolean
  /** Location picker placeholder slot — see {@link Sidebar}. */
  locationSlot?: ReactNode
  /** System config form placeholder slot — see {@link Sidebar}. */
  systemConfigSlot?: ReactNode
  /** Per-tab content — see {@link MainArea}. */
  tabContent?: Partial<Record<TabId, ReactNode>>
  /** Initial mode; uncontrolled thereafter. Defaults to 'tmy'. */
  defaultMode?: Mode
}

/**
 * Top-level app shell: left sidebar (location/system-config slots, mode
 * toggle, update button) + main chart area (tab nav + content), per
 * layout "A" in the M1 design doc. Owns `mode` and `activeTab` state;
 * everything else is either a prop or a sibling-issue slot.
 */
export function AppShell({
  hasLocation,
  isLoading = false,
  onUpdate = () =>
    console.log('Update clicked (no-op — simulation trigger not wired up yet)'),
  updateDisabled = false,
  locationSlot,
  systemConfigSlot,
  tabContent,
  defaultMode = 'tmy',
}: AppShellProps) {
  const [mode, setMode] = useState<Mode>(defaultMode)
  const [activeTab, setActiveTab] = useState<TabId>(
    TABS_BY_MODE[defaultMode][0],
  )

  function handleModeChange(nextMode: Mode) {
    setMode(nextMode)
    // Keep activeTab valid: reset to the first tab available in the new mode
    // whenever the current tab wouldn't be visible there.
    const availableTabs = TABS_BY_MODE[nextMode]
    if (!availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0])
    }
  }

  return (
    <div className={styles.shell}>
      <Sidebar
        locationSlot={locationSlot}
        systemConfigSlot={systemConfigSlot}
        mode={mode}
        onModeChange={handleModeChange}
        onUpdate={onUpdate}
        updateDisabled={updateDisabled}
      />
      <MainArea
        mode={mode}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        hasLocation={hasLocation}
        isLoading={isLoading}
        tabContent={tabContent}
      />
    </div>
  )
}
