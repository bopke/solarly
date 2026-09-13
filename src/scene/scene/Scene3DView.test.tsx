import { render } from '@testing-library/react'
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
      shapes.length + GIZMO_MESH_COUNT,
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
      2 + GIZMO_MESH_COUNT,
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
