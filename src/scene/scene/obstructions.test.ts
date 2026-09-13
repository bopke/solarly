import { describe, expect, it } from 'vitest'
import { createObstruction } from './obstructions'

describe('createObstruction', () => {
  it('creates a tree with sensible default height/radius at the given position', () => {
    const tree = createObstruction('tree', { x: 3, y: 4 })
    expect(tree.kind).toBe('tree')
    expect(tree.position).toEqual({ x: 3, y: 4 })
    expect(tree.heightM).toBeGreaterThan(0)
    expect(tree.radiusM).toBeGreaterThan(0)
  })

  it('creates a building with different (taller/wider) defaults than a tree', () => {
    const building = createObstruction('building', { x: 0, y: 0 })
    const tree = createObstruction('tree', { x: 0, y: 0 })
    expect(building.kind).toBe('building')
    expect(building.heightM).not.toBe(tree.heightM)
    expect(building.radiusM).not.toBe(tree.radiusM)
  })

  it('gives each obstruction a unique id', () => {
    const a = createObstruction('tree', { x: 0, y: 0 })
    const b = createObstruction('tree', { x: 0, y: 0 })
    expect(a.id).not.toBe(b.id)
  })
})
