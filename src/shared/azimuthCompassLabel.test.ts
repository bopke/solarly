import { describe, expect, it } from 'vitest'
import { azimuthCompassLabel } from './azimuthCompassLabel'

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
