import styles from './SimulationErrorBanner.module.css'

export interface SimulationErrorBannerProps {
  /** Human-readable failure description, e.g. "Couldn't reach the climate service." */
  message: string
  /**
   * Called when the user clicks the retry button. Omit this (rather than
   * passing it disabled) for failures a retry can't fix — e.g.
   * {@link NasaPowerNoDataError}'s "no coverage at this location", where
   * retrying with the same inputs will just fail the same way again — so
   * no retry affordance is rendered at all.
   */
  onRetry?: () => void
  /** Overrides the retry button's label. Only used when `onRetry` is set. */
  retryLabel?: string
}

/**
 * Content rendered inside {@link ErrorState} (via `AppShell`'s/`MainArea`'s
 * `error` slot) for a failed simulation run: the failure message plus an
 * optional retry action. Retryable failures (climate API errors, rate
 * limits) get a "Retry" button; non-retryable ones (no NASA POWER coverage
 * for this location) omit it entirely, since retrying with the same inputs
 * can't possibly help.
 */
export function SimulationErrorBanner({
  message,
  onRetry,
  retryLabel = 'Retry',
}: SimulationErrorBannerProps) {
  return (
    <>
      <p className={styles.message}>{message}</p>
      {onRetry && (
        <button type="button" className={styles.retryButton} onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </>
  )
}
