import { describe, expect, it } from 'vitest'
import { suggestAzimuth } from '../derive'
import type { TracedShape } from '../tracing'
import { defaultFieldValuesFor, ROOF_TILT_PRESETS } from './defaults'
import type { ConfigureShapesLocation } from './types'

const roofPolygon = [
  { lat: 51.5, lon: -0.1 },
  { lat: 51.5, lon: -0.099 },
  { lat: 51.501, lon: -0.099 },
  { lat: 51.501, lon: -0.1 },
]

const roofFace: TracedShape = {
  id: 'roof-1',
  kind: 'roof-face',
  polygon: roofPolygon,
}

const groundArray: TracedShape = {
  id: 'ground-1',
  kind: 'ground-array',
  polygon: [
    { lat: 51.5, lon: -0.11 },
    { lat: 51.5, lon: -0.108 },
    { lat: 51.502, lon: -0.108 },
    { lat: 51.502, lon: -0.11 },
  ],
}

describe('defaultFieldValuesFor', () => {
  it('gives a roof face the medium tilt preset and the suggested azimuth', () => {
    const location: ConfigureShapesLocation = { lat: 51.5, lon: -0.1 }
    const values = defaultFieldValuesFor(roofFace, location)

    expect(Number(values.tiltDeg)).toBe(30)
    expect(values.tiltDeg).toBe(
      String(
        ROOF_TILT_PRESETS.find((p) => p.label.includes('Medium'))!.tiltDeg,
      ),
    )
    expect(Number(values.azimuthDeg)).toBe(suggestAzimuth(roofPolygon))
  })

  it('gives a northern-hemisphere ground array a south-facing azimuth default', () => {
    const location: ConfigureShapesLocation = { lat: 51.5, lon: -0.1 }
    const values = defaultFieldValuesFor(groundArray, location)

    expect(values.azimuthDeg).toBe('180')
    expect(Number(values.tiltDeg)).toBe(Math.round(Math.abs(location.lat)))
  })

  it('gives a southern-hemisphere ground array a north-facing azimuth default', () => {
    const location: ConfigureShapesLocation = { lat: -33.87, lon: 151.2 }
    const values = defaultFieldValuesFor(groundArray, location)

    expect(values.azimuthDeg).toBe('0')
    expect(Number(values.tiltDeg)).toBe(Math.round(Math.abs(location.lat)))
  })

  it('gives an equator ground array a north-facing default (lat >= 0 convention)', () => {
    const location: ConfigureShapesLocation = { lat: 0, lon: 10 }
    const values = defaultFieldValuesFor(groundArray, location)

    expect(values.azimuthDeg).toBe('180')
    expect(values.tiltDeg).toBe('0')
  })

  it('clamps an extreme-latitude ground array tilt default to 90', () => {
    const location: ConfigureShapesLocation = { lat: 90, lon: 0 }
    const values = defaultFieldValuesFor(groundArray, location)

    expect(values.tiltDeg).toBe('90')
  })
})
