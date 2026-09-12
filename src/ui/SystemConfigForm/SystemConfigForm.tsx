import { useEffect, useId, useMemo, useState } from 'react'
import type { PanelPreset } from '../../panel-presets'
import { PANEL_PRESETS } from '../../panel-presets'
import styles from './SystemConfigForm.module.css'
import type { SystemConfig, SystemConfigChangeHandler } from './types'
import {
  azimuthCompassLabel,
  parseFieldOrFallback,
  validateAll,
  type SystemConfigFieldValues,
} from './validation'

/** Default field values shown when no preset has been selected yet. */
const DEFAULT_VALUES: SystemConfigFieldValues = {
  tiltDeg: '30',
  azimuthDeg: '180',
  panelCount: '10',
  wattsPerPanel: '400',
  efficiencyPercent: '20',
  tempCoefficientPercentPerC: '-0.35',
  systemLossesPercent: '14',
  manualShadingPercent: '0',
}

const CUSTOM_OPTION_VALUE = ''

/**
 * Fields that a panel preset actually writes. Editing one of these while a
 * preset is selected means the config no longer matches that preset, so it
 * detaches (`presetId` resets to `null`). Editing any other field (tilt,
 * azimuth, panel count, system losses, manual shading) is a property of
 * the *installation*, not the panel model, and must not clear the preset.
 */
const PRESET_DERIVED_FIELDS: ReadonlySet<keyof SystemConfigFieldValues> =
  new Set(['wattsPerPanel', 'efficiencyPercent', 'tempCoefficientPercentPerC'])

export interface SystemConfigFormProps {
  /** Panel presets to populate the dropdown with. Defaults to `PANEL_PRESETS`. */
  presets?: PanelPreset[]
  /**
   * Initial field values (and/or selected preset). Only used on first
   * render — the form owns its state thereafter, updates are surfaced
   * via `onChange`.
   */
  initialConfig?: Partial<SystemConfig>
  /** Called whenever the config or its validity changes. */
  onChange: SystemConfigChangeHandler
}

/**
 * Derives the form's initial field values from `initialConfig`. When
 * `initialConfig.presetId` names a known preset, that preset's values seed
 * the preset-derived fields (efficiency, temp coefficient, watts per
 * panel) *before* `initialConfig`'s own fields are applied on top — so the
 * dropdown and the numeric fields agree with each other on first render,
 * and any field explicitly set on `initialConfig` still wins.
 */
function initialValuesFrom(
  initialConfig: Partial<SystemConfig> | undefined,
  presets: PanelPreset[],
): SystemConfigFieldValues {
  if (!initialConfig) {
    return DEFAULT_VALUES
  }
  const preset = initialConfig.presetId
    ? presets.find((p) => p.id === initialConfig.presetId)
    : undefined
  const base: SystemConfigFieldValues = preset
    ? {
        ...DEFAULT_VALUES,
        wattsPerPanel: String(preset.ratedWattsPeak),
        efficiencyPercent: String(preset.efficiencyPercent),
        tempCoefficientPercentPerC: String(preset.tempCoefficientPercentPerC),
      }
    : DEFAULT_VALUES
  return {
    tiltDeg: String(initialConfig.tiltDeg ?? base.tiltDeg),
    azimuthDeg: String(initialConfig.azimuthDeg ?? base.azimuthDeg),
    panelCount: String(initialConfig.panelCount ?? base.panelCount),
    wattsPerPanel: String(initialConfig.wattsPerPanel ?? base.wattsPerPanel),
    efficiencyPercent: String(
      initialConfig.efficiencyPercent ?? base.efficiencyPercent,
    ),
    tempCoefficientPercentPerC: String(
      initialConfig.tempCoefficientPercentPerC ??
        base.tempCoefficientPercentPerC,
    ),
    systemLossesPercent: String(
      initialConfig.systemLossesPercent ?? base.systemLossesPercent,
    ),
    manualShadingPercent: String(
      initialConfig.manualShadingPercent ?? base.manualShadingPercent,
    ),
  }
}

/**
 * System config form: a panel-preset dropdown plus editable numeric
 * fields (tilt, azimuth, panel count, watts per panel, efficiency,
 * temperature coefficient, system losses, manual shading). Selecting a
 * preset prefills the panel-model fields (watts per panel, efficiency,
 * temperature coefficient) below; every field stays independently
 * editable afterwards, and editing an installation field (tilt, azimuth,
 * panel count, system losses, manual shading) does not disturb the
 * selected preset. Invalid values are flagged inline and never silently
 * clamped — `onChange`'s `isValid` flag reflects that.
 *
 * Self-contained: takes no dependency on any app-shell internals, so it
 * can be wired into a slot/layout component separately.
 */
