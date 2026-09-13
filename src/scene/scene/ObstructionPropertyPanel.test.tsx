import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ObstructionPropertyPanel } from './ObstructionPropertyPanel'
import type { Obstruction } from './obstructions'

const tree: Obstruction = {
  id: 't1',
  kind: 'tree',
  position: { x: 1, y: 2 },
  heightM: 5,
  radiusM: 1.5,
}

describe('ObstructionPropertyPanel', () => {
  it('renders the obstruction kind and current values', () => {
    render(
      <ObstructionPropertyPanel
        obstruction={tree}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('tree')).toBeInTheDocument()
    expect(screen.getByLabelText(/height/i)).toHaveValue(5)
    expect(screen.getByLabelText(/canopy radius/i)).toHaveValue(1.5)
    expect(screen.getByLabelText(/position east/i)).toHaveValue(1)
    expect(screen.getByLabelText(/position north/i)).toHaveValue(2)
  })

  it('calls onChange with a height patch when the height field changes', () => {
    const onChange = vi.fn()
    render(
      <ObstructionPropertyPanel
        obstruction={tree}
        onChange={onChange}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/height/i), {
      target: { value: '9' },
    })
    expect(onChange).toHaveBeenCalledWith({ heightM: 9 })
  })

  it('calls onChange with a merged position patch when X changes', () => {
    const onChange = vi.fn()
    render(
      <ObstructionPropertyPanel
        obstruction={tree}
        onChange={onChange}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/position east/i), {
      target: { value: '10' },
    })
    expect(onChange).toHaveBeenCalledWith({ position: { x: 10, y: 2 } })
  })

  it('calls onDelete when Remove is clicked and onClose when the close button is clicked', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    render(
      <ObstructionPropertyPanel
        obstruction={tree}
        onChange={vi.fn()}
        onDelete={onDelete}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByText('Remove'))
    expect(onDelete).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText('Deselect obstruction'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clamps a height below the minimum instead of passing it through unchanged', () => {
    const onChange = vi.fn()
    render(
      <ObstructionPropertyPanel
        obstruction={tree}
        onChange={onChange}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/height/i), {
      target: { value: '0' },
    })
    expect(onChange).toHaveBeenCalledWith({ heightM: 0.5 })
  })

  it('labels a building differently (footprint half-width rather than canopy radius)', () => {
    render(
      <ObstructionPropertyPanel
        obstruction={{ ...tree, kind: 'building' }}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('building')).toBeInTheDocument()
    expect(screen.getByLabelText(/footprint half-width/i)).toBeInTheDocument()
  })
})
