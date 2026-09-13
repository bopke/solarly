import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

// `SceneEditorFlow` (issue #60) pulls in MapLibre + mapbox-gl-draw
// (tracing) and R3F/drei (3D scene) — all real-GPU/WebGL dependencies
// that jsdom can't run, and that already get their own dedicated mocks in
// `src/scene/tracing/SceneTracing.test.tsx`,
// `src/scene/scene/Scene3DView.test.tsx`, and
// `src/scene/flow/SceneEditorFlow.test.tsx`. This file's job is only
// `App`'s own wiring — the entry-point button's location-gating, opening
// the overlay, the compact "N shapes" summary reflecting `onStateChange`,
// and (PR #70 review finding 3) resetting the scene on a location change
// — so `SceneEditorFlow` itself is stubbed out here.
//
// `sceneFlowMounts` records one entry per *mount* of the stub (via a
// `useEffect` with an empty dependency array) — since `App` forces a full
// remount via a changing `key` on a location change (see
// `handleLocationChange`'s doc comment), this is how the reset tests
// below distinguish "a new `SceneEditorFlow` instance was created" from
// merely "the `location` prop was updated on the same instance".
const { sceneFlowMounts } = vi.hoisted(() => ({
  sceneFlowMounts: [] as { lat: number }[],
}))

const FAKE_SCENE_SYSTEM_CONFIG = {
  arrays: [
    {
      tiltDeg: 30,
      azimuthDeg: 180,
      panelCount: 20,
      wattsPerPanel: 400,
      efficiencyPercent: 20,
      tempCoefficientPercentPerC: -0.35,
      manualShadingPercent: 0,
    },
    {
      tiltDeg: 15,
      azimuthDeg: 90,
      panelCount: 22,
      wattsPerPanel: 400,
      efficiencyPercent: 20,
      tempCoefficientPercentPerC: -0.35,
      manualShadingPercent: 0,
    },
  ],
  systemLossesPercent: 14,
}

