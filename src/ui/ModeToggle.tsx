import type { Mode } from './types'
import styles from './ModeToggle.module.css'

export interface ModeToggleProps {
  /** Currently selected mode. */
  mode: Mode
  /** Called with the newly selected mode when the user picks one. */
  onChange: (mode: Mode) => void
}

const OPTIONS: { id: Mode; label: string }[] = [
  { id: 'tmy', label: 'TMY' },
  { id: 'live', label: 'Live' },
]

/** TMY vs Live mode switch, shown in the sidebar. */
export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className={styles.toggle} role="radiogroup" aria-label="Mode">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={mode === option.id}
          className={
            mode === option.id
              ? `${styles.option} ${styles.optionActive}`
              : styles.option
          }
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
