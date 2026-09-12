import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ForecastChart } from './ForecastChart'
import type { HourlyPowerPoint, LiveSimulationResult } from '../simulation'

const LOCATION = { lat: 52.52, lon: 13.41 }

function makeResult(
  hourlyWattsSeries: HourlyPowerPoint[],
): LiveSimulationResult {
  return { mode: 'live', location: LOCATION, hourlyWattsSeries }
}

/** Builds a contiguous hourly series spanning `hours` hours from a fixed start. */
function contiguousSeries(hours: number): HourlyPowerPoint[] {
  const start = Date.parse('2026-09-12T00:00:00Z')
  return Array.from({ length: hours }, (_, i) => {
    const hourOfDay = i % 24
    // Rough daylight-shaped curve so watts isn't a flat line — not
    // physically accurate, just varied sample data.
    const watts =
      hourOfDay >= 6 && hourOfDay <= 18
        ? Math.round(1000 * Math.sin(((hourOfDay - 6) / 12) * Math.PI))
        : 0
    return {
      timestamp: new Date(start + i * 3_600_000).toISOString(),
      watts,
    }
  })
}

describe('ForecastChart', () => {
  it('renders a chart for a valid multi-day series', () => {
    // 5 days * 24h, well within the 3-7 day horizon the M1 design doc describes.
    const result = makeResult(contiguousSeries(5 * 24))
    render(<ForecastChart result={result} />)

    expect(screen.getByTestId('forecast-chart')).toBeInTheDocument()
    // Recharts renders an actual <svg> with a <path> for the line series.
    const svg = screen.getByTestId('forecast-chart').querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg?.querySelectorAll('path').length).toBeGreaterThan(0)
    // No empty-state copy should be shown alongside real data.
    expect(screen.queryByText(/click update/i)).not.toBeInTheDocument()
  })

  it('renders without throwing when the series has gaps (missing hours)', () => {
    const full = contiguousSeries(48)
    // Drop a few consecutive hours in the middle, simulating Open-Meteo's
    // null-padded hour dropping (see SimulationResult's doc comment).
    const withGap = full.filter((_, i) => i < 10 || i > 14)
    const result = makeResult(withGap)

    render(<ForecastChart result={result} />)

    const container = screen.getByTestId('forecast-chart')
    expect(container).toBeInTheDocument()
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    // The line should still render (as one or more broken segments) rather
    // than crash or silently render nothing.
    expect(svg?.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('shows an empty state describing its own condition when result is undefined', () => {
    render(<ForecastChart result={undefined} />)

    // Distinct from the shared `EmptyState`'s "No location selected" — a
    // location can be (and, per PR #43 review finding #2, usually is)
    // already selected when this renders, e.g. right after a TMY -> Live
    // mode switch before Update has been clicked.
    expect(screen.getByText(/click update/i)).toBeInTheDocument()
    expect(screen.queryByText(/no location selected/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('forecast-chart')).not.toBeInTheDocument()
  })

  it('shows the empty state when hourlyWattsSeries is empty', () => {
    render(<ForecastChart result={makeResult([])} />)

    expect(screen.getByText(/click update/i)).toBeInTheDocument()
    expect(screen.queryByTestId('forecast-chart')).not.toBeInTheDocument()
  })
})
