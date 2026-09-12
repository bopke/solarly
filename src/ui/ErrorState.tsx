import type { ReactNode } from 'react'
import styles from './ErrorState.module.css'

export interface ErrorStateProps {
  /** Error message/content to display — e.g. "Couldn't reach the climate API" plus a retry action. */
  children: ReactNode
}

/**
 * Shown in the main area when a simulation run has failed (e.g. a bad
 * geocode, an upstream API error, or being offline). Purely
 * presentational: the caller owns retry logic and passes it in as
 * `children` (see {@link MainAreaProps.error} / {@link AppShellProps.error}).
 */
export function ErrorState({ children }: ErrorStateProps) {
  return (
    <div className={styles.error} role="alert">
      <span className={styles.icon} aria-hidden="true">
        ⚠️
      </span>
      <div className={styles.message}>{children}</div>
    </div>
  )
}
