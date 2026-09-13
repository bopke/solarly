import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Heatmap } from './Heatmap'
import { powerToColor } from './heatmapColorScale'
import type {
  HourlyPoint,
  MonthlySimulation,
  TmySimulationResult,
} from '../simulation/types'

function makeHourly(peakW: number): HourlyPoint[] {
  // A simple daytime bell curve peaking at noon (hour 12), zero overnight —
  // enough shape for "known high cell" (noon) vs "known low cell" (midnight)
  // assertions without needing real physics output.
  return Array.from({ length: 24 }, (_, hour) => {
    const isDaylight = hour >= 6 && hour <= 18
    const distanceFromNoon = Math.abs(hour - 12)
    const powerW = isDaylight
      ? peakW * Math.max(0, 1 - distanceFromNoon / 6)
      : 0
    return { hour, poaIrradianceWm2: powerW, powerW }
  })
}

function makeMonth(month: number, peakW: number): MonthlySimulation {
  return {
    month,
    dayOfYear: month * 30 - 15,
    ambientTemperatureC: 20,
    clearnessFactor: 0.8,
    representativeDayHourly: makeHourly(peakW),
    representativeDayTotalKWh: peakW * 6, // rough, unused by the component
    daysInMonth: 30,
    monthlyTotalKWh: peakW * 6 * 30,
  }
}

function makeResult(months: MonthlySimulation[]): TmySimulationResult {
  return {
    mode: 'tmy',
    location: { lat: 33.45, lon: -112.07 },
    systemConfig: {
      arrays: [
        {
          tiltDeg: 20,
          azimuthDeg: 180,
          panelCount: 20,
          wattsPerPanel: 400,
          efficiencyPercent: 20,
          tempCoefficientPercentPerC: -0.35,
          manualShadingPercent: 0,
        },
      ],
      systemLossesPercent: 14,
    },
    referenceYear: 2025,
    months,
    annualTotalKWh: months.reduce((sum, m) => sum + m.monthlyTotalKWh, 0),
  }
}

describe('Heatmap', () => {
  it('renders an empty state when there is no simulation result', () => {
    render(<Heatmap result={undefined} />)
    expect(screen.getByText(/no heatmap data yet/i)).toBeInTheDocument()
  })

  it('renders an empty state when the result has no months', () => {
    render(<Heatmap result={makeResult([])} />)
    expect(screen.getByText(/no heatmap data yet/i)).toBeInTheDocument()
  })

  it('renders a cell per hour for every month, labeled by month', () => {
    const result = makeResult([makeMonth(1, 3000), makeMonth(7, 5000)])
    render(<Heatmap result={result} />)

    expect(screen.getByText('Jan')).toBeInTheDocument()
    expect(screen.getByText('Jul')).toBeInTheDocument()

    // 2 months x 24 hours = 48 cells.
    const cells = document.querySelectorAll('[data-testid^="heatmap-cell-"]')
    expect(cells).toHaveLength(48)
  })

  it('gives a high-power cell a distinctly darker color than a low-power cell', () => {
    const result = makeResult([makeMonth(6, 5000)])
    render(<Heatmap result={result} />)

    const noonCell = document.querySelector('[data-testid="heatmap-cell-6-12"]')
    const midnightCell = document.querySelector(
      '[data-testid="heatmap-cell-6-0"]',
    )
    expect(noonCell).not.toBeNull()
    expect(midnightCell).not.toBeNull()

    const noonFill = noonCell?.getAttribute('fill')
    const midnightFill = midnightCell?.getAttribute('fill')
    expect(noonFill).not.toBe(midnightFill)

    // Midnight has zero power -> the lightest ramp stop; noon is the
    // month's max -> the darkest ramp stop. Assert against the color scale
    // directly rather than hardcoding RGB values here.
    expect(midnightFill).toBe(powerToColor(0, 5000))
    expect(noonFill).toBe(powerToColor(5000, 5000))
    expect(noonFill).not.toBe(midnightFill)
  })

  it('renders a legend showing the power range', () => {
    const result = makeResult([makeMonth(3, 4200)])
    render(<Heatmap result={result} />)

    expect(screen.getByText('0 W')).toBeInTheDocument()
    expect(screen.getByText('4200 W')).toBeInTheDocument()
  })
})

describe('powerToColor', () => {
  it('maps 0 to the lightest ramp stop and max to the darkest', () => {
    expect(powerToColor(0, 1000)).toBe('#cde2fb')
    expect(powerToColor(1000, 1000)).toBe('#0d366b')
  })

  it('produces a monotonically darkening color as value increases', () => {
    // A crude "darker" proxy: sum of RGB channels decreases as value rises.
    const toChannelSum = (rgbOrHex: string) => {
      if (rgbOrHex.startsWith('#')) {
        const n = parseInt(rgbOrHex.slice(1), 16)
        return ((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff)
      }
      const [r, g, b] = rgbOrHex.match(/\d+/g)!.map(Number)
      return r + g + b
    }

    const low = toChannelSum(powerToColor(100, 1000))
    const mid = toChannelSum(powerToColor(500, 1000))
    const high = toChannelSum(powerToColor(900, 1000))
    expect(low).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(high)
  })

  it('clamps out-of-range and degenerate inputs gracefully', () => {
    expect(powerToColor(-50, 1000)).toBe('#cde2fb')
    expect(powerToColor(2000, 1000)).toBe('#0d366b')
    expect(powerToColor(500, 0)).toBe('#cde2fb')
    expect(powerToColor(NaN, 1000)).toBe('#cde2fb')
  })
})
