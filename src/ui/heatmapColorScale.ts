/**
 * Sequential color scale for the {@link Heatmap} chart, mapping power
 * output (W) to a color. Single-hue, light-to-dark (blue), per the
 * project's dataviz color guidance: sequential data (a continuous
 * magnitude, here watts) gets one hue ramping from light (near zero) to
 * dark (high), never a rainbow scale, so relative magnitude reads at a
 * glance and the encoding stays colorblind-safe.
 *
 * The steps below are the dataviz skill's validated default sequential
 * ramp (blue, steps 100-700) — reused as-is rather than inventing a new
 * palette, since it's already been run through the skill's contrast/CVD
 * validator for both light and dark chart surfaces.
 */

/** Ramp stops, lightest (near zero) to darkest (high), as `[step, hex]`. */
export const SEQUENTIAL_BLUE_RAMP: readonly (readonly [number, string])[] = [
  [100, '#cde2fb'],
  [150, '#b7d3f6'],
  [200, '#9ec5f4'],
  [250, '#86b6ef'],
  [300, '#6da7ec'],
  [350, '#5598e7'],
  [400, '#3987e5'],
  [450, '#2a78d6'],
  [500, '#256abf'],
  [550, '#1c5cab'],
  [600, '#184f95'],
  [650, '#104281'],
  [700, '#0d366b'],
]

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Maps a value in `[0, max]` to a color along {@link SEQUENTIAL_BLUE_RAMP},
 * linearly interpolating between adjacent ramp stops for a smooth
 * gradient. `value <= 0` (or `max <= 0`, a degenerate all-zero dataset)
 * returns the lightest stop; `value >= max` returns the darkest.
 */
export function powerToColor(value: number, max: number): string {
  const stops = SEQUENTIAL_BLUE_RAMP
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return stops[0][1]
  }
  const t = Math.min(1, Math.max(0, value / max))
  const scaled = t * (stops.length - 1)
  const lowIdx = Math.floor(scaled)
  const highIdx = Math.min(stops.length - 1, lowIdx + 1)
  const localT = scaled - lowIdx

  if (localT === 0) return stops[lowIdx][1]

  const [r1, g1, b1] = hexToRgb(stops[lowIdx][1])
  const [r2, g2, b2] = hexToRgb(stops[highIdx][1])
  const r = Math.round(lerp(r1, r2, localT))
  const g = Math.round(lerp(g1, g2, localT))
  const b = Math.round(lerp(b1, b2, localT))
  return `rgb(${r}, ${g}, ${b})`
}
