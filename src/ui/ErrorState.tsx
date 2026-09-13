import type { ReactNode } from 'react'
import styles from './ErrorState.module.css'

export interface ErrorStateProps {
  /** Error message/content to display — e.g. "Couldn't reach the climate API" plus a retry action. */
  children: ReactNode
  /**
   * Renders as a compact banner row instead of the default full-panel,
   * vertically-centered layout. Used by {@link MainArea} when there's
   * existing tab content to show underneath the error — e.g. the last
   * successful chart — so the banner sits above it rather than replacing
   * it. Defaults to `false` (the full-panel layout, used when there's
   * nothing to show underneath).
   */
  inline?: boolean
}

/**
 * Shown in the main area when a simulation run has failed (e.g. a bad
 * geocode, an upstream API error, or being offline). Purely
 * presentational: the caller owns retry logic and passes it in as
 * `children` (see {@link MainAreaProps.error} / {@link AppShellProps.error}).
 */
export function ErrorState({ children, inline = false }: ErrorStateProps) {
  return (
    <div className={inline ? styles.errorInline : styles.error} role="alert">
      <span className={styles.icon} aria-hidden="true">
        ⚠️
      </span>
      <div className={styles.message}>{children}</div>
    </div>
  )
}
