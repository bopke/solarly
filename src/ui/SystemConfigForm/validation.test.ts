import { describe, expect, it } from 'vitest'
import { parseFieldOrFallback, validateField } from './validation'

describe('validateField', () => {
  describe('boundary values are valid (regression lock against off-by-one errors)', () => {
    it.each([0, 90])('tilt %s is valid', (v) => {
      expect(validateField('tiltDeg', String(v))).toBeNull()
    })

    it.each([0, 360])('azimuth %s is valid', (v) => {
      expect(validateField('azimuthDeg', String(v))).toBeNull()
    })

    it.each([0, 100])('efficiency %s is valid', (v) => {
      expect(validateField('efficiencyPercent', String(v))).toBeNull()
    })

    it.each([0, 100])('system losses %s is valid', (v) => {
      expect(validateField('systemLossesPercent', String(v))).toBeNull()
    })

    it.each([0, 100])('manual shading %s is valid', (v) => {
      expect(validateField('manualShadingPercent', String(v))).toBeNull()
    })

    it('panel count 1 is valid (just above the positive boundary)', () => {
      expect(validateField('panelCount', '1')).toBeNull()
    })

    it('panel count 100000 (the upper bound) is valid', () => {
      expect(validateField('panelCount', '100000')).toBeNull()
    })

    it('temperature coefficient 0 (the upper bound) is valid', () => {
      expect(validateField('tempCoefficientPercentPerC', '0')).toBeNull()
    })

    it('watts per panel just above 0 is valid', () => {
      expect(validateField('wattsPerPanel', '0.1')).toBeNull()
    })
  })

  describe('boundary values just outside the valid range are invalid', () => {
    it('tilt 90.0001 is invalid', () => {
      expect(validateField('tiltDeg', '90.0001')).toMatch(/at most 90/i)
    })

    it('azimuth 360.1 is invalid', () => {
      expect(validateField('azimuthDeg', '360.1')).toMatch(/at most 360/i)
    })

    it('panel count 100001 is invalid', () => {
      expect(validateField('panelCount', '100001')).toMatch(/at most 100000/i)
    })

    it('temperature coefficient 0.0001 is invalid', () => {
      expect(validateField('tempCoefficientPercentPerC', '0.0001')).toMatch(
        /at most 0/i,
      )
    })

    it('watts per panel 0 is invalid', () => {
      expect(validateField('wattsPerPanel', '0')).toMatch(/greater than 0/i)
    })
  })

  describe('numeric-lookalike input is rejected rather than silently parsed', () => {
    it('rejects hex-lookalike input instead of parsing it as a decimal number', () => {
      // Number('0x10') === 16, which would silently accept a hex literal
      // as a panel count of 16 without this check.
      expect(validateField('panelCount', '0x10')).toMatch(/must be a number/i)
    })

    it('rejects scientific notation instead of parsing it as a decimal number', () => {
      // Number('1e3') === 1000.
      expect(validateField('panelCount', '1e3')).toMatch(/must be a number/i)
    })

    it('parseFieldOrFallback also refuses hex-lookalike input, falling back instead', () => {
      expect(parseFieldOrFallback('0x10', 0)).toBe(0)
    })
  })
})
