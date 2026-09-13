import { describe, expect, it } from 'vitest'
import {
  computeSunLightState,
  dayHourToUtcDate,
  sunAltitudeAzimuthToEnuDirection,
  SCRUBBER_REFERENCE_YEAR,
} from './sunDirection'

describe('sunAltitudeAzimuthToEnuDirection', () => {
  it('straight overhead (altitude=90) points straight up regardless of azimuth', () => {
    const dir = sunAltitudeAzimuthToEnuDirection(90, 137)
    expect(dir.x).toBeCloseTo(0, 10)
    expect(dir.y).toBeCloseTo(0, 10)
    expect(dir.z).toBeCloseTo(1, 10)
  })

  it('on the horizon due north (altitude=0, azimuth=0) points +y, matching the project-wide azimuth convention (x=sin, y=cos, per geometryBuilders.ts liftToPlane)', () => {
    const dir = sunAltitudeAzimuthToEnuDirection(0, 0)
    expect(dir.x).toBeCloseTo(0, 10)
    expect(dir.y).toBeCloseTo(1, 10)
    expect(dir.z).toBeCloseTo(0, 10)
  })

  it('on the horizon due east (altitude=0, azimuth=90) points +x', () => {
    const dir = sunAltitudeAzimuthToEnuDirection(0, 90)
    expect(dir.x).toBeCloseTo(1, 10)
    expect(dir.y).toBeCloseTo(0, 10)
    expect(dir.z).toBeCloseTo(0, 10)
  })

  it('on the horizon due south (altitude=0, azimuth=180) points -y', () => {
    const dir = sunAltitudeAzimuthToEnuDirection(0, 180)
    expect(dir.x).toBeCloseTo(0, 10)
    expect(dir.y).toBeCloseTo(-1, 10)
    expect(dir.z).toBeCloseTo(0, 10)
  })

  it('on the horizon due west (altitude=0, azimuth=270) points -x', () => {
    const dir = sunAltitudeAzimuthToEnuDirection(0, 270)
    expect(dir.x).toBeCloseTo(-1, 10)
    expect(dir.y).toBeCloseTo(0, 10)
    expect(dir.z).toBeCloseTo(0, 10)
  })

  it('45 degrees altitude splits the unit vector evenly between horizontal and vertical', () => {
    const dir = sunAltitudeAzimuthToEnuDirection(45, 90)
    expect(dir.x).toBeCloseTo(Math.SQRT1_2, 10)
    expect(dir.z).toBeCloseTo(Math.SQRT1_2, 10)
  })

  it('always returns a unit vector', () => {
    for (const [alt, az] of [
      [10, 20],
      [-30, 200],
      [89, 359],
      [-89, 1],
    ]) {
      const dir = sunAltitudeAzimuthToEnuDirection(alt, az)
      const length = Math.sqrt(dir.x ** 2 + dir.y ** 2 + dir.z ** 2)
      expect(length).toBeCloseTo(1, 10)
    }
  })
})

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