export function SystemConfigForm({
  presets = PANEL_PRESETS,
  initialConfig,
  onChange,
}: SystemConfigFormProps) {
  const [presetId, setPresetId] = useState<string | null>(
    initialConfig?.presetId ?? null,
  )
  const [values, setValues] = useState<SystemConfigFieldValues>(() =>
    initialValuesFrom(initialConfig, presets),
  )
  const formId = useId()

  const errors = useMemo(() => validateAll(values), [values])
  const isValid = Object.keys(errors).length === 0

  const config: SystemConfig = useMemo(
    () => ({
      presetId,
      tiltDeg: parseFieldOrFallback(values.tiltDeg, 0),
      azimuthDeg: parseFieldOrFallback(values.azimuthDeg, 0),
      panelCount: parseFieldOrFallback(values.panelCount, 0),
      wattsPerPanel: parseFieldOrFallback(values.wattsPerPanel, 0),
      efficiencyPercent: parseFieldOrFallback(values.efficiencyPercent, 0),
      tempCoefficientPercentPerC: parseFieldOrFallback(
        values.tempCoefficientPercentPerC,
        0,
      ),
      systemLossesPercent: parseFieldOrFallback(values.systemLossesPercent, 0),
      manualShadingPercent: parseFieldOrFallback(
        values.manualShadingPercent,
        0,
      ),
    }),
    [presetId, values],
  )

  // Report every change (including the initial render) to the parent.
  useEffect(() => {
    onChange(config, isValid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, isValid])

  function handlePresetChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextId = event.target.value
    if (nextId === CUSTOM_OPTION_VALUE) {
      setPresetId(null)
      return
    }
    const preset = presets.find((p) => p.id === nextId)
    if (!preset) {
      return
    }
    setPresetId(preset.id)
    setValues((prev) => ({
      ...prev,
      wattsPerPanel: String(preset.ratedWattsPeak),
      efficiencyPercent: String(preset.efficiencyPercent),
      tempCoefficientPercentPerC: String(preset.tempCoefficientPercentPerC),
    }))
  }

  function handleFieldChange(
    field: keyof SystemConfigFieldValues,
    rawValue: string,
  ) {
    setValues((prev) => ({ ...prev, [field]: rawValue }))
    // Editing a field manually detaches the config from "this is exactly
    // preset X" — but only when the field being edited is one the preset
    // actually writes. Installation-specific fields (tilt, azimuth, panel
    // count, system losses, manual shading) don't describe the panel
    // model, so editing them must not clear which panel is recorded.
    if (PRESET_DERIVED_FIELDS.has(field)) {
      setPresetId(null)
    }
  }

  const azimuthValue = Number(values.azimuthDeg)
  const compassLabel = azimuthCompassLabel(azimuthValue)

  return (
    <form className={styles.form} aria-label="System configuration" noValidate>
      <div className={styles.field}>
        <label htmlFor={`${formId}-preset`} className={styles.label}>
          Panel preset
        </label>
        <select
          id={`${formId}-preset`}
          className={styles.select}
          value={presetId ?? CUSTOM_OPTION_VALUE}
          onChange={handlePresetChange}
        >
          <option value={CUSTOM_OPTION_VALUE}>Custom</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.make} {preset.model}
            </option>
          ))}
        </select>
      </div>

      <NumberField
        formId={formId}
        field="tiltDeg"
        label="Tilt (°)"
        value={values.tiltDeg}
        error={errors.tiltDeg}
        onChange={handleFieldChange}
      />

      <NumberField
        formId={formId}
        field="azimuthDeg"
        label="Azimuth (°)"
        value={values.azimuthDeg}
        error={errors.azimuthDeg}
        onChange={handleFieldChange}
        hint={
          compassLabel ? `${values.azimuthDeg}° (${compassLabel})` : undefined
        }
      />

      <NumberField
        formId={formId}
        field="panelCount"
        label="Panel count"
        value={values.panelCount}
        error={errors.panelCount}
        onChange={handleFieldChange}
      />

      <NumberField
        formId={formId}
        field="wattsPerPanel"
        label="Watts per panel (Wp)"
        value={values.wattsPerPanel}
        error={errors.wattsPerPanel}
        onChange={handleFieldChange}
      />

      <NumberField
        formId={formId}
        field="efficiencyPercent"
        label="Efficiency (%)"
        value={values.efficiencyPercent}
        error={errors.efficiencyPercent}
        onChange={handleFieldChange}
      />

      <NumberField
        formId={formId}
        field="tempCoefficientPercentPerC"
        label="Temperature coefficient (%/°C)"
        value={values.tempCoefficientPercentPerC}
        error={errors.tempCoefficientPercentPerC}
        onChange={handleFieldChange}
      />

      <NumberField
        formId={formId}
        field="systemLossesPercent"
        label="System losses (%)"
        value={values.systemLossesPercent}
        error={errors.systemLossesPercent}
        onChange={handleFieldChange}
      />

      <NumberField
        formId={formId}
        field="manualShadingPercent"
        label="Manual shading (%)"
        value={values.manualShadingPercent}
        error={errors.manualShadingPercent}
        onChange={handleFieldChange}
      />
    </form>
  )
}

interface NumberFieldProps {
  formId: string
  field: keyof SystemConfigFieldValues
  label: string
  value: string
  error: string | undefined
  hint?: string
  onChange: (field: keyof SystemConfigFieldValues, rawValue: string) => void
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
