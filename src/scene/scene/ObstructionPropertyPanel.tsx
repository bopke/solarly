import { useEffect, useState } from 'react'
import type { Obstruction } from './obstructions'
import {
  MIN_OBSTRUCTION_HEIGHT_M,
  MIN_OBSTRUCTION_RADIUS_M,
} from './obstructions'
import styles from './ObstructionPropertyPanel.module.css'

/**
 * Small plain-React property panel for the currently-selected obstruction
 * (issue #58 / M2 design spec's "adjust its height via a small property
 * panel"). Rendered as an absolutely-positioned overlay *outside* the R3F
 * `<Canvas>` (in `Scene3DView`'s wrapping div) — editing via ordinary
 * number inputs rather than in-3D drag handles, see `Scene3DView.tsx`'s
 * module doc for the reasoning (`OrbitControls`' drag gestures and a
 * "drag an obstruction" gesture would fight over the same pointer
 * events).
 */

export interface ObstructionPropertyPanelProps {
  obstruction: Obstruction
  /**
   * May return `false` to signal the patch was rejected (issue #86 item 1
   * — e.g. a position edit that would land the obstruction under a traced
   * shape's footprint), in which case the field that triggered it reverts
   * its displayed text to the obstruction's actual current value rather
   * than showing text the model never actually accepted. Returning
   * `void`/`true` (or omitting a return entirely) is treated as accepted.
   */
  onChange: (
    patch: Partial<Pick<Obstruction, 'position' | 'heightM' | 'radiusM'>>,
  ) => boolean | void
  onDelete: () => void
  onClose: () => void
}

/**
 * A numeric `<input>` that tracks its own displayed text separately from
 * the committed numeric `value` (issue #86 item 3). A plain controlled
 * `<input type="number" value={value} onChange={...}>` can't represent
 * "the field is momentarily empty while the user is retyping it": clearing
 * it produces `event.target.value === ''`, and `Number('') === 0` is a
 * finite number, so the old code clamped straight to the field's minimum
 * on every single backspace rather than letting the user actually clear
 * and retype. Here, an empty (or otherwise non-finite) string is kept as
 * local display-only state — `onCommit` (and therefore the parent's
 * `value`) is left untouched until a finite number is typed — and only
 * reconciled back to the last committed `value` on blur, so leaving the
 * field empty doesn't silently discard the obstruction's real value.
 */
function NumberField({
  id,
  label,
  value,
  min,
  step,
  onCommit,
}: {
  id: string
  label: string
  value: number
  min?: number
  step: number
  onCommit: (next: number) => boolean | void
}) {
  const [raw, setRaw] = useState(String(value))

  // Keep the displayed text in sync with an externally-changed committed
  // value (e.g. another field's edit replacing the whole obstruction, or a
  // rejected update reverting this one) — but only while the user isn't
  // mid-edit of *this* field; syncing unconditionally would stomp on an
  // in-progress (possibly momentarily empty) edit on every parent render.
  useEffect(() => {
    setRaw(String(value))
  }, [value])

  return (
    <label className={styles.field} htmlFor={id}>
      {label}
      <input
        id={id}
        type="number"
        min={min}
        step={step}
        value={raw}
        onChange={(event) => {
          const next = event.target.value
          setRaw(next)
          if (next === '') return
          const parsed = Number(next)
          if (Number.isFinite(parsed)) {
            const accepted = onCommit(
              min !== undefined ? Math.max(parsed, min) : parsed,
            )
            // `onCommit` may reject the patch (issue #86 item 1) — revert
            // the displayed text to the obstruction's real, unchanged
            // value rather than leaving the input showing a number the
            // model never actually accepted. `value` here is still last
            // render's prop (this handler runs before React re-renders
            // this component), which is exactly the value to revert to
            // since a rejected update left it unchanged.
            if (accepted === false) {
              setRaw(String(value))
            }
          }
        }}
        onBlur={() => {
          if (raw === '' || !Number.isFinite(Number(raw))) {
            setRaw(String(value))
          }
        }}
      />
    </label>
  )
}

export function ObstructionPropertyPanel({
  obstruction,
  onChange,
  onDelete,
  onClose,
}: ObstructionPropertyPanelProps) {
  const { kind, position, heightM, radiusM } = obstruction

  return (
    <div className={styles.panel} data-testid="obstruction-property-panel">
      <div className={styles.header}>
        <span>{kind}</span>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Deselect obstruction"
        >
          ×
        </button>
      </div>

      <NumberField
        id="obstruction-height"
        label="Height (m)"
        value={heightM}
        min={MIN_OBSTRUCTION_HEIGHT_M}
        step={0.5}
        onCommit={(next) => onChange({ heightM: next })}
      />

      <NumberField
        id="obstruction-radius"
        label={
          kind === 'tree' ? 'Canopy radius (m)' : 'Footprint half-width (m)'
        }
        value={radiusM}
        min={MIN_OBSTRUCTION_RADIUS_M}
        step={0.1}
        onCommit={(next) => onChange({ radiusM: next })}
      />

      <NumberField
        id="obstruction-position-x"
        label="Position east (m)"
        value={position.x}
        step={0.5}
        onCommit={(next) => onChange({ position: { ...position, x: next } })}
      />

      <NumberField
        id="obstruction-position-y"
        label="Position north (m)"
        value={position.y}
        step={0.5}
        onCommit={(next) => onChange({ position: { ...position, y: next } })}
      />

      <button type="button" className={styles.deleteButton} onClick={onDelete}>
        Remove
      </button>
    </div>
  )
}
