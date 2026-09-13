import styles from './EmptyState.module.css'

/**
 * Shown in the main area before a location has been chosen. Purely
 * presentational — the location itself is set via the sidebar's location
 * picker slot.
 *
 * As of issue #51, `LocationPicker` renders "hero"-sized while there's no
 * location (see `App.tsx`'s `isHero` prop and
 * `LocationPicker.module.css`), which on desktop visually covers this
 * exact panel via `position: fixed` — so this component's own copy is no
 * longer the primary "what do I do now" instruction (the big map + search
 * box overlaid on it is). It's kept short rather than removed entirely
 * because on narrow viewports the hero map lives in the sidebar accordion
 * above this panel, not on top of it, so this panel is still visible
 * there; it deliberately doesn't repeat the "search or click the map"
 * hint the hero map's own search box already gives.
 */
export function EmptyState() {
  return (
    <div className={styles.empty}>
      <span className={styles.icon} aria-hidden="true">
        📍
      </span>
      <p className={styles.title}>No location selected yet</p>
    </div>
  )
}
