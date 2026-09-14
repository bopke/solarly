import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Mirrors Scene3DView.test.tsx's mocking approach (see its module doc) —
// `@react-three/drei`'s `Text`/`Billboard` are stubbed to plain host
// elements so the rendered tree's *structure* (does the label sit inside
// a `<Billboard>`?) can be asserted on under jsdom, without a real WebGL
// canvas.
vi.mock('@react-three/drei', () => ({
  Text: ({ children }: { children?: React.ReactNode }) => (
    <span data-testid="north-label">{children}</span>
  ),
  Billboard: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="billboard">{children}</div>
  ),
}))

import { NorthArrowGizmo } from './NorthArrowGizmo'

describe('NorthArrowGizmo', () => {
  it('wraps the "N" label in a Billboard so it always faces the camera (issue #85 item 5)', () => {
    const { getByTestId } = render(<NorthArrowGizmo />)
    const billboard = getByTestId('billboard')
    const label = getByTestId('north-label')
    // The label must be a Billboard descendant, not a sibling — a
    // `<Billboard>` rendered next to (rather than around) the `<Text>`
    // wouldn't actually reorient it.
    expect(billboard).toContainElement(label)
    expect(label).toHaveTextContent('N')
  })
})
