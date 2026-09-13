import { useEffect, useId, useMemo, useState } from 'react'
import type { TracedShape } from '../tracing'
import { ROOF_TILT_PRESETS, defaultFieldValuesFor } from './defaults'
import type { ConfigureShapesLocation, ShapeConfig } from './types'
import type { ConfigureShapesChangeHandler } from './types'
import {
  azimuthCompassLabel,
  parseFieldOrFallback,
  validateShapeFields,
  type ShapeFieldValues,
} from './validation'
import styles from './ConfigureShapes.module.css'

export interface ConfigureShapesProps {
  /** Shapes traced in the previous step (issue #56), tagged roof-face or ground-array. */
  shapes: TracedShape[]
  /**
   * The resolved location from the location picker — used for
   * ground-array latitude-based tilt/azimuth defaults. Not needed for
   * roof faces (their azimuth default comes from the traced polygon
   * itself via `suggestAzimuth`).
   */
  location: ConfigureShapesLocation
  /**
   * Initial field values per shape id, keyed by `TracedShape.id`. Only
   * used to seed a shape's fields the first time it's seen — thereafter
   * the component owns its own state and reports updates via `onChange`,
   * same pattern as `SystemConfigForm`'s `initialConfig`. Lets a caller
   * re-open this step with previously-edited values instead of always
   * restarting from the computed defaults.
   */
  initialConfigs?: Record<string, { tiltDeg: number; azimuthDeg: number }>
  /** Called whenever any shape's config or overall validity changes. */
  onChange: ConfigureShapesChangeHandler
}

function fieldValuesFor(
  shape: TracedShape,
  location: ConfigureShapesLocation,
  initial: { tiltDeg: number; azimuthDeg: number } | undefined,
): ShapeFieldValues {
  if (initial) {
    return {
      tiltDeg: String(initial.tiltDeg),
      azimuthDeg: String(initial.azimuthDeg),
    }
  }
  return defaultFieldValuesFor(shape, location)
}

const KIND_LABEL: Record<TracedShape['kind'], string> = {
  'roof-face': 'Roof face',
  'ground-array': 'Ground array',
}

/**
 * "Configure each traced shape" step (M2 design spec, issue #59): renders
 * one tilt/azimuth editor per shape traced in the previous step.
 *
 * - Roof faces get a manually-entered tilt (satellite imagery can't show
 *   slope) via free numeric entry or a common-pitch preset button, and an
 *   azimuth pre-filled from the traced polygon's longest edge
 *   (`suggestAzimuth`), editable.
 * - Ground arrays get a single tilt/azimuth for the whole traced plot,
 *   defaulted from the resolved location's latitude and an equator-facing
 *   azimuth, both editable.
 *
 * Validation mirrors `SystemConfigForm`'s style: tilt 0-90°, azimuth
 * 0-360°, inline non-clamping errors, and `onChange`'s `isValid` flag
 * reflects whether every shape currently passes.
 *
 * Self-contained: doesn't render the 3D view (#57), doesn't place panels
 * or obstructions, and isn't wired into any flow orchestration (#60) —
 * just the per-shape tilt/azimuth editor.
 */
