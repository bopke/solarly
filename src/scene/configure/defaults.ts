import { suggestAzimuth } from '../derive'
import type { TracedShape } from '../tracing'
import type { ShapeFieldValues } from './validation'
import type { ConfigureShapesLocation } from './types'

/**
 * A roof face's tilt has no default beyond "some starting number" —
 * satellite imagery can't reveal slope, so the user must set this
 * themselves (via a preset or free entry). `MEDIUM` is used to seed the
 * field with a plausible starting value; see `ROOF_TILT_PRESETS` for the
 * full set of quick-pick options shown alongside free entry.
 */
export const ROOF_TILT_PRESETS = [
  { label: 'Shallow (~15°)', tiltDeg: 15 },
  { label: 'Medium (~30°)', tiltDeg: 30 },
  { label: 'Steep (~45°)', tiltDeg: 45 },
] as const

const DEFAULT_ROOF_TILT_DEG = ROOF_TILT_PRESETS[1].tiltDeg

/**
 * A reasonable fixed-tilt default: tilt roughly equal to the absolute
 * latitude, a common rule-of-thumb heuristic for a year-round fixed-tilt
 * racking angle. Rounded to a whole degree since this is only a starting
 * point — free entry lets the user refine it.
 */
function groundArrayDefaultTiltDeg(location: ConfigureShapesLocation): number {
  return Math.min(90, Math.max(0, Math.round(Math.abs(location.lat))))
}

/**
 * Equator-facing default azimuth for a ground array: due south (180°) in
 * the northern hemisphere, due north (0°) in the southern hemisphere.
 */
function groundArrayDefaultAzimuthDeg(
  location: ConfigureShapesLocation,
): number {
  return location.lat >= 0 ? 180 : 0
}

/**
 * Computes the default (pre-fill) field values for one traced shape, per
 * the M2 design spec's "configure each traced shape" step:
 * - `roof-face`: a starting tilt (the medium preset) plus free entry, and
 *   an azimuth auto-suggested from the polygon's longest edge.
 * - `ground-array`: tilt and azimuth both defaulted from the resolved
 *   location's latitude.
 *
 * Both are just starting points — every field stays independently
 * editable afterwards.
 */
export function defaultFieldValuesFor(
  shape: TracedShape,
  location: ConfigureShapesLocation,
): ShapeFieldValues {
  if (shape.kind === 'ground-array') {
    return {
      tiltDeg: String(groundArrayDefaultTiltDeg(location)),
      azimuthDeg: String(groundArrayDefaultAzimuthDeg(location)),
    }
  }
  return {
    tiltDeg: String(DEFAULT_ROOF_TILT_DEG),
    azimuthDeg: String(suggestAzimuth(shape.polygon)),
  }
}
