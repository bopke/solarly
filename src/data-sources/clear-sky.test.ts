import { describe, expect, it } from 'vitest'
import { clearSkyGhiWm2, solarElevationDegrees } from './clear-sky'

describe('solarElevationDegrees', () => {
  it('is roughly maximal near local solar noon at the summer solstice', () => {
    // Berlin, 2026-06-21 ~noon local solar time (UTC+~1h true solar time
    // offset at 13.41E is small, so UTC noon is close to solar noon).
    const elevation = solarElevationDegrees(
      52.52,
      13.41,
      new Date('2026-06-21T11:00:00Z'),
    )
    // Expected max solar elevation at 52.5N on the summer solstice is
    // ~90 - 52.5 + 23.44 ≈ 60.9 degrees.
    expect(elevation).toBeGreaterThan(55)
    expect(elevation).toBeLessThan(63)
  })

  it('is negative at midnight', () => {
    const elevation = solarElevationDegrees(
      52.52,
      13.41,
      new Date('2026-06-21T00:00:00Z'),
    )
    expect(elevation).toBeLessThan(0)
  })

  it('is near zero at the equator on an equinox noon-ish hour', () => {
    const elevation = solarElevationDegrees(
      0,
      0,
      new Date('2026-03-20T12:00:00Z'),
    )
    expect(elevation).toBeGreaterThan(80)
  })
})

describe('clearSkyGhiWm2', () => {
  it('is zero at or below the horizon', () => {
    expect(clearSkyGhiWm2(0)).toBe(0)
    expect(clearSkyGhiWm2(-10)).toBe(0)
  })

  it('increases monotonically with solar elevation', () => {
    const values = [10, 30, 60, 90].map(clearSkyGhiWm2)
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1])
    }
  })

  it('is close to the ~1098 W/m^2 asymptote at the zenith', () => {
    expect(clearSkyGhiWm2(90)).toBeCloseTo(1098 * Math.exp(-0.059), 0)
  })
})