export function ConfigureShapes({
  shapes,
  location,
  initialConfigs,
  onChange,
}: ConfigureShapesProps) {
  const [fieldValues, setFieldValues] = useState<
    Record<string, ShapeFieldValues>
  >(() =>
    Object.fromEntries(
      shapes.map((shape) => [
        shape.id,
        fieldValuesFor(shape, location, initialConfigs?.[shape.id]),
      ]),
    ),
  )

  // Seed fields for any shape not yet seen (e.g. traced after this step
  // first mounted), without disturbing already-edited shapes.
  useEffect(() => {
    setFieldValues((prev) => {
      let changed = false
      const next = { ...prev }
      for (const shape of shapes) {
        if (!(shape.id in next)) {
          next[shape.id] = fieldValuesFor(
            shape,
            location,
            initialConfigs?.[shape.id],
          )
          changed = true
        }
      }
      return changed ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes])

  const errorsByShapeId = useMemo(() => {
    const map: Record<string, ReturnType<typeof validateShapeFields>> = {}
    for (const shape of shapes) {
      const values = fieldValues[shape.id]
      if (!values) continue
      const errors = validateShapeFields(values)
      if (Object.keys(errors).length > 0) {
        map[shape.id] = errors
      }
    }
    return map
  }, [shapes, fieldValues])

  const isValid = Object.keys(errorsByShapeId).length === 0

  const configs = useMemo<ShapeConfig[]>(
    () =>
      shapes.map((shape) => {
        const values =
          fieldValues[shape.id] ??
          fieldValuesFor(shape, location, initialConfigs?.[shape.id])
        return {
          shapeId: shape.id,
          tiltDeg: parseFieldOrFallback(values.tiltDeg, 0),
          azimuthDeg: parseFieldOrFallback(values.azimuthDeg, 0),
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shapes, fieldValues],
  )

  // Report every change (including the initial render) to the parent.
  useEffect(() => {
    onChange(configs, isValid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs, isValid])

  function handleFieldChange(
    shapeId: string,
    field: keyof ShapeFieldValues,
    rawValue: string,
  ) {
    setFieldValues((prev) => ({
      ...prev,
      [shapeId]: { ...prev[shapeId], [field]: rawValue },
    }))
  }

  return (
    <div className={styles.container}>
      {shapes.map((shape, index) => (
        <ShapeConfigFieldset
          key={shape.id}
          shape={shape}
          index={index}
          values={
            fieldValues[shape.id] ??
            fieldValuesFor(shape, location, initialConfigs?.[shape.id])
          }
          errors={errorsByShapeId[shape.id]}
          onFieldChange={handleFieldChange}
        />
      ))}
    </div>
  )
}

interface ShapeConfigFieldsetProps {
  shape: TracedShape
  index: number
  values: ShapeFieldValues
  errors: ReturnType<typeof validateShapeFields> | undefined
  onFieldChange: (
    shapeId: string,
    field: keyof ShapeFieldValues,
    rawValue: string,
  ) => void
}

function ShapeConfigFieldset({
  shape,
  index,
  values,
  errors,
  onFieldChange,
}: ShapeConfigFieldsetProps) {
  const formId = useId()
  const legendId = `${formId}-legend`
  const kindLabel = KIND_LABEL[shape.kind]
  const heading = `${kindLabel} ${index + 1}`
  const azimuthValue = Number(values.azimuthDeg)
  const compassLabel = azimuthCompassLabel(azimuthValue)

  return (
    <fieldset
      className={styles.fieldset}
      aria-labelledby={legendId}
      data-shape-kind={shape.kind}
    >
      <legend id={legendId} className={styles.legend}>
        {heading}
      </legend>

      {shape.kind === 'roof-face' ? (
        <div className={styles.field}>
          <span className={styles.presetLabel}>Tilt presets</span>
          <div className={styles.presetButtons}>
            {ROOF_TILT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={styles.presetButton}
                aria-pressed={values.tiltDeg === String(preset.tiltDeg)}
                onClick={() =>
                  onFieldChange(shape.id, 'tiltDeg', String(preset.tiltDeg))
                }
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <NumberField
        formId={formId}
        field="tiltDeg"
        label={`Tilt (°) — ${heading}`}
        value={values.tiltDeg}
        error={errors?.tiltDeg}
        onChange={(field, rawValue) => onFieldChange(shape.id, field, rawValue)}
      />

      <NumberField
        formId={formId}
        field="azimuthDeg"
        label={`Azimuth (°) — ${heading}`}
        value={values.azimuthDeg}
        error={errors?.azimuthDeg}
        onChange={(field, rawValue) => onFieldChange(shape.id, field, rawValue)}
        hint={
          compassLabel ? `${values.azimuthDeg}° (${compassLabel})` : undefined
        }
      />
    </fieldset>
  )
}

interface NumberFieldProps {
  formId: string
  field: keyof ShapeFieldValues
  label: string
  value: string
  error: string | undefined
  hint?: string
  onChange: (field: keyof ShapeFieldValues, rawValue: string) => void
}

function NumberField({
  formId,
  field,
  label,
  value,
  error,
  hint,
  onChange,
}: NumberFieldProps) {
  const inputId = `${formId}-${field}`
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`
  const describedBy =
    [hint && !error ? hintId : null, error ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <input
        id={inputId}
        name={field}
        type="number"
        inputMode="decimal"
        className={styles.input}
        value={value}
        onChange={(event) => onChange(field, event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint && !error ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
