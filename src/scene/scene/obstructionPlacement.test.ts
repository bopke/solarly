import { describe, expect, it } from 'vitest'
import {
  intersectGroundPlane,
  isInsideAnyFootprint,
} from './obstructionPlacement'
import { polygonToExtrusionGeometry } from '../derive'

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

describe('isInsideAnyFootprint', () => {
  // Mirrors the PR #69 review's repro: a square roof tilted steeply
  // enough (25-30deg) that `polygonToExtrusionGeometry` (which tilts
  // about the polygon's own centroid) produces geometry straddling
  // z = 0 — the downslope half of the roof sits below the invisible
  // ground plane. This block only exercises the plan-view (x, y)
  // footprint though, so it doesn't matter that the geometry dips below
  // ground: `polygonToExtrusionGeometry`'s tilt never changes a
  // vertex's own (x, y), only its z (see that module's doc), so the
  // plan-view footprint is the same flat square regardless of tilt.
  const roofSquare = [
    { lat: 52.5, lon: 13.4 },
    { lat: 52.5005, lon: 13.4 },
    { lat: 52.5005, lon: 13.4005 },
    { lat: 52.5, lon: 13.4005 },
  ]
  const tiltedRoof = polygonToExtrusionGeometry(roofSquare, 27, 180)
  const footprint = tiltedRoof.vertices.map((v) => ({ x: v.x, y: v.y }))

  it('sanity-checks the fixture: the tilted roof geometry really straddles z = 0', () => {
    const zs = tiltedRoof.vertices.map((v) => v.z)
    expect(Math.min(...zs)).toBeLessThan(0)
    expect(Math.max(...zs)).toBeGreaterThan(0)
  })

  it("blocks a ground point that falls inside a tilted shape's plan-view footprint (downslope-half regression)", () => {
    // (0, 0) is the roof's own centroid in local meters — well inside
    // its footprint regardless of the tilt/z quirk above. Before the
    // fix, a ground-plane click resolving to a point like this (which
    // real R3F raycasting can produce for the downslope half of the
    // roof, per the reviewer's measurements) placed an obstruction
    // underneath the roof.
    expect(isInsideAnyFootprint({ x: 0, y: 0 }, [footprint])).toBe(true)
  })

  it('does not block a ground point genuinely outside every shape footprint', () => {
    expect(isInsideAnyFootprint({ x: 100, y: 100 }, [footprint])).toBe(false)
  })

  it('checks against every footprint when multiple shapes are present', () => {
    const other = [
      { x: 200, y: 200 },
      { x: 210, y: 200 },
      { x: 210, y: 210 },
      { x: 200, y: 210 },
    ]
    expect(isInsideAnyFootprint({ x: 205, y: 205 }, [footprint, other])).toBe(
      true,
    )
    expect(isInsideAnyFootprint({ x: 500, y: 500 }, [footprint, other])).toBe(
      false,
    )
  })
})
