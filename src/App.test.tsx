import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NasaPowerNoDataError } from './data-sources'
import type {
  HourlyPoint,
  MonthlySimulation,
  TmySimulationResult,
} from './simulation'

// App mounts LocationPicker (see src/App.tsx), which creates a real
// MapLibre GL map on mount. MapLibre needs WebGL2, which jsdom doesn't
// provide, so it's mocked out here too — this test only needs to verify
// the page shell renders, not map behavior (see src/ui/LocationPicker.test.tsx
// for that). The mock also records `click` handlers so tests below can
// simulate the map-click fallback interaction to set a location, exactly
// like src/ui/LocationPicker.test.tsx does.
const { mapInstances } = vi.hoisted(() => {
  return {
    mapInstances: [] as {
      handlers: Record<string, ((...a: unknown[]) => void)[]>
    }[],
  }
})

vi.mock('maplibre-gl', () => ({
  Map: class {
    handlers: Record<string, ((...a: unknown[]) => void)[]> = {}
    constructor() {
      mapInstances.push(this)
    }
    addControl() {
      return this
    }
    on(event: string, handler: (...a: unknown[]) => void) {
      ;(this.handlers[event] ??= []).push(handler)
      return this
    }
    flyTo() {}
    resize() {}
    remove() {}
  },
  Marker: class {
    setLngLat() {
      return this
    }
    getLngLat() {
      return { lat: 48.8566, lng: 2.3522 }
    }
    addTo() {
      return this
    }
    on() {
      return this
    }
    remove() {}
  },
  NavigationControl: class {},
}))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

const runTmySimulation = vi.fn()
const runLiveSimulation = vi.fn()
vi.mock('./simulation', async () => {
  const actual =
    await vi.importActual<typeof import('./simulation')>('./simulation')
  return {
    ...actual,
    runTmySimulation: (...args: unknown[]) => runTmySimulation(...args),
    runLiveSimulation: (...args: unknown[]) => runLiveSimulation(...args),
  }
})

const { default: App } = await import('./App')

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

