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
  onChange: (
    patch: Partial<Pick<Obstruction, 'position' | 'heightM' | 'radiusM'>>,
  ) => void
  onDelete: () => void
  onClose: () => void
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

      <label className={styles.field}>
        Height (m)
        <input
          type="number"
          min={MIN_OBSTRUCTION_HEIGHT_M}
          step={0.5}
          value={heightM}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) {
              onChange({ heightM: Math.max(next, MIN_OBSTRUCTION_HEIGHT_M) })
            }
          }}
        />
      </label>

      <label className={styles.field}>
        {kind === 'tree' ? 'Canopy radius (m)' : 'Footprint half-width (m)'}
        <input
          type="number"
          min={MIN_OBSTRUCTION_RADIUS_M}
          step={0.1}
          value={radiusM}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) {
              onChange({ radiusM: Math.max(next, MIN_OBSTRUCTION_RADIUS_M) })
            }
          }}
        />
      </label>

      <label className={styles.field}>
        Position east (m)
        <input
          type="number"
          step={0.5}
          value={position.x}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) {
              onChange({ position: { ...position, x: next } })
            }
          }}
        />
      </label>

      <label className={styles.field}>
        Position north (m)
        <input
          type="number"
          step={0.5}
          value={position.y}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) {
              onChange({ position: { ...position, y: next } })
            }
          }}
        />
      </label>

      <button type="button" className={styles.deleteButton} onClick={onDelete}>
        Remove
      </button>
    </div>
  )
}
