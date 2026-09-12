import type { SystemConfig, SystemConfigFieldErrors } from './types'

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
  },
  efficiencyPercent: { label: 'Efficiency', min: 0, max: 100 },
  tempCoefficientPercentPerC: { label: 'Temperature coefficient' },
  systemLossesPercent: { label: 'System losses', min: 0, max: 100 },
  manualShadingPercent: { label: 'Manual shading', min: 0, max: 100 },
}

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
 * Compass label for a given azimuth in degrees, e.g. 180 -> "S", 135 -> "SE".
 * Uses the 8-point compass; out-of-range or non-finite input returns `''`.
 */
export function azimuthCompassLabel(azimuthDeg: number): string {
  if (!Number.isFinite(azimuthDeg)) {
    return ''
  }
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const normalized = ((azimuthDeg % 360) + 360) % 360
  const index = Math.round(normalized / 45) % 8
  return points[index]
}

/**
 * Best-effort numeric parse of a field's raw value, falling back to
 * `fallback` when the raw value doesn't parse as a finite number. Used to
 * keep the reported `SystemConfig` complete even while a field is
 * mid-edit or invalid.
 */
export function parseFieldOrFallback(
  rawValue: string,
  fallback: number,
): number {
  const value = Number(rawValue.trim())
  return Number.isFinite(value) && rawValue.trim() !== '' ? value : fallback
}