function makeTmyResult(months: MonthlySimulation[]): TmySimulationResult {
  return {
    mode: 'tmy',
    location: { lat: 48.8566, lon: 2.3522 },
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

/** Places a pin via the map-click fallback interaction (see LocationPicker), setting `location`. */
function setLocationViaMapClick() {
  const map = mapInstances[mapInstances.length - 1]
  act(() => {
    map.handlers['click']?.forEach((handler) =>
      handler({ lngLat: { lat: 48.8566, lng: 2.3522 } }),
    )
  })
}

function clickUpdate() {
  fireEvent.click(screen.getByRole('button', { name: 'Update' }))
}

describe('App', () => {
  it('renders the Solarly heading', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: /solarly/i }),
    ).toBeInTheDocument()
  })

  it('renders the location picker search input', () => {
    render(<App />)
    expect(screen.getByLabelText('Search for a location')).toBeInTheDocument()
  })

  describe('simulation error handling (issue #18)', () => {
    it('shows a retryable error banner and resets isLoading when the simulation call rejects generically', async () => {
      let reject!: (error: unknown) => void
      runTmySimulation.mockReturnValueOnce(
        new Promise((_resolve, r) => {
          reject = r
        }),
      )

      render(<App />)
      setLocationViaMapClick()
      clickUpdate()

      // Loading skeleton shows while the request is in flight.
      expect(screen.getByRole('status')).toBeInTheDocument()

      await act(async () => {
        reject(new Error('Network error'))
        // Let the rejected promise's .catch()/.finally() microtasks flush.
        await Promise.resolve()
        await Promise.resolve()
      })

      // isLoading resets — no more spinner stuck showing.
      expect(screen.queryByRole('status')).not.toBeInTheDocument()

      expect(
        screen.getByText(/couldn't reach the climate service/i),
      ).toBeInTheDocument()
      const retryButton = screen.getByRole('button', { name: 'Retry' })
      expect(retryButton).toBeInTheDocument()

      // Retrying re-invokes the simulation call.
      runTmySimulation.mockResolvedValueOnce(
        makeTmyResult([makeMonth(1, 1000)]),
      )
      fireEvent.click(retryButton)
      expect(runTmySimulation).toHaveBeenCalledTimes(2)
    })

    it('does not clear an existing result when a subsequent run fails', async () => {
      runTmySimulation.mockResolvedValueOnce(
        makeTmyResult([makeMonth(1, 3000)]),
      )

      render(<App />)
      setLocationViaMapClick()

      await act(async () => {
        clickUpdate()
        await Promise.resolve()
        await Promise.resolve()
      })

      // First run succeeded — chart content is visible.
      expect(screen.getAllByText(/January/).length).toBeGreaterThan(0)

      let reject!: (error: unknown) => void
      runTmySimulation.mockReturnValueOnce(
        new Promise((_resolve, r) => {
          reject = r
        }),
      )
      clickUpdate()

      await act(async () => {
        reject(new Error('Rate limited'))
        await Promise.resolve()
        await Promise.resolve()
      })

      // The error banner is shown ...
      expect(
        screen.getByText(/couldn't reach the climate service/i),
      ).toBeInTheDocument()

      // ... alongside the still-visible chart from the first, successful
      // run — not instead of it. This is the actual "last successful
      // result stays visible" requirement; asserting only the banner text
      // above would pass even if the chart had been wiped from the DOM.
      expect(screen.getAllByText(/January/).length).toBeGreaterThan(0)
    })

    it('does not let a stale in-flight request overwrite state after a config change invalidates it', async () => {
      // Start a run that stays pending ...
      let rejectStale!: (error: unknown) => void
      runTmySimulation.mockReturnValueOnce(
        new Promise((_resolve, r) => {
          rejectStale = r
        }),
      )

      render(<App />)
      setLocationViaMapClick()
      clickUpdate()
      expect(screen.getByRole('status')).toBeInTheDocument()

      // ... then change an input mid-flight, which calls
      // clearStaleResults() and must invalidate the pending request.
      fireEvent.change(screen.getByLabelText(/tilt/i), {
        target: { value: '35' },
      })

      // The stale request's eventual rejection must be ignored entirely:
      // no error banner, no stuck loading state, and it must not resolve
      // clearStaleResults()'s own `setIsLoading(false)`'s effect away.
      await act(async () => {
        rejectStale(new Error('stale rejection'))
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(
        screen.queryByText(/couldn't reach the climate service/i),
      ).not.toBeInTheDocument()

      // Clicking Update now should run the *current* (post-change) inputs
      // as a fresh request, not be confused with the stale one.
      runTmySimulation.mockResolvedValueOnce(makeTmyResult([makeMonth(1, 500)]))
      clickUpdate()
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.getAllByText(/January/).length).toBeGreaterThan(0)
    })

    it('shows a non-retryable "no data" message for NasaPowerNoDataError, without a retry button', async () => {
      runTmySimulation.mockReturnValueOnce(
        Promise.reject(
          new NasaPowerNoDataError('no coverage', 48.8566, 2.3522),
        ),
      )

      render(<App />)
      setLocationViaMapClick()

      await act(async () => {
        clickUpdate()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(
        screen.getByText(/no climate data available for this location/i),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument()
    })

    it('does not show a TMY error banner while looking at the Forecast tab in Live mode', async () => {
      let reject!: (error: unknown) => void
      runTmySimulation.mockReturnValueOnce(
        new Promise((_resolve, r) => {
          reject = r
        }),
      )

      render(<App />)
      setLocationViaMapClick()
      clickUpdate()

      await act(async () => {
        reject(new Error('boom'))
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(
        screen.getByText(/couldn't reach the climate service/i),
      ).toBeInTheDocument()

      // Switch to Live mode — the TMY-mode error must not follow.
      fireEvent.click(screen.getByRole('radio', { name: 'Live' }))

      expect(
        screen.queryByText(/couldn't reach the climate service/i),
      ).not.toBeInTheDocument()
    })
  })
})
