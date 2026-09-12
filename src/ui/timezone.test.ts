import { describe, expect, it } from 'vitest'
import { approximateTimezone } from './timezone'

describe('approximateTimezone', () => {
  it('returns UTC+0 near the prime meridian', () => {
    expect(approximateTimezone(0)).toBe('UTC+0')
    expect(approximateTimezone(2.3522)).toBe('UTC+0')
  })

  it('rounds to the nearest 15° band for a positive longitude', () => {
    expect(approximateTimezone(13.3889)).toBe('UTC+1')
  })

  it('rounds to the nearest 15° band for a negative longitude', () => {
    expect(approximateTimezone(-73.9)).toBe('UTC-5')
  })

  it('clamps to the real range of UTC offsets', () => {
    expect(approximateTimezone(250)).toBe('UTC+14')
    expect(approximateTimezone(-250)).toBe('UTC-12')
  })
})
