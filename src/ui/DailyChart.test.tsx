import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DailyChart } from './DailyChart'
import type {
  HourlyPoint,
  MonthlySimulation,
  TmySimulationResult,
} from '../simulation'

function makeHourly(peakW: number): HourlyPoint[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    poaIrradianceWm2: hour >= 6 && hour <= 18 ? 100 * (peakW / 1000) : 0,
    powerW:
      hour >= 6 && hour <= 18
        ? peakW * Math.sin(((hour - 6) / 12) * Math.PI)
        : 0,
  }))
}

function makeMonth(month: number, peakW: number): MonthlySimulation {
  return {
    month,
    dayOfYear: month * 30,
    ambientTemperatureC: 15,
    clearnessFactor: 0.8,
    representativeDayHourly: makeHourly(peakW),
    representativeDayTotalKWh: peakW / 1000,
    daysInMonth: 30,
    monthlyTotalKWh: (peakW / 1000) * 30,
  }
}

function makeResult(months: MonthlySimulation[]): TmySimulationResult {
  return {
    mode: 'tmy',
    location: { lat: 52.2, lon: 21.0 },
    systemConfig: {
      arrays: [
        {
          tiltDeg: 30,
          azimuthDeg: 180,
          panelCount: 10,
          wattsPerPanel: 400,
          efficiencyPercent: 20,
          tempCoefficientPercentPerC: -0.35,
          manualShadingPercent: 0,
        },
      ],
      systemLossesPercent: 14,
    },
    referenceYear: 2020,
    months,
    annualTotalKWh: months.reduce((sum, m) => sum + m.monthlyTotalKWh, 0),
  }
}

describe('DailyChart', () => {
  it('renders the first available month by default, with its slider label and summary', () => {
    const result = makeResult([makeMonth(1, 3000), makeMonth(6, 5000)])
    render(<DailyChart result={result} />)

    expect(screen.getAllByText(/January/).length).toBeGreaterThan(0)
    expect(screen.getByText(/3\.0 kWh on this day/)).toBeInTheDocument()
    expect(screen.getByText(/90 kWh estimated for/)).toBeInTheDocument()
  })

  it('switches the displayed month when the slider is moved', () => {
    const result = makeResult([
      makeMonth(1, 3000),
      makeMonth(6, 5000),
      makeMonth(12, 1000),
    ])
    render(<DailyChart result={result} />)

    const slider = screen.getByLabelText(/Representative day/i)
    expect(slider).toHaveValue('0')

    fireEvent.change(slider, { target: { value: '1' } })
    expect(screen.getAllByText(/June/).length).toBeGreaterThan(0)
    expect(screen.getByText(/5\.0 kWh on this day/)).toBeInTheDocument()

    fireEvent.change(slider, { target: { value: '2' } })
    expect(screen.getAllByText(/December/).length).toBeGreaterThan(0)
  })

  it('disables the slider when only one month is available', () => {
    const result = makeResult([makeMonth(3, 2000)])
    render(<DailyChart result={result} />)

    expect(screen.getByLabelText(/Representative day/i)).toBeDisabled()
    expect(screen.getAllByText(/March/).length).toBeGreaterThan(0)
  })

  it('renders a graceful empty state when the result is undefined', () => {
    render(<DailyChart result={undefined} />)

    expect(
      screen.getByText(/No simulation data available for this location yet\./i),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText(/Representative day/i),
    ).not.toBeInTheDocument()
  })

  it('renders a graceful empty state when months is an empty array', () => {
    const result = makeResult([])
    render(<DailyChart result={result} />)

    expect(
      screen.getByText(/No simulation data available for this location yet\./i),
    ).toBeInTheDocument()
  })
})
