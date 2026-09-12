import { useRef, type KeyboardEvent } from 'react'
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

/**
 * Tab navigation bar. Visibility of which tabs exist is decided by the
 * caller (mode-dependent).
 *
 * Implements the WAI-ARIA "tabs" keyboard pattern with automatic
 * activation: only the active tab is a tab stop (roving `tabIndex`),
 * and Left/Right/Home/End move focus *and* select, matching the
 * behavior of e.g. native OS tab strips.
 */
export function TabNav({ tabs, activeTab, onTabChange }: TabNavProps) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  function focusAndSelect(index: number) {
    const tab = tabs[index]
    onTabChange(tab)
    buttonRefs.current[index]?.focus()
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        focusAndSelect((index + 1) % tabs.length)
        break
      case 'ArrowLeft':
        event.preventDefault()
        focusAndSelect((index - 1 + tabs.length) % tabs.length)
        break
      case 'Home':
        event.preventDefault()
        focusAndSelect(0)
        break
      case 'End':
        event.preventDefault()
        focusAndSelect(tabs.length - 1)
        break
    }
  }

  return (
    <div className={styles.tabs} role="tablist">
      {tabs.map((tab, index) => (
        <button
          key={tab}
          ref={(el) => {
            buttonRefs.current[index] = el
          }}
          type="button"
          role="tab"
          id={`tab-${tab}`}
          aria-selected={tab === activeTab}
          aria-controls={`tabpanel-${tab}`}
          tabIndex={tab === activeTab ? 0 : -1}
          className={
            tab === activeTab ? `${styles.tab} ${styles.tabActive}` : styles.tab
          }
          onClick={() => onTabChange(tab)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {TAB_LABELS[tab]}
        </button>
      ))}
    </div>
  )
}
