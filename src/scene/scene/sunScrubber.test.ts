import { describe, expect, it } from 'vitest'
import {
  computeSunLightState,
  dayHourToUtcDate,
  SCRUBBER_REFERENCE_YEAR,
} from './sunScrubber'

// `sunAltitudeAzimuthToEnuDirection` itself now lives in, and is tested by,
// `solar-physics/sunDirection.test.ts` (issue #91, item 4) — this file only
// covers this module's own scrubber-specific helpers.

describe('computeSunLightState', () => {
  it('returns a direction when the sun is above the horizon (Berlin, summer midday UTC)', () => {
    const state = computeSunLightState(52.5, 13.4, dayHourToUtcDate(172, 11))
    expect(state.altitudeDeg).toBeGreaterThan(0)
    expect(state.direction).not.toBeNull()
    if (state.direction) {
      const length = Math.sqrt(
        state.direction.x ** 2 +
          state.direction.y ** 2 +
          state.direction.z ** 2,
      )
      expect(length).toBeCloseTo(1, 6)
    }
  })

  it('returns a null direction when the sun is below the horizon (the same location, the middle of the night)', () => {
    const state = computeSunLightState(52.5, 13.4, dayHourToUtcDate(1, 1))
    expect(state.altitudeDeg).toBeLessThan(0)
    expect(state.direction).toBeNull()
  })
})

describe('dayHourToUtcDate', () => {
  it('day 1, hour 0 is midnight UTC on Jan 1 of the reference year', () => {
    const date = dayHourToUtcDate(1, 0)
    expect(date.getUTCFullYear()).toBe(SCRUBBER_REFERENCE_YEAR)
    expect(date.getUTCMonth()).toBe(0)
    expect(date.getUTCDate()).toBe(1)
    expect(date.getUTCHours()).toBe(0)
  })

  it('advances by whole days and fractional hours correctly', () => {
    const date = dayHourToUtcDate(32, 13.5)
    // Day 32 of a non-leap year is Feb 1.
    expect(date.getUTCMonth()).toBe(1)
    expect(date.getUTCDate()).toBe(1)
    expect(date.getUTCHours()).toBe(13)
    expect(date.getUTCMinutes()).toBe(30)
  })
})
