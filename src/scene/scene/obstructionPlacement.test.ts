import { describe, expect, it } from 'vitest'
import { intersectGroundPlane } from './obstructionPlacement'

describe('intersectGroundPlane', () => {
  it('finds the ground point straight below a camera looking straight down', () => {
    const point = intersectGroundPlane({
      origin: { x: 3, y: -2, z: 10 },
      direction: { x: 0, y: 0, z: -1 },
    })
    expect(point).toEqual({ x: 3, y: -2 })
  })

  it('finds the ground point for an angled ray', () => {
    // Origin 10m up, direction pointing down and diagonally (east+north).
    const point = intersectGroundPlane({
      origin: { x: 0, y: 0, z: 10 },
      direction: { x: 1, y: 1, z: -1 },
    })
    // t = -10 / -1 = 10, so x = 0 + 10*1 = 10, y = 0 + 10*1 = 10.
    expect(point).toEqual({ x: 10, y: 10 })
  })

  it('returns null for a ray parallel to the ground plane', () => {
    const point = intersectGroundPlane({
      origin: { x: 0, y: 0, z: 5 },
      direction: { x: 1, y: 0, z: 0 },
    })
    expect(point).toBeNull()
  })

  it('returns null when the plane is behind the ray origin', () => {
    // Below ground, pointing further down/away from z=0.
    const point = intersectGroundPlane({
      origin: { x: 0, y: 0, z: -5 },
      direction: { x: 0, y: 0, z: -1 },
    })
    expect(point).toBeNull()
  })

  it('handles a ray already at z = 0 pointing further along the plane (t = 0)', () => {
    const point = intersectGroundPlane({
      origin: { x: 1, y: 2, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
    })
    expect(point).toEqual({ x: 1, y: 2 })
  })
})
