import { useEffect, useId, useState, type ReactNode } from 'react'
import { SIDEBAR_BREAKPOINT_QUERY, type Mode } from './types'
import { ModeToggle } from './ModeToggle'
import { UpdateButton } from './UpdateButton'
import styles from './Sidebar.module.css'

/**
 * Tracks whether the given `matchMedia` query currently matches, updating
 * live as the viewport is resized. Used to gate the sidebar's collapsed
 * state on actually being at a width where the accordion toggle exists —
 * see the module doc comment below for why.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    setMatches(mql.matches)

    function handleChange(event: MediaQueryListEvent) {
      setMatches(event.matches)
    }

    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [query])

  return matches
}

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
 *
 * The `expanded` state only ever *hides* content while the accordion
 * toggle that controls it is actually visible (i.e. below the 768px
 * breakpoint) — gated via `useMediaQuery` rather than CSS alone. Without
 * this, collapsing on a narrow viewport and then widening the browser
 * back past the breakpoint would leave `.contentCollapsed`/`hidden`
 * applied with no visible control left to undo it, since the toggle
 * itself is `display: none` at desktop widths.
 *
 * `locationSlot` is expected to render large ("hero") while there's no
 * location yet (see `LocationPicker`'s `isHero` prop, driven by
 * `App.tsx`) — on desktop that's a `position: fixed` overlay that escapes
 * this component's layout entirely, but on narrow viewports it instead
 * just grows tall within its normal position inside `.content` below.
 * `defaultExpanded` already defaults to `true`, so the accordion starts
 * expanded on first load regardless of `hasLocation` — the hero map is
 * visible there without any extra wiring. `Sidebar` doesn't otherwise
 * know or care whether `locationSlot` is in hero or compact mode.
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
  const isNarrow = useMediaQuery(SIDEBAR_BREAKPOINT_QUERY)
  const contentId = useId()

  // Only actually collapsed when both "the user collapsed it" and "we're
  // at a width where that's reversible" are true.
  const collapsed = isNarrow && !expanded

  return (
    <aside className={styles.sidebar} aria-label="Configuration">
      <div className={styles.header}>
        <h1 className={styles.brand}>Solarly</h1>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onClick={() => setExpanded((prev) => !prev)}
        >
          Settings
          <span
            className={
              collapsed
                ? styles.chevron
                : `${styles.chevron} ${styles.chevronExpanded}`
            }
            aria-hidden="true"
          >
            &#9662;
          </span>
        </button>
      </div>

      <div
        id={contentId}
        className={
          collapsed
            ? `${styles.content} ${styles.contentCollapsed}`
            : styles.content
        }
        hidden={collapsed}
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
