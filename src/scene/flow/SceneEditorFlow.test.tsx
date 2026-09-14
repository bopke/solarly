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
import type { SceneApplyResult } from './SceneEditorFlow'
import type { SceneDesignState } from './types'

const LOCATION = { lat: 52.5, lon: 13.4 }

function Harness({
  onApply,
  onStateChange,
}: {
  onApply?: (result: SceneApplyResult) => void
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

  it('surfaces Scene3DView-reported panel layouts into the derived SystemConfig (PR #70 review finding 2)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<Harness onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: 'trace-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'configure-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await user.click(screen.getByRole('button', { name: 'report-panels' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // Step 4 shows the total across shapes, and Apply derives from the
    // same per-shape layouts issue #61 needs — not a recomputed value.
    expect(screen.getByText(/12 panels/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    const { systemConfig: config } = onApply.mock
      .calls[0][0] as SceneApplyResult
    expect(config.arrays).toHaveLength(1)
    expect(config.arrays[0].panelCount).toBe(12)
  })

  it('calls onApply with a SystemConfig derived from the full aggregated state (issue #61)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<Harness onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: 'trace-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'configure-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'add-obstruction' }))
    await user.click(screen.getByRole('button', { name: 'report-panels' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).toHaveBeenCalledTimes(1)
    const { systemConfig: config, sceneGeometry } = onApply.mock
      .calls[0][0] as SceneApplyResult
    expect(config.arrays).toEqual([
      {
        tiltDeg: 25,
        azimuthDeg: 180,
        panelCount: 12,
        wattsPerPanel: 400,
        efficiencyPercent: 20,
        tempCoefficientPercentPerC: -0.35,
        manualShadingPercent: 0,
        shapeId: 'shape-1',
      },
    ])
    // Defaults to the same "System losses" default as `SystemConfigForm`.
    expect(config.systemLossesPercent).toBe(14)

    // Issue #78: `SceneGeometry` is derived from the same aggregated state
    // and passed out alongside `systemConfig`, correlated via `shapeId`.
    expect(sceneGeometry.shapes.map((s) => s.id)).toEqual(['shape-1'])
    expect(sceneGeometry.obstructions).toHaveLength(1)
    expect(sceneGeometry.panels.every((p) => p.shapeId === 'shape-1')).toBe(
      true,
    )
    expect(sceneGeometry.panels).toHaveLength(0)
  })

  it('uses the supplied panelPreset (rather than the default) to fill the derived arrays', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <SceneEditorFlow
        open
        location={LOCATION}
        onClose={() => {}}
        onApply={onApply}
        panelPreset={{
          id: 'custom',
          make: 'Custom',
          model: 'Panel',
          ratedWattsPeak: 500,
          efficiencyPercent: 22,
          widthMm: 1100,
          heightMm: 2100,
          areaM2: 2.31,
          tempCoefficientPercentPerC: -0.28,
          isGeneric: false,
          notes: '',
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'trace-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'configure-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'report-panels' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    const { systemConfig: config } = onApply.mock
      .calls[0][0] as SceneApplyResult
    expect(config.arrays[0]).toMatchObject({
      wattsPerPanel: 500,
      efficiencyPercent: 22,
      tempCoefficientPercentPerC: -0.28,
    })
  })

  it('lets the user edit "System losses" and reflects it in the derived SystemConfig', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<Harness onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: 'trace-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'configure-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    const lossesInput = screen.getByLabelText('System losses (%)')
    await user.clear(lossesInput)
    await user.type(lossesInput, '9')

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    const { systemConfig: config } = onApply.mock
      .calls[0][0] as SceneApplyResult
    expect(config.systemLossesPercent).toBe(9)
  })

  it('disables Apply and shows an inline error for an invalid "System losses" value', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<Harness onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: 'trace-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'configure-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    const lossesInput = screen.getByLabelText('System losses (%)')
    await user.clear(lossesInput)
    await user.type(lossesInput, '150')

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/at most 100/i)

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).not.toHaveBeenCalled()
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

  it('hides the active step panel too when closed, so it does not visually bleed through onto whatever is behind the overlay', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const { container, rerender } = render(
      <SceneEditorFlow
        open
        location={LOCATION}
        onClose={() => {}}
        onApply={onApply}
      />,
    )

    // Advance all the way to step 4 (Apply), the step active when a real
    // "Apply then close" flow (see App.tsx's onApply) closes the overlay.
    await user.click(screen.getByRole('button', { name: 'trace-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'configure-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: 'Apply' })).toBeInTheDocument()

    // Close the overlay (mirrors `App.tsx` setting `open={false}` after
    // Apply) without navigating away from step 4 first.
    rerender(
      <SceneEditorFlow
        open={false}
        location={LOCATION}
        onClose={() => {}}
        onApply={onApply}
      />,
    )

    const applyPanel = screen
      .getByText('Apply', { selector: 'h2' })
      .closest('[data-visible]')
    expect(applyPanel).toHaveAttribute('data-visible', 'false')
    expect(applyPanel).toHaveAttribute('aria-hidden', 'true')

    // The whole overlay itself is also collapsed/hidden, as before.
    const overlay = container.querySelector('[role="dialog"]')
    expect(overlay).toHaveAttribute('data-open', 'false')
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

  // Issue #93: focus management on the overlay. `Harness`'s stubbed step 1
  // gives a small, known set of focusable elements to assert an exact
  // order against: the header's Close button (DOM order puts it before
  // any step content), then `SceneTracing`'s two stubbed buttons —
  // step 1's Back (disabled: the first step) and Next (disabled: nothing
  // traced yet) buttons are correctly excluded from the trap already.
  it('moves focus into the dialog on open', () => {
    render(<Harness />)
    // Focuses the dialog container itself (labeled "Design in 3D"), not
    // the first focusable descendant — see the effect's doc comment for
    // why a screen reader hearing the dialog's own label first is more
    // useful than hearing "Close, button" first.
    expect(screen.getByRole('dialog', { name: 'Design in 3D' })).toHaveFocus()
  })

  it('traps Tab within the dialog, wrapping from the last focusable element back to the first', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const closeButton = screen.getByRole('button', { name: 'Close' })
    const traceValid = screen.getByRole('button', { name: 'trace-valid' })
    const traceInvalid = screen.getByRole('button', { name: 'trace-invalid' })

    // Initial focus is on the dialog container; the first real Tab press
    // reaches the first focusable descendant, the Close button.
    await user.tab()
    expect(closeButton).toHaveFocus()
    await user.tab()
    expect(traceValid).toHaveFocus()
    await user.tab()
    expect(traceInvalid).toHaveFocus()
    // Wraps back to the first focusable element, rather than leaving the
    // dialog (e.g. the fixture wrapper `render` mounts into, or the
    // document body).
    await user.tab()
    expect(closeButton).toHaveFocus()

    // Shift+Tab from the first element wraps backward to the last.
    await user.tab({ shift: true })
    expect(traceInvalid).toHaveFocus()
  })

  it('skips content trapped inside a collapsed <details> when computing the last focusable element (issue #93 follow-up)', async () => {
    // Reproduces the exact real-world shape the reviewer found: MapLibre's
    // attribution control renders `<details><summary>…</summary><a
    // href>…</a></details>`, collapsed by default. That `<a>` matches
    // `FOCUSABLE_SELECTOR`, reports ordinary `display`/`visibility`/
    // client-rect values, and yet a browser refuses to focus it while the
    // `<details>` is closed — so it must not be treated as the trap's
    // "last" element. The previous version of this test suite only ever
    // exercised two plain `<button>`s in the stubbed step 1, which can't
    // catch this class of bug (nothing about a plain button "looks
    // focusable but isn't"). This test appends that exact structure as the
    // last element in step 1's tab order, mimicking the real map content
    // that sits alongside the stubbed tracing buttons in production.
    const user = userEvent.setup()
    render(<Harness />)

    const tracingStep = screen.getByTestId('tracing-step')
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = 'Attribution'
    const link = document.createElement('a')
    link.href = '#'
    link.textContent = 'MapLibre'
    details.appendChild(summary)
    details.appendChild(link)
    tracingStep.appendChild(details)
    expect(details.open).toBe(false)

    const closeButton = screen.getByRole('button', { name: 'Close' })

    // Shift+Tab from the first focusable element (Close) must wrap to the
    // genuinely-focusable last element — the `<summary>` disclosure
    // toggle, which stays focusable regardless of the `<details>`'s open
    // state — skipping the collapsed `<a>` entirely, and must not get
    // stuck on Close.
    await user.tab()
    expect(closeButton).toHaveFocus()
    await user.tab({ shift: true })
    expect(closeButton).not.toHaveFocus()
    expect(summary).toHaveFocus()

    // Forward Tab from the last reachable element (the summary) wraps
    // back to Close, rather than advancing into the unreachable `<a>` or
    // leaving the dialog.
    await user.tab()
    expect(closeButton).toHaveFocus()

    // Once expanded, the link becomes part of the trap's tab order too.
    details.open = true
    await user.tab({ shift: true })
    expect(link).toHaveFocus()
  })

  it('restores focus to the previously focused element on close', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Design in 3D'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(trigger).toHaveFocus()

    const { rerender } = render(
      <SceneEditorFlow open location={LOCATION} onClose={() => {}} />,
    )
    expect(trigger).not.toHaveFocus()

    rerender(
      <SceneEditorFlow open={false} location={LOCATION} onClose={() => {}} />,
    )
    expect(trigger).toHaveFocus()

    document.body.removeChild(trigger)
  })

  it('marks sibling content inert while open, and clears it again on close', () => {
    // Mirrors `App.tsx`'s actual composition: `AppShell` and
    // `SceneEditorFlow` are rendered as siblings under one common parent
    // (not one nested inside the other), so the overlay's "mark
    // background content inert" logic — which walks its own real DOM
    // parent's other children — has a genuine sibling to act on. Using
    // React to render both (rather than manually appending a plain DOM
    // node next to the container) matters: `ReactDOMClient.createRoot`
    // otherwise removes any non-React-managed children already present
    // in its container on first commit.
    function SiblingHarness({ open }: { open: boolean }) {
      return (
        <>
          <div data-testid="app-shell-stub">App content</div>
          <SceneEditorFlow open={open} location={LOCATION} onClose={() => {}} />
        </>
      )
    }

    const { rerender } = render(<SiblingHarness open />)
    const sibling = screen.getByTestId('app-shell-stub')

    expect(sibling).toHaveAttribute('inert')
    expect(sibling).toHaveAttribute('aria-hidden', 'true')

    rerender(<SiblingHarness open={false} />)
    expect(sibling).not.toHaveAttribute('inert')
    expect(sibling).not.toHaveAttribute('aria-hidden')
  })
})
