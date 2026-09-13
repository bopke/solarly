import type { ReactNode } from 'react'
import { TABS_BY_MODE, TAB_LABELS, type Mode, type TabId } from './types'
import { TabNav } from './TabNav'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
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
  /** Whether a simulation run is in flight; drives the loading state. Defaults to `false`. */
  isLoading?: boolean
  /**
   * Content describing a failed simulation run (bad geocode, upstream API
   * error, offline, ...), or `undefined`/`null` when there is no error.
   * See the priority order below — an error only actually renders once a
   * location is set. When the active tab already has content to show
   * (e.g. the last successful result), the error renders as a compact
   * banner *above* that content rather than replacing it — the M1 spec
   * requires the last successful result to stay visible while a
   * subsequent run's failure is reported. Only when there's nothing to
   * show underneath (no prior result for this tab yet) does the error
   * take over the whole panel. `isLoading` and `error` are expected to be
   * mutually exclusive in practice (a run that failed is no longer "in
   * flight"), but if a caller does pass both, `error` wins.
   */
  error?: ReactNode
  /**
   * Content for each tab, keyed by tab id. Populated by sibling chart-tab
   * issues (Daily/Monthly/Heatmap/Forecast). Only the entry for the
   * active tab is used at any given time; a tab with no entry falls back
   * to a labeled placeholder. Not consulted while `hasLocation` is
   * false. When `error` is set, this is still rendered (alongside the
   * error banner) if present — see `error` above. `isLoading` only takes
   * over the panel when there is no `error`.
   */
  tabContent?: Partial<Record<TabId, ReactNode>>
}

/**
 * Main chart area: tab navigation plus a single content panel below it
 * whose contents depend on state, in priority order:
 * 1. no location set → {@link EmptyState}
 * 2. `error` is set and the active tab has no content yet → full-panel
 *    {@link ErrorState}
 * 3. `error` is set and the active tab has content → a compact
 *    {@link ErrorState} banner above that content (both visible at once,
 *    per the "last successful result stays visible" requirement)
 * 4. no error, but a run is in flight → {@link LoadingSkeleton}
 * 5. otherwise → the active tab's content (or a placeholder)
 */
export function MainArea({
  mode,
  activeTab,
  onTabChange,
  hasLocation,
  isLoading = false,
  error,
  tabContent,
}: MainAreaProps) {
  const tabs = TABS_BY_MODE[mode]
  const content = tabContent?.[activeTab]

  let panel: ReactNode
  if (!hasLocation) {
    panel = <EmptyState />
  } else if (error && content === undefined) {
    panel = <ErrorState>{error}</ErrorState>
  } else if (error) {
    panel = (
      <>
        <ErrorState inline>{error}</ErrorState>
        {content}
      </>
    )
  } else if (isLoading) {
    panel = <LoadingSkeleton />
  } else {
    panel = content ?? (
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
        tabIndex={0}
      >
        {panel}
      </div>
    </main>
  )
}
