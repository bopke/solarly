import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

/**
 * `SceneEditorFlow`'s job is composing steps 1-3 (already built and
 * separately tested in #56/#57/#58/#59) with step-navigation and shared
 * state — not re-verifying those components' own internals (real
 * MapLibre/mapbox-gl-draw drawing, real R3F/WebGL rendering). So, mirroring
 * this project's existing pattern of mocking MapLibre/R3F entirely under
 * jsdom (`SceneTracing.test.tsx`, `Scene3DView.test.tsx`), each step
 * component is replaced here with a minimal stub that exposes its real
 * callback contract (`onShapesChange`, `onChange`, `onObstructionsChange`)
 * via test-only buttons, so these tests can exercise this component's own
 * logic: step gating, forward/back navigation, and state preservation.
 */
vi.mock('../tracing', () => ({
  SceneTracing: ({
    onShapesChange,
  }: {
    onShapesChange: (
      shapes: {
        id: string
        kind: 'roof-face' | 'ground-array'
        polygon: { lat: number; lon: number }[]
      }[],
      hasInvalidShapes: boolean,
    ) => void
  }) => {
    const square = [
      { lat: 52.5, lon: 13.4 },
      { lat: 52.5005, lon: 13.4 },
      { lat: 52.5005, lon: 13.4005 },
      { lat: 52.5, lon: 13.4005 },
    ]
    return (
      <div data-testid="tracing-step">
        <button
          onClick={() =>
            onShapesChange(
              [{ id: 'shape-1', kind: 'roof-face', polygon: square }],
              false,
            )
          }
        >
          trace-valid
        </button>
        <button onClick={() => onShapesChange([], true)}>trace-invalid</button>
      </div>
    )
  },
}))

vi.mock('../configure', () => ({
  ConfigureShapes: ({
    shapes,
    initialConfigs,
    onChange,
  }: {
    shapes: { id: string }[]
    initialConfigs?: Record<string, { tiltDeg: number; azimuthDeg: number }>
    onChange: (
      configs: { shapeId: string; tiltDeg: number; azimuthDeg: number }[],
      isValid: boolean,
    ) => void
  }) => (
    <div data-testid="configure-step">
      <div data-testid="configure-shape-count">{shapes.length}</div>
      <div data-testid="configure-seeded-tilt">
        {initialConfigs?.['shape-1']?.tiltDeg ?? 'none'}
      </div>
      <button
        onClick={() =>
          onChange(
            shapes.map((s) => ({
              shapeId: s.id,
              tiltDeg: initialConfigs?.[s.id]?.tiltDeg ?? 25,
              azimuthDeg: initialConfigs?.[s.id]?.azimuthDeg ?? 180,
            })),
            true,
          )
        }
      >
        configure-valid
      </button>
      <button onClick={() => onChange([], false)}>configure-invalid</button>
    </div>
  ),
}))

interface FakeObstruction {
  id: string
  kind: string
  position: { x: number; y: number }
  heightM: number
  radiusM: number
}

interface FakePanelLayout {
  shapeId: string
  panelCount: number
  panels: unknown[]
}

vi.mock('../scene', () => ({
  Scene3DView: ({
    shapes,
    obstructions,
    onObstructionsChange,
    onPanelLayoutChange,
  }: {
    shapes: { id: string }[]
    obstructions?: FakeObstruction[]
    onObstructionsChange?: (obstructions: FakeObstruction[]) => void
    onPanelLayoutChange?: (layouts: FakePanelLayout[]) => void
  }) => (
    <div data-testid="scene3d-step">
      <div data-testid="scene3d-shape-count">{shapes.length}</div>
      <button
        onClick={() =>
          onObstructionsChange?.([
            ...(obstructions ?? []),
            {
              id: `obstruction-${(obstructions?.length ?? 0) + 1}`,
              kind: 'tree',
              position: { x: 0, y: 0 },
              heightM: 5,
              radiusM: 1.5,
            },
          ])
        }
      >
        add-obstruction
      </button>
      <button
        onClick={() =>
          onPanelLayoutChange?.(
            shapes.map((s) => ({
              shapeId: s.id,
              panelCount: 12,
              panels: [],
            })),
          )
        }
      >
        report-panels
      </button>
    </div>
  ),
}))

// Imported after the mocks above so the mocked modules are in place.
import { SceneEditorFlow } from './SceneEditorFlow'
import type { SceneDesignState } from './types'

const LOCATION = { lat: 52.5, lon: 13.4 }

function Harness({
  onApply,
  onStateChange,
}: {
  onApply?: (state: SceneDesignState) => void
  onStateChange?: (state: SceneDesignState) => void
}): ReactNode {
  return (
    <SceneEditorFlow
      open
      location={LOCATION}
      onClose={() => {}}
      onApply={onApply}
      onStateChange={onStateChange}
    />
  )
}

