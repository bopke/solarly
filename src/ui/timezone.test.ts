import { describe, expect, it } from 'vitest'
import { approximateTimezone, formatUtcOffset } from './timezone'

describe('approximateTimezone', () => {
  it('returns 0 near the prime meridian', () => {
    expect(approximateTimezone(0)).toBe(0)
    expect(approximateTimezone(2.3522)).toBe(0)
  })

  it('rounds to the nearest 15° band for a positive longitude', () => {
    // Berlin's longitude (≈13.39°E). This is the *longitude-based*
    // approximation only — it returns 1 (standard/winter-time offset)
    // year-round and does not account for DST, so it undershoots
    // Berlin's actual summer offset (UTC+2, CEST) by design. See the
    // module docblock and docs/decisions/0012-location-picker.md.
    expect(approximateTimezone(13.3889)).toBe(1)
  })

  it('rounds to the nearest 15° band for a negative longitude', () => {
    expect(approximateTimezone(-73.9)).toBe(-5)
  })

  it('clamps to the real range of UTC offsets', () => {
    // 250°/-250° are impossible longitudes (valid range is -180..180, so
    // the largest magnitude achievable is round(180/15) = 12); these
    // values only exercise the clamp's dead code path, not real UTC+13/14
    // zones, which this longitude-only approximation can never produce.
    expect(approximateTimezone(250)).toBe(14)
    expect(approximateTimezone(-250)).toBe(-12)
  })
})

describe('formatUtcOffset', () => {
  it('formats a positive offset with an approximation marker', () => {
    expect(formatUtcOffset(1)).toBe('≈ UTC+1')
  })

  it('formats zero with a plus sign', () => {
    expect(formatUtcOffset(0)).toBe('≈ UTC+0')
  })

  it('formats a negative offset', () => {
    expect(formatUtcOffset(-5)).toBe('≈ UTC-5')
  })
})
