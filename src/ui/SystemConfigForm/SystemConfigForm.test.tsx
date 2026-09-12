import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PANEL_PRESETS } from '../../panel-presets'
import { SystemConfigForm } from './SystemConfigForm'
import type { SystemConfig } from './types'

function getLastCall(onChange: ReturnType<typeof vi.fn>) {
  return onChange.mock.calls[onChange.mock.calls.length - 1] as [
    SystemConfig,
    boolean,
  ]
}

describe('SystemConfigForm', () => {
  let onChange: ReturnType<
    typeof vi.fn<(config: SystemConfig, isValid: boolean) => void>
  >

  beforeEach(() => {
    onChange = vi.fn()
  })

  it('reports a valid initial config on mount', () => {
    render(<SystemConfigForm onChange={onChange} />)
    expect(onChange).toHaveBeenCalled()
    const [config, isValid] = getLastCall(onChange)
    expect(isValid).toBe(true)
    expect(config.presetId).toBeNull()
  })

  describe('preset prefill', () => {
    it('prefills efficiency and temperature coefficient from the selected preset', async () => {
      const user = userEvent.setup()
      render(<SystemConfigForm onChange={onChange} />)

      const preset = PANEL_PRESETS[0]
      await user.selectOptions(
        screen.getByLabelText(/panel preset/i),
        preset.id,
      )

      const [config, isValid] = getLastCall(onChange)
      expect(config.presetId).toBe(preset.id)
      expect(config.efficiencyPercent).toBe(preset.efficiencyPercent)
      expect(config.tempCoefficientPercentPerC).toBe(
        preset.tempCoefficientPercentPerC,
      )
      expect(isValid).toBe(true)
    })

    it('re-prefills when switching between presets', async () => {
      const user = userEvent.setup()
      render(<SystemConfigForm onChange={onChange} />)

      const [first, second] = PANEL_PRESETS
      await user.selectOptions(screen.getByLabelText(/panel preset/i), first.id)
      await user.selectOptions(
        screen.getByLabelText(/panel preset/i),
        second.id,
      )

      const [config] = getLastCall(onChange)
      expect(config.presetId).toBe(second.id)
      expect(config.efficiencyPercent).toBe(second.efficiencyPercent)
      expect(config.tempCoefficientPercentPerC).toBe(
        second.tempCoefficientPercentPerC,
      )
    })

    it('switching to "Custom" clears the selected preset id without changing field values', async () => {
      const user = userEvent.setup()
      render(<SystemConfigForm onChange={onChange} />)

      const preset = PANEL_PRESETS[0]
      await user.selectOptions(
        screen.getByLabelText(/panel preset/i),
        preset.id,
      )
      await user.selectOptions(screen.getByLabelText(/panel preset/i), '')

      const [config] = getLastCall(onChange)
      expect(config.presetId).toBeNull()
      expect(config.efficiencyPercent).toBe(preset.efficiencyPercent)
    })
  })

  describe('fields stay editable after a preset is chosen', () => {
    it('allows editing every field after selecting a preset, and clears presetId once edited', async () => {
      const user = userEvent.setup()
      render(<SystemConfigForm onChange={onChange} />)

      await user.selectOptions(
        screen.getByLabelText(/panel preset/i),
        PANEL_PRESETS[0].id,
      )

      const editableFields: Array<[RegExp, string]> = [
        [/tilt/i, '25'],
        [/azimuth/i, '90'],
        [/panel count/i, '12'],
        [/efficiency/i, '19.5'],
        [/temperature coefficient/i, '-0.4'],
        [/system losses/i, '10'],
        [/manual shading/i, '5'],
      ]

      for (const [labelPattern, newValue] of editableFields) {
        const input = screen.getByLabelText(labelPattern)
        expect(input).not.toBeDisabled()
        await user.clear(input)
        await user.type(input, newValue)
      }

      const [config, isValid] = getLastCall(onChange)
      expect(config).toMatchObject({
        presetId: null,
        tiltDeg: 25,
        azimuthDeg: 90,
        panelCount: 12,
        efficiencyPercent: 19.5,
        tempCoefficientPercentPerC: -0.4,
        systemLossesPercent: 10,
        manualShadingPercent: 5,
      })
      expect(isValid).toBe(true)
    })
  })

  describe('validation', () => {
    async function setField(labelPattern: RegExp, value: string) {
      const user = userEvent.setup()
      const input = screen.getByLabelText(labelPattern)
      await user.clear(input)
      if (value !== '') {
        await user.type(input, value)
      }
      return input
    }

    it('flags tilt above 90 as invalid and does not clamp it', async () => {
      render(<SystemConfigForm onChange={onChange} />)
      await setField(/tilt/i, '120')

      expect(screen.getByRole('alert')).toHaveTextContent(/at most 90/i)
      const [config, isValid] = getLastCall(onChange)
      expect(config.tiltDeg).toBe(120)
      expect(isValid).toBe(false)
    })

    it('flags negative tilt as invalid', async () => {
      render(<SystemConfigForm onChange={onChange} />)
      await setField(/tilt/i, '-5')

      expect(screen.getByRole('alert')).toHaveTextContent(/at least 0/i)
      expect(getLastCall(onChange)[1]).toBe(false)
    })

    it('flags azimuth outside 0-360 as invalid', async () => {
      render(<SystemConfigForm onChange={onChange} />)
      await setField(/azimuth/i, '400')

      expect(screen.getByRole('alert')).toHaveTextContent(/at most 360/i)
      expect(getLastCall(onChange)[1]).toBe(false)
    })

    it('flags negative panel count as invalid', async () => {
      render(<SystemConfigForm onChange={onChange} />)
      await setField(/panel count/i, '-3')

      expect(screen.getByRole('alert')).toHaveTextContent(/greater than 0/i)
      expect(getLastCall(onChange)[1]).toBe(false)
    })

    it('flags zero panel count as invalid', async () => {
      render(<SystemConfigForm onChange={onChange} />)
      await setField(/panel count/i, '0')

      expect(getLastCall(onChange)[1]).toBe(false)
    })

    it('flags a non-integer panel count as invalid', async () => {
      render(<SystemConfigForm onChange={onChange} />)
      await setField(/panel count/i, '3.5')

      expect(screen.getByRole('alert')).toHaveTextContent(/whole number/i)
      expect(getLastCall(onChange)[1]).toBe(false)
    })

    it('flags efficiency outside 0-100 as invalid', async () => {
      render(<SystemConfigForm onChange={onChange} />)
      await setField(/efficiency/i, '150')

      expect(screen.getByRole('alert')).toHaveTextContent(/at most 100/i)
      expect(getLastCall(onChange)[1]).toBe(false)
    })

    it('flags system losses outside 0-100 as invalid', async () => {
      render(<SystemConfigForm onChange={onChange} />)
      await setField(/system losses/i, '-1')

      expect(screen.getByRole('alert')).toHaveTextContent(/at least 0/i)
      expect(getLastCall(onChange)[1]).toBe(false)
    })

    it('flags manual shading outside 0-100 as invalid', async () => {
      render(<SystemConfigForm onChange={onChange} />)
      await setField(/manual shading/i, '101')

      expect(screen.getByRole('alert')).toHaveTextContent(/at most 100/i)
      expect(getLastCall(onChange)[1]).toBe(false)
    })

    it('flags an empty required field as invalid', async () => {
      render(<SystemConfigForm onChange={onChange} />)
      await setField(/tilt/i, '')

      expect(screen.getByRole('alert')).toHaveTextContent(/required/i)
      expect(getLastCall(onChange)[1]).toBe(false)
    })

    it('flags a non-numeric field as invalid', async () => {
      const user = userEvent.setup()
      render(<SystemConfigForm onChange={onChange} />)
      const input = screen.getByLabelText(/panel count/i)
      await user.clear(input)
      await user.type(input, 'abc')

      // number inputs generally reject non-numeric text, but the
      // component must still not report a valid config if it does end up
      // getting through (e.g. via paste in a real browser).
      const [, isValid] = getLastCall(onChange)
      if (input.getAttribute('value') === 'abc') {
        expect(isValid).toBe(false)
      } else {
        // Browser-level input coercion left it empty -> required error.
        expect(screen.getByRole('alert')).toBeInTheDocument()
      }
    })

    it('accepts a negative temperature coefficient without flagging it', async () => {
      render(<SystemConfigForm onChange={onChange} />)
      await setField(/temperature coefficient/i, '-0.45')

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      const [config, isValid] = getLastCall(onChange)
      expect(config.tempCoefficientPercentPerC).toBe(-0.45)
      expect(isValid).toBe(true)
    })

    it('recovers to valid once an out-of-range value is corrected', async () => {
      const user = userEvent.setup()
      render(<SystemConfigForm onChange={onChange} />)
      const input = screen.getByLabelText(/tilt/i)
      await user.clear(input)
      await user.type(input, '999')
      expect(getLastCall(onChange)[1]).toBe(false)

      await user.clear(input)
      await user.type(input, '45')
      expect(getLastCall(onChange)[1]).toBe(true)
    })
  })

  describe('azimuth compass indicator', () => {
    it('shows a compass label alongside the azimuth value', async () => {
      render(<SystemConfigForm onChange={onChange} />)
      // Default azimuth is 180 -> south.
      expect(screen.getByText(/180° \(S\)/)).toBeInTheDocument()
    })

    it('updates the compass label as azimuth changes', async () => {
      const user = userEvent.setup()
      render(<SystemConfigForm onChange={onChange} />)
      const input = screen.getByLabelText(/azimuth/i)
      await user.clear(input)
      await user.type(input, '90')

      expect(screen.getByText(/90° \(E\)/)).toBeInTheDocument()
    })
  })

  it('accepts a custom preset list', () => {
    const customPresets = [
      {
        id: 'test-panel',
        make: 'TestCo',
        model: 'X1',
        ratedWattsPeak: 300,
        efficiencyPercent: 18,
        tempCoefficientPercentPerC: -0.3,
        isGeneric: false,
        notes: '',
      },
    ]
    render(<SystemConfigForm presets={customPresets} onChange={onChange} />)
    expect(screen.getByText('TestCo X1')).toBeInTheDocument()
  })
})