describe('SceneEditorFlow', () => {
  it('starts on step 1 with Next disabled until a valid shape is traced', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(screen.getByTestId('tracing-step')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'trace-valid' }))
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('blocks Next while SceneTracing reports invalid shapes', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'trace-invalid' }))
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('advances to step 2 with the traced shapes, then blocks Next until configuration is valid', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'trace-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByTestId('configure-step')).toBeInTheDocument()
    expect(screen.getByTestId('configure-shape-count')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'configure-invalid' }))
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'configure-valid' }))
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('advances through to step 3 (3D scene) and step 4 (Apply)', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'trace-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'configure-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByTestId('scene3d-step')).toBeInTheDocument()
    // The traced (roof-face, tilt 25 < 90) shape should produce real
    // extrusion geometry and reach the 3D preview.
    expect(screen.getByTestId('scene3d-shape-count')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'add-obstruction' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByRole('heading', { name: 'Apply' })).toBeInTheDocument()
    expect(screen.getByText(/1 shape/)).toBeInTheDocument()
    expect(screen.getByText(/1 obstruction/)).toBeInTheDocument()
    // Step 4 is the last step: no Next button.
    expect(
      screen.queryByRole('button', { name: 'Next' }),
    ).not.toBeInTheDocument()
  })

  it('surfaces Scene3DView-reported panel layouts on SceneDesignState (PR #70 review finding 2)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<Harness onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: 'trace-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'configure-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await user.click(screen.getByRole('button', { name: 'report-panels' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // Step 4 shows the total across shapes, and Apply hands the same
    // per-shape layouts issue #61 needs onward — not a recomputed value.
    expect(screen.getByText(/12 panels/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    const state = onApply.mock.calls[0][0] as SceneDesignState
    expect(state.panelLayouts).toEqual([
      { shapeId: 'shape-1', panelCount: 12, panels: [] },
    ])
  })

  it('calls onApply with the full aggregated state when Apply is clicked', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<Harness onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: 'trace-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'configure-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'add-obstruction' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).toHaveBeenCalledTimes(1)
    const state = onApply.mock.calls[0][0] as SceneDesignState
    expect(state.tracedShapes).toHaveLength(1)
    expect(state.tracedShapes[0].id).toBe('shape-1')
    expect(state.shapeConfigs).toEqual([
      { shapeId: 'shape-1', tiltDeg: 25, azimuthDeg: 180 },
    ])
    expect(state.isShapeConfigValid).toBe(true)
    expect(state.obstructions).toHaveLength(1)
  })

  it('notifies onStateChange as the aggregated state changes', async () => {
    const user = userEvent.setup()
    const onStateChange = vi.fn()
    render(<Harness onStateChange={onStateChange} />)

    onStateChange.mockClear()
    await user.click(screen.getByRole('button', { name: 'trace-valid' }))

    const lastState = onStateChange.mock.calls.at(-1)?.[0] as SceneDesignState
    expect(lastState.tracedShapes).toHaveLength(1)
  })

  it('preserves step 1 and step 2 data when navigating back and forward', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'trace-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'configure-valid' }))

    // Go back to step 1, then forward again — without re-clicking
    // trace-valid, the previously traced shape should still be there.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('tracing-step')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByTestId('configure-shape-count')).toHaveTextContent('1')
    // Step 2 was re-seeded from the earlier configure-valid submission.
    expect(screen.getByTestId('configure-seeded-tilt')).toHaveTextContent('25')
  })

  it('preserves aggregated state across the overlay being closed and reopened', async () => {
    const user = userEvent.setup()
    const onStateChange = vi.fn()
    const { rerender } = render(
      <SceneEditorFlow
        open
        location={LOCATION}
        onClose={() => {}}
        onStateChange={onStateChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'trace-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'configure-valid' }))

    // Simulate the overlay closing (App.tsx sets `open={false}` but keeps
    // `SceneEditorFlow` mounted) and reopening via "Edit scene".
    rerender(
      <SceneEditorFlow
        open={false}
        location={LOCATION}
        onClose={() => {}}
        onStateChange={onStateChange}
      />,
    )
    rerender(
      <SceneEditorFlow
        open
        location={LOCATION}
        onClose={() => {}}
        onStateChange={onStateChange}
      />,
    )

    expect(screen.getByTestId('configure-step')).toBeInTheDocument()
    expect(screen.getByTestId('configure-shape-count')).toHaveTextContent('1')
    expect(screen.getByTestId('configure-seeded-tilt')).toHaveTextContent('25')
  })

  it('hides the overlay (visibility) without unmounting when open is false', () => {
    const { container, rerender } = render(
      <SceneEditorFlow open={false} location={LOCATION} onClose={() => {}} />,
    )
    const overlay = container.querySelector('[role="dialog"]')
    expect(overlay).toHaveAttribute('data-open', 'false')
    expect(overlay).toHaveAttribute('aria-hidden', 'true')

    rerender(<SceneEditorFlow open location={LOCATION} onClose={() => {}} />)
    expect(overlay).toHaveAttribute('data-open', 'true')
    expect(overlay).toHaveAttribute('aria-hidden', 'false')
  })

  it('calls onClose when Escape is pressed while open', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SceneEditorFlow open location={LOCATION} onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SceneEditorFlow open location={LOCATION} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
