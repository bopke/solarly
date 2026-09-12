import styles from './EmptyState.module.css'

/**
 * Shown in the main area before a location has been chosen. Purely
 * presentational — the location itself is set via the sidebar's location
 * picker slot (a sibling issue).
 */
export function EmptyState() {
  return (
    <div className={styles.empty}>
      <span className={styles.icon} aria-hidden="true">
        📍
      </span>
      <p className={styles.title}>No location selected</p>
      <p className={styles.hint}>
        Search for an address or click the map to get started.
      </p>
    </div>
  )
}
