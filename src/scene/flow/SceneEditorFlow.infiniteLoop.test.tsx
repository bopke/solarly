import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

/**
 * Regression test for PR #100 review Finding A: a per-render fresh-object
 * `defaultPanel` (the previous fix's default-parameter object literal)
 * closes a `useMemo` -> `useEffect` -> `setState` cycle between
 * `SceneEditorFlow` and the real `Scene3DView`, wedging step 3 in an
 * infinite render loop in the actual app.
 *
 * `SceneEditorFlow.test.tsx` mocks `../scene` with a stub `Scene3DView`
 * that has no `useMemo`/`useEffect` of its own, so it structurally cannot
 * reproduce this cycle — and its existing `defaultPanel` assertion checks
 * the prop's *value* (via `JSON.stringify`/`toHaveTextContent`), not its
 * *object identity*, which is the axis that actually regresses. This file
 * therefore mocks only `../tracing` and `../configure` (as
 * `SceneEditorFlow.test.tsx` does, to click through steps 1-2 without a
 * real MapLibre/mapbox-gl-draw session) plus `@react-three/fiber`'s
 * `Canvas` and `@react-three/drei` (as `Scene3DView.test.tsx` does, since
 * jsdom has no real WebGL) — leaving the real `SceneEditorFlow` wired to
 * the real `Scene3DView`, exactly the combination the previous fix's
 * default-parameter change broke.
 *
 * Verified against the pre-fix code: temporarily reverting `defaultPanel`
 * back to a default-parameter object literal (`defaultPanel = { widthMm:
 * panelPreset.widthMm, heightMm: panelPreset.heightMm }`) makes this test
 * fail with "Maximum update depth exceeded" and time out, exactly as the
 * reviewer described (5+ minutes wedged, never settling). With the
 * `useMemo` fix in place, it settles in well under a second.
 */

const square = [
  { lat: 52.5, lon: 13.4 },
  { lat: 52.5005, lon: 13.4 },
  { lat: 52.5005, lon: 13.4005 },
  { lat: 52.5, lon: 13.4005 },
]

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
  }) => (
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
    </div>
  ),
}))

vi.mock('../configure', () => ({
  ConfigureShapes: ({
    shapes,
    onChange,
  }: {
    shapes: { id: string }[]
    onChange: (
      configs: { shapeId: string; tiltDeg: number; azimuthDeg: number }[],
      isValid: boolean,
    ) => void
  }) => (
    <div data-testid="configure-step">
      <button
        onClick={() =>
          onChange(
            shapes.map((s) => ({
              shapeId: s.id,
              tiltDeg: 25,
              azimuthDeg: 180,
            })),
            true,
          )
        }
      >
        configure-valid
      </button>
    </div>
  ),
}))

// jsdom has no real WebGL — mirrors `Scene3DView.test.tsx`'s own mocking of
// the R3F/drei layer, leaving `Scene3DView`'s own React logic (the
// `shapePanelLayouts` memo and its effect) real and un-mocked.
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
}))

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => <div data-testid="orbit-controls" />,
  Text: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

// Imported after the mocks above so the mocked modules are in place. Note
// `../scene` (Scene3DView) is deliberately NOT mocked here.
import { SceneEditorFlow } from './SceneEditorFlow'

const LOCATION = { lat: 52.5, lon: 13.4 }

describe('SceneEditorFlow + real Scene3DView (PR #100 review Finding A)', () => {
  it('reaches step 3 and settles without an infinite render loop', async () => {
    const user = userEvent.setup()
    render(
      <SceneEditorFlow
        open
        location={LOCATION}
        onClose={() => {}}
        onApply={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'trace-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'configure-valid' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // Pre-fix, this step never resolves — `shapePanelLayouts` recomputes on
    // every render because `defaultPanel` is a fresh object each time,
    // which retriggers the layout-change effect, which re-renders the
    // parent, forever. `waitFor`'s default timeout (1000ms) is generous
    // relative to the fix's actual settle time (observed ~well under
    // 100ms); the pre-fix code instead throws React's own "Maximum update
    // depth exceeded" once its internal render-depth guard trips.
    await waitFor(() => {
      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument()
    })

    // Give any runaway render loop a further chance to manifest as a
    // thrown "Maximum update depth exceeded" (React schedules those
    // synchronously within the same microtask/render pass once the loop
    // starts, so if we got here without one, the loop didn't start).
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument()
  })
})
