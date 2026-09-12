import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MonthlyChartTab } from './MonthlyChartTab'
import type { MonthlySimulation, SimulationResult } from '../simulation/types'

const BASE_LOCATION = { lat: 45, lon: 10 }
const BASE_SYSTEM_CONFIG = {
  tiltDeg: 30,
  azimuthDeg: 180,
  panelCount: 10,
  wattsPerPanel: 400,
  efficiencyPercent: 20,
  tempCoefficientPercentPerC: -0.35,
  systemLossesPercent: 14,
  manualShadingPercent: 0,
}

function makeMonth(month: number, monthlyTotalKWh: number): MonthlySimulation {
  return {
    month,
    dayOfYear: month * 30,
    ambientTemperatureC: 15,
    clearnessFactor: 0.6,
    representativeDayHourly: [],
    representativeDayTotalKWh: monthlyTotalKWh / 30,
    daysInMonth: 30,
    monthlyTotalKWh,
  }
}

function makeResult(months: MonthlySimulation[]): SimulationResult {
  return {
    location: BASE_LOCATION,
    systemConfig: BASE_SYSTEM_CONFIG,
    referenceYear: 2025,
    months,
    annualTotalKWh: months.reduce((sum, m) => sum + m.monthlyTotalKWh, 0),
  }
}

describe('MonthlyChartTab', () => {
  it('renders a bar per month for a full 12-month result', () => {
    const months = Array.from({ length: 12 }, (_, i) =>
      makeMonth(i + 1, 100 + i),
    )
    const result = makeResult(months)

    const { container } = render(<MonthlyChartTab result={result} />)

    const bars = container.querySelectorAll('.recharts-bar-rectangle')
    expect(bars.length).toBe(12)

    // All 12 month labels are present on the x-axis.
    for (const label of [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]) {
      // Scoped to `container`: Recharts appends a shared, reused,
      // aria-hidden text-measurement span directly to `document.body`
      // (outside the render container) for measuring tick label widths,
      // which would otherwise duplicate-match whichever label it last
      // measured.
      expect(within(container).getByText(label)).toBeInTheDocument()
    }
  })

  it('displays the annual total prominently', () => {
    const months = Array.from({ length: 12 }, (_, i) => makeMonth(i + 1, 100))
    const result = makeResult(months)

    render(<MonthlyChartTab result={result} />)

    expect(screen.getByText('Estimated annual total')).toBeInTheDocument()
    // annualTotalKWh = 12 * 100 = 1200
    expect(screen.getByText('1,200 kWh')).toBeInTheDocument()
  })

  it('renders all 12 x-axis slots even with a sparse/partial month set (high-latitude edge case)', () => {
    // Only 3 months of usable NASA POWER data — see SimulationResult.months'
    // doc: "1-12 entries... months may be dropped".
    const months = [makeMonth(5, 50), makeMonth(6, 80), makeMonth(7, 90)]
    const result = makeResult(months)

    const { container } = render(<MonthlyChartTab result={result} />)

    // Recharts itself filters zero-height bars from the DOM (by design —
    // see `Bar.js`'s "filter out 0-dimension rectangles" comment), so only
    // the 3 non-zero months draw a visible rectangle...
    const bars = container.querySelectorAll('.recharts-bar-rectangle')
    expect(bars.length).toBe(3)

    // ...but the x-axis itself is never compressed down to those 3 months:
    // all 12 month labels still occupy their normal calendar slot, with
    // the missing months' 0 value implicit in their absent bar.
    for (const label of [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]) {
      expect(within(container).getByText(label)).toBeInTheDocument()
    }

    // Annual total still reflects only the months present.
    expect(screen.getByText('220 kWh')).toBeInTheDocument()
  })

  it('renders an empty message when result is undefined', () => {
    render(<MonthlyChartTab result={undefined} />)

    expect(screen.getByText(/no monthly data available/i)).toBeInTheDocument()
    expect(screen.queryByText('Estimated annual total')).not.toBeInTheDocument()
  })

  it('renders an empty message when result has no months', () => {
    const result = makeResult([])

    render(<MonthlyChartTab result={result} />)

    expect(screen.getByText(/no monthly data available/i)).toBeInTheDocument()
  })
})
