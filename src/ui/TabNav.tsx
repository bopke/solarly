import { TAB_LABELS, type TabId } from './types'
import styles from './TabNav.module.css'

export interface TabNavProps {
  /** Tabs to show, in order — already filtered for the active mode by the caller. */
  tabs: TabId[]
  /** Currently active tab. */
  activeTab: TabId
  /** Called when the user selects a different tab. */
  onTabChange: (tab: TabId) => void
}

/** Tab navigation bar. Visibility of which tabs exist is decided by the caller (mode-dependent). */
export function TabNav({ tabs, activeTab, onTabChange }: TabNavProps) {
  return (
    <div className={styles.tabs} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={`tab-${tab}`}
          aria-selected={tab === activeTab}
          aria-controls={`tabpanel-${tab}`}
          className={
            tab === activeTab ? `${styles.tab} ${styles.tabActive}` : styles.tab
          }
          onClick={() => onTabChange(tab)}
        >
          {TAB_LABELS[tab]}
        </button>
      ))}
    </div>
  )
}
