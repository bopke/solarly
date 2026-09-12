import styles from './LoadingSkeleton.module.css'

export interface LoadingSkeletonProps {
  /** Text shown under the spinner. */
  label?: string
}

/**
 * Reusable loading indicator for the chart area, shown while a simulation
 * run is in flight. Intended to be reused as-is by the sibling chart-tab
 * issues (Daily/Monthly/Heatmap/Forecast) — no need to build their own.
 */
export function LoadingSkeleton({ label = 'Loading…' }: LoadingSkeletonProps) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <div className={styles.spinner} aria-hidden="true" />
      <p className={styles.label}>{label}</p>
    </div>
  )
}
