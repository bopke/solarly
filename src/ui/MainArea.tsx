import type { ReactNode } from 'react'
import { TABS_BY_MODE, TAB_LABELS, type Mode, type TabId } from './types'
import { TabNav } from './TabNav'
import { EmptyState } from './EmptyState'
import { LoadingSkeleton } from './LoadingSkeleton'
import styles from './MainArea.module.css'

export interface MainAreaProps {
  /** Current TMY/Live mode — determines which tabs are visible. */
  mode: Mode
  /** Currently active tab. Must be one of `TABS_BY_MODE[mode]`. */
  activeTab: TabId
  /** Called when the user selects a different tab. */
  onTabChange: (tab: TabId) => void
  /** Whether a location has been chosen; drives the empty state. */
  hasLocation: boolean
  /** Whether a simulation run is in flight; drives the loading state. */
  isLoading: boolean
  /**
   * Content for each tab, keyed by tab id. Populated by sibling chart-tab
   * issues (Daily/Monthly/Heatmap/Forecast). Only the entry for the
   * active tab is used at any given time; a tab with no entry falls back
   * to a labeled placeholder. Not consulted while `hasLocation` is false
   * or `isLoading` is true — the empty/loading state takes over instead.
   */
  tabContent?: Partial<Record<TabId, ReactNode>>
}

/**
 * Main chart area: tab navigation plus a single content panel below it
 * whose contents depend on state, in priority order:
 * 1. no location set → {@link EmptyState}
 * 2. a run is in flight → {@link LoadingSkeleton}
 * 3. otherwise → the active tab's content (or a placeholder)
 */
export function MainArea({
  mode,
  activeTab,
  onTabChange,
  hasLocation,
  isLoading,
  tabContent,
}: MainAreaProps) {
  const tabs = TABS_BY_MODE[mode]

  let panel: ReactNode
  if (!hasLocation) {
    panel = <EmptyState />
  } else if (isLoading) {
    panel = <LoadingSkeleton />
  } else {
    panel = tabContent?.[activeTab] ?? (
      <div className={styles.placeholder}>
        {TAB_LABELS[activeTab]} tab placeholder — content built in a sibling
        issue.
      </div>
    )
  }

  return (
    <main className={styles.main}>
      <TabNav tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
      <div
        className={styles.panel}
        role="tabpanel"
        id={`tabpanel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
      >
        {panel}
      </div>
    </main>
  )
}
