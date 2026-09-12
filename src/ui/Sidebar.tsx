import { useState, type ReactNode } from 'react'
import type { Mode } from './types'
import { ModeToggle } from './ModeToggle'
import { UpdateButton } from './UpdateButton'
import styles from './Sidebar.module.css'

export interface SidebarProps {
  /**
   * Placeholder slot for the location picker (built in a sibling issue:
   * search box + MapLibre map with draggable pin). Rendered as-is when
   * provided; falls back to a labeled placeholder box otherwise.
   */
  locationSlot?: ReactNode
  /**
   * Placeholder slot for the system config form (built in a sibling
   * issue: panel preset dropdown + tilt/azimuth/capacity/efficiency/
   * temp-coefficient/losses/shading fields). Rendered as-is when
   * provided; falls back to a labeled placeholder box otherwise.
   */
  systemConfigSlot?: ReactNode
  /** Current TMY/Live mode. */
  mode: Mode
  /** Called when the user switches mode. */
  onModeChange: (mode: Mode) => void
  /**
   * Called when the user clicks "Update" to explicitly trigger a
   * simulation run.
   */
  onUpdate: () => void
  /** Disables the Update button, e.g. pending sibling form validation. */
  updateDisabled?: boolean
  /** Initial expanded state (mainly for tests/storybook-style usage). */
  defaultExpanded?: boolean
}

/**
 * Left sidebar container. Collapses to a top accordion on narrow
 * viewports (CSS-driven layout, toggled below 768px) and additionally
 * exposes an always-available collapse toggle so the behavior is
 * testable and usable at any width.
 */
export function Sidebar({
  locationSlot,
  systemConfigSlot,
  mode,
  onModeChange,
  onUpdate,
  updateDisabled = false,
  defaultExpanded = true,
}: SidebarProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <aside className={styles.sidebar} aria-label="Configuration">
      <div className={styles.header}>
        <h1 className={styles.brand}>Solarly</h1>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls="sidebar-content"
          onClick={() => setExpanded((prev) => !prev)}
        >
          Settings
          <span
            className={
              expanded
                ? `${styles.chevron} ${styles.chevronExpanded}`
                : styles.chevron
            }
            aria-hidden="true"
          >
            &#9662;
          </span>
        </button>
      </div>

      <div
        id="sidebar-content"
        className={
          expanded
            ? styles.content
            : `${styles.content} ${styles.contentCollapsed}`
        }
        hidden={!expanded}
      >
        <section className={styles.section} aria-label="Location">
          <h2 className={styles.sectionTitle}>Location</h2>
          {locationSlot ?? (
            <div className={styles.slotPlaceholder}>
              Location picker placeholder (search box + map — built in a sibling
              issue)
            </div>
          )}
        </section>

        <section className={styles.section} aria-label="System configuration">
          <h2 className={styles.sectionTitle}>System configuration</h2>
          {systemConfigSlot ?? (
            <div className={styles.slotPlaceholder}>
              System config form placeholder (panel preset + tilt/azimuth/
              capacity/efficiency/losses — built in a sibling issue)
            </div>
          )}
        </section>

        <section className={styles.section} aria-label="Mode">
          <h2 className={styles.sectionTitle}>Mode</h2>
          <ModeToggle mode={mode} onChange={onModeChange} />
        </section>

        <UpdateButton onClick={onUpdate} disabled={updateDisabled} />
      </div>
    </aside>
  )
}