vi.mock('./scene/flow', () => ({
  SceneEditorFlow: ({
    open,
    location,
    onClose,
    onStateChange,
    onApply,
  }: {
    open: boolean
    location: { lat: number; lon: number }
    onClose: () => void
    onStateChange?: (state: unknown) => void
    onApply?: (config: unknown) => void
  }) => {
    useEffect(() => {
      sceneFlowMounts.push({ lat: location.lat })
      // Mount-only: deliberately NOT re-running on `location` prop
      // updates, so `sceneFlowMounts`'s length reflects mount count, not
      // location-prop-update count.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return open ? (
      <div data-testid="scene-editor-flow" data-lat={location.lat}>
        <button onClick={onClose}>close-scene</button>
        <button
          onClick={() =>
            onStateChange?.({
              tracedShapes: [{ id: 'shape-1' }],
              hasInvalidTracedShapes: false,
              shapeConfigs: [],
              isShapeConfigValid: true,
              obstructions: [],
              panelLayouts: [],
            })
          }
        >
          set-scene-state
        </button>
        <button onClick={() => onApply?.(FAKE_SCENE_SYSTEM_CONFIG)}>
          apply-scene
        </button>
      </div>
    ) : null
  },
}))

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
function setLocationViaMapClick(lat = 48.8566, lng = 2.3522) {
  const map = mapInstances[mapInstances.length - 1]
  act(() => {
    map.handlers['click']?.forEach((handler) =>
      handler({ lngLat: { lat, lng } }),
    )
  })
}

function clickUpdate() {
  fireEvent.click(screen.getByRole('button', { name: 'Update' }))
}

describe('App', () => {
  beforeEach(() => {
    sceneFlowMounts.length = 0
  })

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

  describe('"Design in 3D" entry point and overlay (issue #60)', () => {
    it('disables the entry point until a location is set, then enables it', () => {
      render(<App />)
      expect(
        screen.getByRole('button', { name: 'Design in 3D' }),
      ).toBeDisabled()

      setLocationViaMapClick()

      expect(screen.getByRole('button', { name: 'Design in 3D' })).toBeEnabled()
    })

    it('opens the overlay, passing the resolved location through', () => {
      render(<App />)
      setLocationViaMapClick()

      expect(screen.queryByTestId('scene-editor-flow')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Design in 3D' }))

      const overlay = screen.getByTestId('scene-editor-flow')
      expect(overlay).toBeInTheDocument()
      expect(overlay).toHaveAttribute('data-lat', '48.8566')
    })

    it('closes the overlay via onClose, and reopening still shows "Design in 3D" (no scene applied yet)', () => {
      render(<App />)
      setLocationViaMapClick()
      fireEvent.click(screen.getByRole('button', { name: 'Design in 3D' }))
      fireEvent.click(screen.getByRole('button', { name: 'close-scene' }))

      expect(screen.queryByTestId('scene-editor-flow')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Design in 3D' }),
      ).toBeInTheDocument()
    })

    describe('resetting the scene on a location change (PR #70 review finding 3)', () => {
      it('clears the sidebar "Edit scene" summary and closes the overlay when location changes with a scene in progress', () => {
        render(<App />)
        setLocationViaMapClick()
        fireEvent.click(screen.getByRole('button', { name: 'Design in 3D' }))
        fireEvent.click(screen.getByRole('button', { name: 'set-scene-state' }))

        // Scene in progress: button relabels and a summary appears.
        expect(
          screen.getByRole('button', { name: 'Edit scene' }),
        ).toBeInTheDocument()
        expect(screen.getByText(/1 shape traced/)).toBeInTheDocument()
        expect(screen.getByTestId('scene-editor-flow')).toBeInTheDocument()

        // Repick a different location — mirrors "trace a roof in Berlin,
        // then repick Paris" from the reviewer's repro.
        setLocationViaMapClick(41.9028, 12.4964)

        // Overlay closed and the stale scene summary is gone: the entry
        // point reverts to "Design in 3D" rather than continuing to
        // advertise the previous location's traced shape.
        expect(
          screen.queryByTestId('scene-editor-flow'),
        ).not.toBeInTheDocument()
        expect(
          screen.getByRole('button', { name: 'Design in 3D' }),
        ).toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'Edit scene' }),
        ).not.toBeInTheDocument()
        expect(screen.queryByText(/shape traced/)).not.toBeInTheDocument()
      })

      it('forces a fresh SceneEditorFlow instance (remount) on a location change, not just a prop update', () => {
        render(<App />)
        setLocationViaMapClick()
        fireEvent.click(screen.getByRole('button', { name: 'Design in 3D' }))
        expect(sceneFlowMounts).toHaveLength(1)

        setLocationViaMapClick(41.9028, 12.4964)

        // A prop update alone (same mounted instance) would leave this at
        // 1 — a new entry means `SceneEditorFlow` was actually remounted
        // with a clean internal-state slate, per `handleLocationChange`'s
        // doc comment in `App.tsx`.
        expect(sceneFlowMounts).toHaveLength(2)
        expect(sceneFlowMounts.at(-1)).toEqual({ lat: 41.9028 })
      })

      it('does not reset the scene when location is set for the first time (no prior scene)', () => {
        render(<App />)
        setLocationViaMapClick()

        // Only one mount so far, from the initial location being set.
        expect(sceneFlowMounts).toHaveLength(1)
      })
    })
  })

  describe('applying a scene, sidebar summary, and manual/scene toggle (issue #61)', () => {
    function applyScene() {
      fireEvent.click(screen.getByRole('button', { name: 'Design in 3D' }))
      fireEvent.click(screen.getByRole('button', { name: 'apply-scene' }))
    }

    it('replaces the manual form with a compact summary once a scene is applied, and closes the overlay', () => {
      render(<App />)
      setLocationViaMapClick()
      applyScene()

      expect(screen.queryByTestId('scene-editor-flow')).not.toBeInTheDocument()
      expect(screen.getByText('2 arrays, 42 panels total')).toBeInTheDocument()
      expect(
        screen.queryByRole('form', { name: 'System configuration' }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Edit scene' })).toBeEnabled()
    })

    it('feeds the applied scene SystemConfig into the simulation instead of the manual form output', async () => {
      runTmySimulation.mockResolvedValueOnce(makeTmyResult([makeMonth(1, 500)]))

      render(<App />)
      setLocationViaMapClick()
      applyScene()
      clickUpdate()

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(runTmySimulation).toHaveBeenCalledWith(
        expect.objectContaining({
          systemConfig: expect.objectContaining({
            arrays: expect.arrayContaining([
              expect.objectContaining({ panelCount: 20 }),
              expect.objectContaining({ panelCount: 22 }),
            ]),
          }),
        }),
      )
    })

    it('lets the user switch back to the manual form, which then feeds the simulation again', async () => {
      runTmySimulation.mockResolvedValue(makeTmyResult([makeMonth(1, 500)]))

      render(<App />)
      setLocationViaMapClick()
      applyScene()

      fireEvent.click(
        screen.getByRole('button', { name: 'Use manual form instead' }),
      )

      // The manual form (and the entry point) are back, in place of the
      // compact summary.
      expect(
        screen.getByRole('form', { name: 'System configuration' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByText('2 arrays, 42 panels total'),
      ).not.toBeInTheDocument()
      // The manual form still has its own sensible default values and is
      // usable immediately.
      clickUpdate()
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(runTmySimulation).toHaveBeenCalledWith(
        expect.objectContaining({
          systemConfig: expect.objectContaining({
            arrays: [expect.objectContaining({ panelCount: 10 })],
          }),
        }),
      )
    })

    it('lets the user switch from the manual form back to a previously-applied scene', () => {
      render(<App />)
      setLocationViaMapClick()
      applyScene()
      fireEvent.click(
        screen.getByRole('button', { name: 'Use manual form instead' }),
      )

      fireEvent.click(
        screen.getByRole('button', { name: 'Use applied scene (2 arrays)' }),
      )

      expect(screen.getByText('2 arrays, 42 panels total')).toBeInTheDocument()
    })

    it('clears the applied scene and reverts to the manual form on a location change', () => {
      render(<App />)
      setLocationViaMapClick()
      applyScene()
      expect(screen.getByText('2 arrays, 42 panels total')).toBeInTheDocument()

      setLocationViaMapClick(41.9028, 12.4964)

      expect(
        screen.queryByText('2 arrays, 42 panels total'),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('form', { name: 'System configuration' }),
      ).toBeInTheDocument()
    })
  })
})
