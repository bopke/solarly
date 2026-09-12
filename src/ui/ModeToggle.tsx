import { useRef, type KeyboardEvent } from 'react'
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

/**
 * TMY vs Live mode switch, shown in the sidebar.
 *
 * Implements the WAI-ARIA "radio group" keyboard pattern: only the
 * checked option is a tab stop (roving `tabIndex`), and Left/Right/
 * Up/Down move focus and change the selection.
 */
export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  function selectAndFocus(index: number) {
    const option = OPTIONS[index]
    onChange(option.id)
    buttonRefs.current[index]?.focus()
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        selectAndFocus((index + 1) % OPTIONS.length)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        selectAndFocus((index - 1 + OPTIONS.length) % OPTIONS.length)
        break
    }
  }

  return (
    <div className={styles.toggle} role="radiogroup" aria-label="Mode">
      {OPTIONS.map((option, index) => (
        <button
          key={option.id}
          ref={(el) => {
            buttonRefs.current[index] = el
          }}
          type="button"
          role="radio"
          aria-checked={mode === option.id}
          tabIndex={mode === option.id ? 0 : -1}
          className={
            mode === option.id
              ? `${styles.option} ${styles.optionActive}`
              : styles.option
          }
          onClick={() => onChange(option.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
