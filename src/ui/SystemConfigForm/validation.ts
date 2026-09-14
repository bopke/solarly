import { azimuthCompassLabel } from '../../shared/azimuthCompassLabel'
import type { SystemConfig, SystemConfigFieldErrors } from './types'

export { azimuthCompassLabel }

/** Raw (string) form field values, one per editable `SystemConfig` field. */
export type SystemConfigFieldValues = Record<
  Exclude<keyof SystemConfig, 'presetId'>,
  string
>

interface FieldRule {
  label: string
  /** Inclusive lower bound, if any. */
  min?: number
  /** Inclusive upper bound, if any. */
  max?: number
  /** Whether the value must be a whole number. */
  integer?: boolean
  /** Whether the value must be strictly greater than zero. */
  positive?: boolean
}

const FIELD_RULES: Record<
  Exclude<keyof SystemConfig, 'presetId'>,
  FieldRule
> = {
  tiltDeg: { label: 'Tilt', min: 0, max: 90 },
  azimuthDeg: { label: 'Azimuth', min: 0, max: 360 },
  panelCount: {
    label: 'Panel count',
    integer: true,
    positive: true,
    // Sanity cap — not a physical limit, just a guard against an
    // accidental paste (e.g. a stray extra digit) triggering a very heavy
    // simulation run.
    max: 100_000,
  },
  wattsPerPanel: { label: 'Watts per panel', positive: true },
  efficiencyPercent: { label: 'Efficiency', min: 0, max: 100 },
  // Real panels always lose output as they heat up above the 25°C STC
  // reference, so the coefficient is never positive (see
  // `panel-presets`' `PanelPreset.tempCoefficientPercentPerC` doc).
  tempCoefficientPercentPerC: { label: 'Temperature coefficient', max: 0 },
  systemLossesPercent: { label: 'System losses', min: 0, max: 100 },
  manualShadingPercent: { label: 'Manual shading', min: 0, max: 100 },
}

/**
 * Matches plain decimal numbers only (optional sign, optional fractional
 * part) — deliberately narrower than what `Number()` accepts, so
 * lookalikes like `'0x10'` (hex) or `'1e3'` (scientific notation) are
 * rejected as non-numeric input rather than silently parsed as 16 or 1000.
 */
const PLAIN_DECIMAL_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)$/

/** Validates a single raw field value, returning an error message or `null` if valid. */
export function validateField(
  field: Exclude<keyof SystemConfig, 'presetId'>,
  rawValue: string,
): string | null {
  const rule = FIELD_RULES[field]
  const trimmed = rawValue.trim()

  if (trimmed === '') {
    return `${rule.label} is required`
  }

  if (!PLAIN_DECIMAL_PATTERN.test(trimmed)) {
    return `${rule.label} must be a number`
  }

  const value = Number(trimmed)
  if (!Number.isFinite(value)) {
    return `${rule.label} must be a number`
  }

  if (rule.integer && !Number.isInteger(value)) {
    return `${rule.label} must be a whole number`
  }

  if (rule.positive && value <= 0) {
    return `${rule.label} must be greater than 0`
  }

  if (rule.min !== undefined && value < rule.min) {
    return `${rule.label} must be at least ${rule.min}`
  }

  if (rule.max !== undefined && value > rule.max) {
    return `${rule.label} must be at most ${rule.max}`
  }

  return null
}

/** Validates every field, returning an error map (fields with no error are omitted). */
export function validateAll(
  values: SystemConfigFieldValues,
): SystemConfigFieldErrors {
  const errors: SystemConfigFieldErrors = {}
  for (const field of Object.keys(FIELD_RULES) as Array<
    keyof SystemConfigFieldValues
  >) {
    const error = validateField(field, values[field])
    if (error) {
      errors[field] = error
    }
  }
  return errors
}

/**
 * Best-effort numeric parse of a field's raw value, falling back to
 * `fallback` when the raw value doesn't parse as a plain decimal number
 * (including hex/scientific-notation lookalikes like `'0x10'` or `'1e3'` —
 * see {@link PLAIN_DECIMAL_PATTERN}). Used to keep the reported
 * `SystemConfig` complete even while a field is mid-edit or invalid.
 */
export function parseFieldOrFallback(
  rawValue: string,
  fallback: number,
): number {
  const trimmed = rawValue.trim()
  if (!PLAIN_DECIMAL_PATTERN.test(trimmed)) {
    return fallback
  }
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : fallback
}
