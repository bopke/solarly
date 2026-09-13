import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// R3F/WebGL needs a real GPU canvas, which jsdom doesn't provide — mirroring
// this project's existing MapLibre-in-tests pattern
// (`src/ui/LocationPicker.test.tsx`), `@react-three/fiber`'s `Canvas` and
// `@react-three/drei`'s `OrbitControls`/`Text` are mocked out entirely
// here. `Canvas` is stubbed to render its children through plain
// react-dom (bypassing R3F's own WebGL-backed reconciler) so the element
// *tree* (shape/panel mesh counts, gizmo presence) can still be asserted
// on — the actual WebGL rendering, camera controls, and lighting are NOT
// covered by these tests and need manual/browser verification (see the PR
// description).
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
}))

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => <div data-testid="orbit-controls" />,
  Text: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

// Imported after the mocks above so the mocked modules are in place.
import { Scene3DView } from './Scene3DView'
import { polygonToExtrusionGeometry } from '../derive'

const flatSquare = (latOffset: number, lonOffset: number, sizeDeg = 0.0005) => [
  { lat: 52.5 + latOffset, lon: 13.4 + lonOffset },
  { lat: 52.5 + latOffset + sizeDeg, lon: 13.4 + lonOffset },
  { lat: 52.5 + latOffset + sizeDeg, lon: 13.4 + lonOffset + sizeDeg },
  { lat: 52.5 + latOffset, lon: 13.4 + lonOffset + sizeDeg },
]

const genericResidentialPanel = { widthMm: 1134, heightMm: 1722 }

// NorthArrowGizmo always renders 2 <mesh> elements (shaft + head cone),
// present regardless of how many shapes are given.
const GIZMO_MESH_COUNT = 2
// Scene3DView always renders one invisible ground-plane <mesh> for
// click-to-place obstructions (issue #58), regardless of shape/obstruction
// count.
const GROUND_PLANE_MESH_COUNT = 1

describe('Scene3DView', () => {
  it('renders the mocked canvas and orbit controls with no shapes', () => {
    const { getByTestId } = render(<Scene3DView shapes={[]} />)
    expect(getByTestId('r3f-canvas')).toBeInTheDocument()
    expect(getByTestId('orbit-controls')).toBeInTheDocument()
  })

  it('renders one plane mesh per shape, with no panel mesh when no panel dims are given', () => {
    const shapes = [
      {
        id: 'a',
        geometry: polygonToExtrusionGeometry(flatSquare(0, 0), 20, 180),
      },
      {
        id: 'b',
        geometry: polygonToExtrusionGeometry(flatSquare(0.01, 0), 30, 90),
      },
    ]
    const { container } = render(<Scene3DView shapes={shapes} />)
    // One <mesh> (the plane) per shape, no panel mesh since no panel
    // dimensions were supplied at either the shape or component level,
    // plus the gizmo's fixed 2 meshes.
    expect(container.querySelectorAll('mesh')).toHaveLength(
      shapes.length + GIZMO_MESH_COUNT + GROUND_PLANE_MESH_COUNT,
    )
  })

  it('renders a panel mesh alongside the plane mesh when a defaultPanel is supplied', () => {
    const shapes = [
      {
        id: 'a',
        geometry: polygonToExtrusionGeometry(flatSquare(0, 0, 0.001), 20, 180),
      },
    ]
    const { container } = render(
      <Scene3DView shapes={shapes} defaultPanel={genericResidentialPanel} />,
    )
    // Plane mesh + panel mesh, plus the gizmo's fixed 2 meshes.
    expect(container.querySelectorAll('mesh')).toHaveLength(
      2 + GIZMO_MESH_COUNT + GROUND_PLANE_MESH_COUNT,
    )
  })

  it('lets a shape override the panel preset used for its own auto-fill', () => {
    const shapes = [
      {
        id: 'a',
        geometry: polygonToExtrusionGeometry(flatSquare(0, 0, 0.001), 20, 180),
        panel: { widthMm: 2000, heightMm: 1000 },
      },
    ]
    const { container } = render(
      <Scene3DView shapes={shapes} defaultPanel={genericResidentialPanel} />,
    )
    expect(container.querySelectorAll('mesh').length).toBeGreaterThanOrEqual(1)
  })
})

