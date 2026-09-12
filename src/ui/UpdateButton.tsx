import styles from './UpdateButton.module.css'

export interface UpdateButtonProps {
  /**
   * Called when the user explicitly triggers a simulation run. Wired to a
   * no-op/console.log by the app shell for now — the real simulation
   * trigger is added once the `simulation` module is wired in.
   */
  onClick: () => void
  /** Disable the button, e.g. while a run is already in flight or inputs are invalid. */
  disabled?: boolean
  /** Override the default label (rarely needed). */
  label?: string
}

/**
 * Explicit "Update" trigger. Inputs elsewhere in the sidebar are debounced
 * but the simulation itself only re-runs when this button is clicked, per
 * the M1 design doc's data-flow note.
 */
export function UpdateButton({
  onClick,
  disabled = false,
  label = 'Update',
}: UpdateButtonProps) {
  return (
    <button
      type="button"
      className={styles.button}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  )
}
