import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { suggestAzimuth } from '../derive'
import type { TracedShape } from '../tracing'
import { ConfigureShapes } from './ConfigureShapes'
import type { ConfigureShapesLocation, ShapeConfig } from './types'

function getLastCall(onChange: ReturnType<typeof vi.fn>) {
  return onChange.mock.calls[onChange.mock.calls.length - 1] as [
    ShapeConfig[],
    boolean,
  ]
}

const roofPolygon = [
  { lat: 40.0, lon: -74.0 },
  { lat: 40.0, lon: -73.999 },
  { lat: 40.001, lon: -73.999 },
  { lat: 40.001, lon: -74.0 },
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
    { lat: 40.0, lon: -74.01 },
    { lat: 40.0, lon: -74.008 },
    { lat: 40.002, lon: -74.008 },
    { lat: 40.002, lon: -74.01 },
  ],
}

const NORTHERN_LOCATION: ConfigureShapesLocation = { lat: 40.7, lon: -74.0 }
const SOUTHERN_LOCATION: ConfigureShapesLocation = { lat: -33.9, lon: 151.2 }

describe('ConfigureShapes', () => {
  let onChange: ReturnType<
    typeof vi.fn<(configs: ShapeConfig[], isValid: boolean) => void>
  >

  beforeEach(() => {
    onChange = vi.fn()
  })

  describe('roof-face pre-fill', () => {
    it('pre-fills azimuth from suggestAzimuth and a preset tilt, and reports a valid config on mount', () => {
      render(
        <ConfigureShapes
          shapes={[roofFace]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      expect(onChange).toHaveBeenCalled()
      const [configs, isValid] = getLastCall(onChange)
      expect(isValid).toBe(true)
      expect(configs).toEqual([
        {
          shapeId: 'roof-1',
          tiltDeg: 30,
          azimuthDeg: suggestAzimuth(roofPolygon),
        },
      ])
    })

    it('renders tilt preset buttons and free entry for a roof face', () => {
      render(
        <ConfigureShapes
          shapes={[roofFace]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      expect(
        screen.getByRole('button', { name: /shallow/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /medium/i }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /steep/i })).toBeInTheDocument()
      expect(screen.getByLabelText(/tilt.*roof face 1/i)).toBeInTheDocument()
    })

    it('clicking a preset button sets the tilt field and is reflected in onChange', async () => {
      const user = userEvent.setup()
      render(
        <ConfigureShapes
          shapes={[roofFace]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      await user.click(screen.getByRole('button', { name: /steep/i }))

      const [configs] = getLastCall(onChange)
      expect(configs[0].tiltDeg).toBe(45)
      expect(screen.getByLabelText(/tilt.*roof face 1/i)).toHaveValue(45)
    })

    it('free numeric entry overrides the tilt preset', async () => {
      const user = userEvent.setup()
      render(
        <ConfigureShapes
          shapes={[roofFace]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      const input = screen.getByLabelText(/tilt.*roof face 1/i)
      await user.clear(input)
      await user.type(input, '22')

      expect(getLastCall(onChange)[0][0].tiltDeg).toBe(22)
    })

    it('editing the azimuth field overrides the suggested value', async () => {
      const user = userEvent.setup()
      render(
        <ConfigureShapes
          shapes={[roofFace]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      const input = screen.getByLabelText(/azimuth.*roof face 1/i)
      await user.clear(input)
      await user.type(input, '200')

      expect(getLastCall(onChange)[0][0].azimuthDeg).toBe(200)
    })
  })

  describe('ground-array pre-fill', () => {
    it('defaults tilt to the rounded absolute latitude and azimuth to 180 (south) in the northern hemisphere', () => {
      render(
        <ConfigureShapes
          shapes={[groundArray]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      const [configs, isValid] = getLastCall(onChange)
      expect(isValid).toBe(true)
      expect(configs).toEqual([
        { shapeId: 'ground-1', tiltDeg: 41, azimuthDeg: 180 },
      ])
    })

    it('defaults azimuth to 0 (north) in the southern hemisphere', () => {
      render(
        <ConfigureShapes
          shapes={[groundArray]}
          location={SOUTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      const [configs] = getLastCall(onChange)
      expect(configs[0]).toEqual({
        shapeId: 'ground-1',
        tiltDeg: 34,
        azimuthDeg: 0,
      })
    })

    it('does not render tilt preset buttons for a ground array', () => {
      render(
        <ConfigureShapes
          shapes={[groundArray]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      expect(
        screen.queryByRole('button', { name: /shallow/i }),
      ).not.toBeInTheDocument()
    })

    it('both tilt and azimuth stay editable', async () => {
      const user = userEvent.setup()
      render(
        <ConfigureShapes
          shapes={[groundArray]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      const tiltInput = screen.getByLabelText(/tilt.*ground array 1/i)
      await user.clear(tiltInput)
      await user.type(tiltInput, '25')

      const azimuthInput = screen.getByLabelText(/azimuth.*ground array 1/i)
      await user.clear(azimuthInput)
      await user.type(azimuthInput, '170')

      const [configs] = getLastCall(onChange)
      expect(configs[0]).toEqual({
        shapeId: 'ground-1',
        tiltDeg: 25,
        azimuthDeg: 170,
      })
    })
  })

  describe('multiple shapes', () => {
    it('renders and independently configures one fieldset per shape, in order', () => {
      render(
        <ConfigureShapes
          shapes={[roofFace, groundArray]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      const [configs] = getLastCall(onChange)
      expect(configs.map((c) => c.shapeId)).toEqual(['roof-1', 'ground-1'])
      expect(
        screen.getByRole('group', { name: /roof face 1/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('group', { name: /ground array 2/i }),
      ).toBeInTheDocument()
    })

    it('editing one shape does not affect another', async () => {
      const user = userEvent.setup()
      render(
        <ConfigureShapes
          shapes={[roofFace, groundArray]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      const roofFieldset = screen.getByRole('group', { name: /roof face 1/i })
      const tiltInput = within(roofFieldset).getByLabelText(/tilt/i)
      await user.clear(tiltInput)
      await user.type(tiltInput, '12')

      const [configs] = getLastCall(onChange)
      const roofConfig = configs.find((c) => c.shapeId === 'roof-1')
      const groundConfig = configs.find((c) => c.shapeId === 'ground-1')
      expect(roofConfig?.tiltDeg).toBe(12)
      expect(groundConfig?.tiltDeg).toBe(41)
    })

    it('reports overall isValid=false when only one of several shapes is invalid', async () => {
      const user = userEvent.setup()
      render(
        <ConfigureShapes
          shapes={[roofFace, groundArray]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      const roofFieldset = screen.getByRole('group', { name: /roof face 1/i })
      const tiltInput = within(roofFieldset).getByLabelText(/tilt/i)
      await user.clear(tiltInput)
      await user.type(tiltInput, '999')

      expect(getLastCall(onChange)[1]).toBe(false)

      await user.clear(tiltInput)
      await user.type(tiltInput, '30')
      expect(getLastCall(onChange)[1]).toBe(true)
    })
  })

  describe('validation', () => {
    it('flags tilt above 90 as invalid and does not clamp it', async () => {
      const user = userEvent.setup()
      render(
        <ConfigureShapes
          shapes={[roofFace]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      const input = screen.getByLabelText(/tilt.*roof face 1/i)
      await user.clear(input)
      await user.type(input, '120')

      expect(screen.getByRole('alert')).toHaveTextContent(/at most 90/i)
      const [configs, isValid] = getLastCall(onChange)
      expect(configs[0].tiltDeg).toBe(120)
      expect(isValid).toBe(false)
    })

    it('flags negative tilt as invalid', async () => {
      const user = userEvent.setup()
      render(
        <ConfigureShapes
          shapes={[roofFace]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      const input = screen.getByLabelText(/tilt.*roof face 1/i)
      await user.clear(input)
      await user.type(input, '-5')

      expect(screen.getByRole('alert')).toHaveTextContent(/at least 0/i)
      expect(getLastCall(onChange)[1]).toBe(false)
    })

    it('flags azimuth outside 0-360 as invalid', async () => {
      const user = userEvent.setup()
      render(
        <ConfigureShapes
          shapes={[roofFace]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      const input = screen.getByLabelText(/azimuth.*roof face 1/i)
      await user.clear(input)
      await user.type(input, '400')

      expect(screen.getByRole('alert')).toHaveTextContent(/at most 360/i)
      expect(getLastCall(onChange)[1]).toBe(false)
    })

    it('flags an empty required field as invalid', async () => {
      const user = userEvent.setup()
      render(
        <ConfigureShapes
          shapes={[roofFace]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      const input = screen.getByLabelText(/tilt.*roof face 1/i)
      await user.clear(input)

      expect(screen.getByRole('alert')).toHaveTextContent(/required/i)
      expect(getLastCall(onChange)[1]).toBe(false)
    })

    it('recovers to valid once an out-of-range value is corrected', async () => {
      const user = userEvent.setup()
      render(
        <ConfigureShapes
          shapes={[roofFace]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      const input = screen.getByLabelText(/tilt.*roof face 1/i)
      await user.clear(input)
      await user.type(input, '999')
      expect(getLastCall(onChange)[1]).toBe(false)

      await user.clear(input)
      await user.type(input, '45')
      expect(getLastCall(onChange)[1]).toBe(true)
    })
  })

  describe('azimuth compass indicator', () => {
    it('shows a compass label alongside the ground-array azimuth value', () => {
      render(
        <ConfigureShapes
          shapes={[groundArray]}
          location={NORTHERN_LOCATION}
          onChange={onChange}
        />,
      )

      expect(screen.getByText(/180° \(S\)/)).toBeInTheDocument()
    })
  })

  describe('initialConfigs', () => {
    it('seeds fields from initialConfigs instead of the computed defaults', () => {
      render(
        <ConfigureShapes
          shapes={[groundArray]}
          location={NORTHERN_LOCATION}
          initialConfigs={{ 'ground-1': { tiltDeg: 12, azimuthDeg: 190 } }}
          onChange={onChange}
        />,
      )

      const [configs] = getLastCall(onChange)
      expect(configs[0]).toEqual({
        shapeId: 'ground-1',
        tiltDeg: 12,
        azimuthDeg: 190,
      })
    })
  })

  it('reports an empty, valid config list when there are no shapes', () => {
    render(
      <ConfigureShapes
        shapes={[]}
        location={NORTHERN_LOCATION}
        onChange={onChange}
      />,
    )

    const [configs, isValid] = getLastCall(onChange)
    expect(configs).toEqual([])
    expect(isValid).toBe(true)
  })
})
