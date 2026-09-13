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
   * Content describing a failed simulation run (e.g. "Couldn't reach the
   * climate API — Retry"), or `undefined`/`null` when there is no error.
   * Rendered above the active tab's existing content when there is any
   * (so a last successful result stays visible alongside the error), or
   * in place of the loading/content panel when there isn't — see
   * {@link MainArea} for the exact priority order. The caller owns retry
   * affordances; the shell only decides *when* to show this slot, not
   * what it contains.
   */
  error?: ReactNode
  /**
   * Called when the user clicks "Update", with the mode and active tab
   * selected at the time of the click — needed because TMY vs Live
   * selects an entirely different data source (climate normals vs
   * forecast), so the parent can't dispatch the right fetch without
   * knowing which one was showing. Wire this to the real simulation
   * trigger once `simulation` is integrated.
   */
  onUpdate?: (context: { mode: Mode; activeTab: TabId }) => void
  /** Disables the Update button (e.g. while sibling form inputs are invalid). */
  updateDisabled?: boolean
  /** Location picker placeholder slot — see {@link Sidebar}. */
  locationSlot?: ReactNode
  /** System config form placeholder slot — see {@link Sidebar}. */
  systemConfigSlot?: ReactNode
  /** Per-tab content — see {@link MainArea}. */
  tabContent?: Partial<Record<TabId, ReactNode>>
  /** Initial mode when `mode` is not supplied (uncontrolled). Defaults to 'tmy'. */
  defaultMode?: Mode
  /**
   * Current mode, for a parent that wants to observe and/or drive it
   * directly (e.g. for URL persistence). Omit to let `AppShell` manage
   * mode internally (starting from `defaultMode`) — this is the default
   * and requires no other props. Passing `mode` without `onModeChange`
   * makes the toggle inert, same as any other controlled React input.
   */
  mode?: Mode
  /** Called when the user switches mode. Required to make a controlled `mode` interactive. */
  onModeChange?: (mode: Mode) => void
  /**
   * Current active tab, for a parent that wants to observe and/or drive
   * it directly. Omit to let `AppShell` manage it internally — the
   * default, and independent of whether `mode` is controlled.
   */
  activeTab?: TabId
  /** Called when the user selects a different tab. Required to make a controlled `activeTab` interactive. */
  onTabChange?: (tab: TabId) => void
}

/**
 * Top-level app shell: left sidebar (location/system-config slots, mode
 * toggle, update button) + main chart area (tab nav + content), per
 * layout "A" in the M1 design doc.
 *
 * `hasLocation` drives more than just `MainArea`'s empty state: as of
 * issue #51, the caller is expected to also drive `locationSlot`'s
 * `LocationPicker` hero/compact presentation from the same
 * `!hasLocation` value (see `App.tsx`), so the two stay in sync — the map
 * is large/prominent for exactly as long as `MainArea` would otherwise
 * show its empty state. `AppShell` doesn't enforce this itself (it has no
 * way to reach into an opaque `locationSlot` node), it just documents the
 * expectation for callers.
 *
 * `mode` and `activeTab` are uncontrolled by default (`AppShell` owns the
 * state, seeded from `defaultMode`), but a parent can take over either or
 * both by passing the matching controlled prop pair (`mode`+
 * `onModeChange`, `activeTab`+`onTabChange`) — e.g. to persist them in
 * the URL, or to know which one is active when `onUpdate` fires.
 * `onUpdate` itself always receives the current `{ mode, activeTab }`
 * regardless of which mode (controlled or not) is in use.
 */
export function AppShell({
  hasLocation,
  isLoading = false,
  error,
  onUpdate,
  updateDisabled = false,
  locationSlot,
  systemConfigSlot,
  tabContent,
  defaultMode = 'tmy',
  mode: controlledMode,
  onModeChange,
  activeTab: controlledActiveTab,
  onTabChange,
}: AppShellProps) {
  const [uncontrolledMode, setUncontrolledMode] = useState<Mode>(defaultMode)
  const [uncontrolledActiveTab, setUncontrolledActiveTab] = useState<TabId>(
    TABS_BY_MODE[defaultMode][0],
  )

  const mode = controlledMode ?? uncontrolledMode
  const requestedTab = controlledActiveTab ?? uncontrolledActiveTab

  // Derive the effective tab in render rather than patching it reactively
  // inside handleModeChange: mode can change via routes other than the
  // toggle (e.g. a parent driving the controlled `mode` prop directly for
  // URL persistence, with `activeTab` left uncontrolled), and a handler-only
  // fix never runs for those. Deriving here self-heals for every path.
  const availableTabsForMode = TABS_BY_MODE[mode]
  const activeTab = availableTabsForMode.includes(requestedTab)
    ? requestedTab
    : availableTabsForMode[0]

  function setActiveTab(nextTab: TabId) {
    if (controlledActiveTab === undefined) {
      setUncontrolledActiveTab(nextTab)
    }
    onTabChange?.(nextTab)
  }

  function handleModeChange(nextMode: Mode) {
    if (controlledMode === undefined) {
      setUncontrolledMode(nextMode)
    }
    onModeChange?.(nextMode)

    // Not required for correctness anymore (activeTab is derived in render
    // above, so it self-heals for this and every other route mode can
    // change through), but explicitly resetting here keeps the in-shell
    // toggle's own behavior unchanged: switching modes via the toggle
    // still forgets a tab that's no longer valid rather than "remembering"
    // it for if the user switches back.
    const availableTabs = TABS_BY_MODE[nextMode]
    if (!availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0])
    }
  }

  function handleUpdate() {
    onUpdate?.({ mode, activeTab })
  }

  return (
    <div className={styles.shell}>
      <Sidebar
        locationSlot={locationSlot}
        systemConfigSlot={systemConfigSlot}
        mode={mode}
        onModeChange={handleModeChange}
        onUpdate={handleUpdate}
        updateDisabled={updateDisabled}
      />
      <MainArea
        mode={mode}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        hasLocation={hasLocation}
        isLoading={isLoading}
        error={error}
        tabContent={tabContent}
      />
    </div>
  )
}