// Simulates a click ray straight down from (x, y, 10) toward the ground
// plane (z = 0), matching `intersectGroundPlane`'s expectations — see its
// own unit tests in `obstructionPlacement.test.ts` for the underlying math.
//
// Real R3F pointer events (`ThreeEvent<MouseEvent>`) carry a `.ray`
// property directly on the event object, entirely outside React's own
// SyntheticEvent system. The mocked Canvas here renders through plain
// react-dom instead, so `onClick` receives an ordinary React
// SyntheticEvent wrapping a real browser `MouseEvent` — and neither
// `fireEvent.click`'s `eventInit` dict nor the `MouseEvent` constructor
// itself will carry an arbitrary extra property like `ray` (unknown init
// keys are silently dropped). So the event is built by hand here and the
// custom `ray` property is defined on it directly before dispatch, via
// the lower-level `fireEvent(element, event)` overload.
function clickGround(element: Element, x: number, y: number) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'ray', {
    value: { origin: { x, y, z: 10 }, direction: { x: 0, y: 0, z: -1 } },
  })
  fireEvent(element, event)
}

describe('Scene3DView obstructions', () => {
  const shapes = [
    {
      id: 'a',
      geometry: polygonToExtrusionGeometry(flatSquare(0, 0), 20, 180),
    },
  ]

  it('places a tree (the default kind) on a ground click and shows its property panel', () => {
    const { container } = render(<Scene3DView shapes={shapes} />)
    const ground = container.querySelector('mesh[name="ground-plane"]')
    expect(ground).not.toBeNull()

    clickGround(ground as Element, 3, 4)

    expect(screen.getByTestId('obstruction-property-panel')).toBeInTheDocument()
    expect(screen.getByText('tree')).toBeInTheDocument()
    // Default tree height, per `createObstruction`.
    expect(screen.getByLabelText(/height/i)).toHaveValue(5)
  })

  it('places a building once the toolbar toggle is switched', () => {
    const { container } = render(<Scene3DView shapes={shapes} />)
    fireEvent.click(screen.getByText('Building'))
    const ground = container.querySelector('mesh[name="ground-plane"]')

    clickGround(ground as Element, 1, 1)

    expect(screen.getByText('building')).toBeInTheDocument()
    expect(screen.getByLabelText(/height/i)).toHaveValue(6)
  })

  it('reports the placed obstruction via onObstructionsChange (controlled usage)', () => {
    const onObstructionsChange = vi.fn()
    const { container } = render(
      <Scene3DView
        shapes={shapes}
        obstructions={[]}
        onObstructionsChange={onObstructionsChange}
      />,
    )
    const ground = container.querySelector('mesh[name="ground-plane"]')

    clickGround(ground as Element, 5, -2)

    expect(onObstructionsChange).toHaveBeenCalledTimes(1)
    const [next] = onObstructionsChange.mock.calls[0]
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({
      kind: 'tree',
      position: { x: 5, y: -2 },
    })
  })

  it('edits height via the property panel and deletes via the Remove button', () => {
    const { container } = render(<Scene3DView shapes={shapes} />)
    const ground = container.querySelector('mesh[name="ground-plane"]')
    clickGround(ground as Element, 0, 0)

    const heightInput = screen.getByLabelText(/height/i)
    fireEvent.change(heightInput, { target: { value: '8' } })
    expect(screen.getByLabelText(/height/i)).toHaveValue(8)

    fireEvent.click(screen.getByText('Remove'))
    expect(
      screen.queryByTestId('obstruction-property-panel'),
    ).not.toBeInTheDocument()
  })

  it('starts with the given controlled obstructions rendered, with no ground click needed', () => {
    const initial = [
      {
        id: 'fixed-1',
        kind: 'tree' as const,
        position: { x: 2, y: 2 },
        heightM: 5,
        radiusM: 1.5,
      },
    ]
    const { container } = render(
      <Scene3DView shapes={shapes} obstructions={initial} />,
    )
    expect(
      container.querySelector('[name="obstruction-tree-fixed-1"]'),
    ).not.toBeNull()
  })
})
