import { describe, expect, it } from 'vitest'
import {
  azimuthCompassLabel,
  parseFieldOrFallback,
  validateShapeField,
} from './validation'

describe('validateShapeField', () => {
  describe('boundary values are valid (regression lock against off-by-one errors)', () => {
    it.each([0, 90])('tilt %s is valid', (v) => {
      expect(validateShapeField('tiltDeg', String(v))).toBeNull()
    })

    it.each([0, 360])('azimuth %s is valid', (v) => {
      expect(validateShapeField('azimuthDeg', String(v))).toBeNull()
    })
  })

  describe('boundary values just outside the valid range are invalid', () => {
    it('tilt 90.0001 is invalid', () => {
      expect(validateShapeField('tiltDeg', '90.0001')).toMatch(/at most 90/i)
    })

    it('tilt -0.0001 is invalid', () => {
      expect(validateShapeField('tiltDeg', '-0.0001')).toMatch(/at least 0/i)
    })

    it('azimuth 360.1 is invalid', () => {
      expect(validateShapeField('azimuthDeg', '360.1')).toMatch(/at most 360/i)
    })

    it('azimuth -1 is invalid', () => {
      expect(validateShapeField('azimuthDeg', '-1')).toMatch(/at least 0/i)
    })
  })

  describe('required and numeric-lookalike input', () => {
    it('flags an empty value as required', () => {
      expect(validateShapeField('tiltDeg', '')).toMatch(/required/i)
    })

    it('flags a whitespace-only value as required', () => {
      expect(validateShapeField('tiltDeg', '   ')).toMatch(/required/i)
    })

    it('rejects hex-lookalike input instead of parsing it as a decimal number', () => {
      // Number('0x10') === 16, which would silently accept a hex literal
      // as a tilt of 16 without this check.
      expect(validateShapeField('tiltDeg', '0x10')).toMatch(/must be a number/i)
    })

    it('rejects scientific notation instead of parsing it as a decimal number', () => {
      // Number('1e3') === 1000.
      expect(validateShapeField('azimuthDeg', '1e3')).toMatch(
        /must be a number/i,
      )
    })
  })
})

describe('parseFieldOrFallback', () => {
  it('parses a plain decimal number', () => {
    expect(parseFieldOrFallback('42.5', 0)).toBe(42.5)
  })

  it('falls back on hex-lookalike input', () => {
    expect(parseFieldOrFallback('0x10', 0)).toBe(0)
  })

  it('falls back on empty input', () => {
    expect(parseFieldOrFallback('', -1)).toBe(-1)
  })
})

describe('azimuthCompassLabel', () => {
  it.each([
    [0, 'N'],
    [90, 'E'],
    [180, 'S'],
    [270, 'W'],
    [135, 'SE'],
  ])('%s degrees is %s', (deg, label) => {
    expect(azimuthCompassLabel(deg)).toBe(label)
  })

  it('returns an empty string for non-finite input', () => {
    expect(azimuthCompassLabel(NaN)).toBe('')
  })
})
