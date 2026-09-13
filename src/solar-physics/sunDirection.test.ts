import { describe, expect, it } from 'vitest'
import { sunAltitudeAzimuthToEnuDirection } from './sunDirection'

/** Asserts each component of a `Vec3` matches, within a small tolerance. */
function expectVec3Close(
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number },
  precision = 10,
): void {
  expect(actual.x).toBeCloseTo(expected.x, precision)
  expect(actual.y).toBeCloseTo(expected.y, precision)
  expect(actual.z).toBeCloseTo(expected.z, precision)
}

describe('sunAltitudeAzimuthToEnuDirection', () => {
  it('points due north (+y) for azimuth 0 at the horizon', () => {
    expectVec3Close(sunAltitudeAzimuthToEnuDirection(0, 0), {
      x: 0,
      y: 1,
      z: 0,
    })
  })

  it('points due east (+x) for azimuth 90 at the horizon', () => {
    expectVec3Close(sunAltitudeAzimuthToEnuDirection(0, 90), {
      x: 1,
      y: 0,
      z: 0,
    })
  })

  it('points due south (-y) for azimuth 180 at the horizon', () => {
    expectVec3Close(sunAltitudeAzimuthToEnuDirection(0, 180), {
      x: 0,
      y: -1,
      z: 0,
    })
  })

  it('points due west (-x) for azimuth 270 at the horizon', () => {
    expectVec3Close(sunAltitudeAzimuthToEnuDirection(0, 270), {
      x: -1,
      y: 0,
      z: 0,
    })
  })

  it('points straight up (+z) at zenith, regardless of azimuth', () => {
    expectVec3Close(sunAltitudeAzimuthToEnuDirection(90, 0), {
      x: 0,
      y: 0,
      z: 1,
    })
    expectVec3Close(sunAltitudeAzimuthToEnuDirection(90, 200), {
      x: 0,
      y: 0,
      z: 1,
    })
  })

  it('produces a unit vector for a general altitude/azimuth pair', () => {
    const v = sunAltitudeAzimuthToEnuDirection(35, 210)
    const length = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2)
    expect(length).toBeCloseTo(1, 10)
    // az=210 is south-southwest (30deg west of due south), so the
    // horizontal projection has a negative (westward) x component and a
    // negative (southward) y component; altitude 35 > 0 gives a positive z.
    expect(v.x).toBeLessThan(0)
    expect(v.y).toBeLessThan(0)
    expect(v.z).toBeGreaterThan(0)
  })
})
