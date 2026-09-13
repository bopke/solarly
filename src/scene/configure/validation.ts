import type { ShapeConfigFieldErrors } from './types'

/** Raw (string) form field values for one shape's tilt/azimuth. */
export interface ShapeFieldValues {
  tiltDeg: string
  azimuthDeg: string
}

type ShapeConfigField = keyof ShapeFieldValues

interface FieldRule {
  label: string
  min: number
  max: number
}

/**
 * Same 0-90/0-360 ranges as `SystemConfigForm`'s `tiltDeg`/`azimuthDeg`
 * rules — kept as an independent copy here (rather than importing from
 * `src/ui/SystemConfigForm`) so `scene/configure` doesn't take a
 * dependency on a `src/ui/` component, matching this module tree's
 * self-contained convention (see `scene/tracing/geometry.ts`'s `LatLon`
 * for the same rationale applied elsewhere).
 */
const FIELD_RULES: Record<ShapeConfigField, FieldRule> = {
  tiltDeg: { label: 'Tilt', min: 0, max: 90 },
  azimuthDeg: { label: 'Azimuth', min: 0, max: 360 },
}

/**
 * Matches plain decimal numbers only (optional sign, optional fractional
 * part) — deliberately narrower than what `Number()` accepts, so
 * lookalikes like `'0x10'` (hex) or `'1e3'` (scientific notation) are
 * rejected as non-numeric input rather than silently parsed as 16 or 1000.
 */
const PLAIN_DECIMAL_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)$/

/** Validates a single raw field value, returning an error message or `null` if valid. */
export function validateShapeField(
  field: ShapeConfigField,
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

  if (value < rule.min) {
    return `${rule.label} must be at least ${rule.min}`
  }

  if (value > rule.max) {
    return `${rule.label} must be at most ${rule.max}`
  }

  return null
}

/** Validates both fields of one shape, returning an error map (omitting valid fields). */
export function validateShapeFields(
  values: ShapeFieldValues,
): ShapeConfigFieldErrors {
  const errors: ShapeConfigFieldErrors = {}
  const tiltError = validateShapeField('tiltDeg', values.tiltDeg)
  if (tiltError) errors.tiltDeg = tiltError
  const azimuthError = validateShapeField('azimuthDeg', values.azimuthDeg)
  if (azimuthError) errors.azimuthDeg = azimuthError
  return errors
}

/**
 * Best-effort numeric parse of a field's raw value, falling back to
 * `fallback` when the raw value doesn't parse as a plain decimal number
 * (including hex/scientific-notation lookalikes like `'0x10'` or `'1e3'` —
 * see {@link PLAIN_DECIMAL_PATTERN}).
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
