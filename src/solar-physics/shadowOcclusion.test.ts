import { describe, expect, it } from 'vitest'
import {
  isPanelOccluded,
  rayBoxIntersection,
  rayConeIntersection,
  rayCylinderIntersection,
  rayPolygonIntersection,
  type Obstacle,
  type Vec3,
} from './shadowOcclusion'

/** Test-local helper: normalizes a direction vector for angled-ray cases. */
function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z)
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

/**
 * All reference distances below are hand-computed from the primitives'
 * exact geometric definitions (a flat plane through 3+ vertices; an
 * infinite z-axis-aligned cylinder clipped to [zMin, zMax]; a double-napped
 * cone with apex up, clipped to its frustum; an axis-aligned box) — not
 * cross-checked against an independent implementation, matching this
 * module's role as new-for-M3 code without an established Python reference
 * script yet. Every case is either axis-aligned or uses simple round
 * numbers specifically so the expected intersection point can be verified
 * by inspection.
 */

describe('rayPolygonIntersection', () => {
  // Horizontal square roof at z=5, spanning x,y in [-2, 2].
  const flatRoof: Vec3[] = [
    { x: -2, y: -2, z: 5 },
    { x: 2, y: -2, z: 5 },
    { x: 2, y: 2, z: 5 },
    { x: -2, y: 2, z: 5 },
  ]

  it('hits a flat horizontal plane straight on', () => {
    const t = rayPolygonIntersection(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      flatRoof,
    )
    expect(t).toBeCloseTo(5, 9)
  })

  it('misses when the ray points away from the plane', () => {
    const t = rayPolygonIntersection(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      flatRoof,
    )
    expect(t).toBeNull()
  })

  it('misses when the plane is hit outside the polygon footprint', () => {
    const t = rayPolygonIntersection(
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 0, z: 1 },
      flatRoof,
    )
    expect(t).toBeNull()
  })

  // Tilted 45-degree plane: z = y + 1 (rises 1m in z for every 1m in y),
  // spanning x in [-2, 2] and y in [-2, 2] (z in [-1, 3] accordingly).
  // Vertices: (-2,-2,-1), (2,-2,-1), (2,2,3), (-2,2,3).
  const tiltedRoof: Vec3[] = [
    { x: -2, y: -2, z: -1 },
    { x: 2, y: -2, z: -1 },
    { x: 2, y: 2, z: 3 },
    { x: -2, y: 2, z: 3 },
  ]

  it('hits a tilted plane at a known angle', () => {
    // At y=0, the plane is at z=1 (z = y + 1). A ray straight up from
    // (0,0,0) travels 1m in z to reach it, so t=1.
    const t = rayPolygonIntersection(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      tiltedRoof,
    )
    expect(t).toBeCloseTo(1, 9)
  })

  it('misses the tilted plane outside its x-extent', () => {
    const t = rayPolygonIntersection(
      { x: 5, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      tiltedRoof,
    )
    expect(t).toBeNull()
  })

  it('grazes the polygon boundary edge without throwing, and resolves deterministically', () => {
    // x=2 is exactly the boundary edge of both roofs' footprint.
    const t = rayPolygonIntersection(
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      tiltedRoof,
    )
    // Boundary-edge resolution is a standard ray-casting ambiguity (see
    // module doc) - what matters is it doesn't throw and is a boolean-ish
    // (number | null) result, checked deterministically against itself.
    const tAgain = rayPolygonIntersection(
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      tiltedRoof,
    )
    expect(t).toBe(tAgain)
  })

  it('still detects a hit when the first three vertices are collinear (regression: normal used to be taken only from vertices[0..2])', () => {
    // A valid, flat, non-degenerate horizontal roof at z=5 — but the first
    // three traced vertices, (-2,0,5), (0,0,5), (2,0,5), lie exactly along
    // the line y=0 (a redundant midpoint along that edge, the kind
    // `scene/derive/geo.ts` documents as legitimate tracing input). Taking
    // the normal from only vertices[0..2] gives a zero cross product and
    // used to make this function return null for every ray, even ones that
    // clearly hit the polygon.
    const roofWithCollinearLeadingTriple: Vec3[] = [
      { x: -2, y: 0, z: 5 },
      { x: 0, y: 0, z: 5 },
      { x: 2, y: 0, z: 5 },
      { x: 2, y: 4, z: 5 },
      { x: -2, y: 4, z: 5 },
    ]
    const t = rayPolygonIntersection(
      { x: 0, y: 2, z: 0 },
      { x: 0, y: 0, z: 1 },
      roofWithCollinearLeadingTriple,
    )
    expect(t).toBeCloseTo(5, 9)
  })

  it('correctly handles a non-convex (L-shaped) polygon, hitting inside both arms and missing in the notch', () => {
    // L-shape in the z=0 plane: the union of the bottom strip
    // (0<=x<=4, 0<=y<=2) and the left strip (0<=x<=2, 2<=y<=4), i.e. a
    // 4x4 square with the top-right 2x2 quadrant (the "notch") removed.
    const lShape: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 2, z: 0 },
      { x: 2, y: 2, z: 0 },
      { x: 2, y: 4, z: 0 },
      { x: 0, y: 4, z: 0 },
    ]

    // (1,1) is inside the bottom strip (part of both arms).
    expect(
      rayPolygonIntersection(
        { x: 1, y: 1, z: -5 },
        { x: 0, y: 0, z: 1 },
        lShape,
      ),
    ).toBeCloseTo(5, 9)

    // (3,1) is inside the bottom strip only (right arm, outside the left
    // arm's x-range) — a case a convex-hull-shaped bug would get wrong.
    expect(
      rayPolygonIntersection(
        { x: 3, y: 1, z: -5 },
        { x: 0, y: 0, z: 1 },
        lShape,
      ),
    ).toBeCloseTo(5, 9)

    // (3,3) falls in the removed notch — outside the L-shape entirely.
    expect(
      rayPolygonIntersection(
        { x: 3, y: 3, z: -5 },
        { x: 0, y: 0, z: 1 },
        lShape,
      ),
    ).toBeNull()
  })
})

describe('rayCylinderIntersection', () => {
  const center = { x: 0, y: 0 }
  const radius = 2
  const zMin = 0
  const zMax = 5

  it('hits the near side of a vertical cylinder', () => {
    // From (10,0,2) heading -x: enters the radius-2 circle at x=2, so t=8.
    const t = rayCylinderIntersection(
      { x: 10, y: 0, z: 2 },
      { x: -1, y: 0, z: 0 },
      center,
      radius,
      zMin,
      zMax,
    )
    expect(t).toBeCloseTo(8, 9)
  })

  it('misses when outside the height range even though the circle is crossed', () => {
    const t = rayCylinderIntersection(
      { x: 10, y: 0, z: 10 },
      { x: -1, y: 0, z: 0 },
      center,
      radius,
      zMin,
      zMax,
    )
    expect(t).toBeNull()
  })

  it('registers a tangent (grazing) hit as a real intersection', () => {
    // Line y=2 is tangent to the radius-2 circle at (0,2): discriminant=0.
    const t = rayCylinderIntersection(
      { x: 10, y: 2, z: 2 },
      { x: -1, y: 0, z: 0 },
      center,
      radius,
      zMin,
      zMax,
    )
    expect(t).toBeCloseTo(10, 9)
  })

  it('misses when the line passes entirely outside the circle', () => {
    const t = rayCylinderIntersection(
      { x: 10, y: 3, z: 2 },
      { x: -1, y: 0, z: 0 },
      center,
      radius,
      zMin,
      zMax,
    )
    expect(t).toBeNull()
  })

  it('hits an end cap when a near-vertical ray reaches the trunk volume before its lateral-surface crossing falls in range (regression: end caps were unmodeled, causing a false miss)', () => {
    // A slightly-off-axis, mostly-vertical ray whose two lateral-surface
    // roots both land far outside [zMin, zMax] (the ray leaves the radius-2
    // circle laterally only very far above/below the cylinder), even though
    // the ray genuinely passes through the cylinder's volume by entering
    // through the bottom cap disk. Reference t hand/tool-computed from the
    // ray-vs-plane-at-z=zMin formula: origin (0.3,0,-2), direction
    // normalize(0.05,0,1) -> bottom-cap hit at t ~= 2.0024984394500787
    // (hit point (0.3+t*dx, 0) has distance^2 0.16 < radius^2=4, so within
    // the cap disk). The old lateral-only implementation returned null here.
    const dir = normalize({ x: 0.05, y: 0, z: 1 })
    const t = rayCylinderIntersection(
      { x: 0.3, y: 0, z: -2 },
      dir,
      center,
      radius,
      zMin,
      zMax,
    )
    expect(t).toBeCloseTo(2.0024984394500787, 9)
  })

  it('hits the lateral surface with an angled (non-horizontal) ray', () => {
    // Reference t hand/tool-computed: origin (10,0,1),
    // direction normalize(-1,0,0.3) -> lateral entry at
    // t ~= 8.352245207128444, with the hit z (~3.4) within [zMin, zMax].
    const dir = normalize({ x: -1, y: 0, z: 0.3 })
    const t = rayCylinderIntersection(
      { x: 10, y: 0, z: 1 },
      dir,
      center,
      radius,
      zMin,
      zMax,
    )
    expect(t).toBeCloseTo(8.352245207128444, 9)
  })
})

describe('rayConeIntersection', () => {
  // Foliage cone: apex at (0,0,10), base radius 3, height 6 -> base at z=4.
  const apex: Vec3 = { x: 0, y: 0, z: 10 }
  const baseRadius = 3
  const height = 6

  it('hits the cone at a known cross-section radius', () => {
    // At z=7, dz (drop from apex) = 3, so the cone's radius there is
    // (3/6)*3 = 1.5. A ray along y=0,z=7 from x=10 heading -x enters at
    // x=1.5, so t = 10 - 1.5 = 8.5.
    const t = rayConeIntersection(
      { x: 10, y: 0, z: 7 },
      { x: -1, y: 0, z: 0 },
      apex,
      baseRadius,
      height,
    )
    expect(t).toBeCloseTo(8.5, 9)
  })

  it('misses below the base (outside the frustum) even though the infinite cone extends there', () => {
    const t = rayConeIntersection(
      { x: 10, y: 0, z: 2 },
      { x: -1, y: 0, z: 0 },
      apex,
      baseRadius,
      height,
    )
    expect(t).toBeNull()
  })

  it('returns the true entry distance (via the base cap) rather than the lateral exit distance, for a ray that enters through the base (regression: base cap was unmodeled, causing a too-large returned distance)', () => {
    // A near-vertical ray starting below and near the axis, heading up into
    // the cone's volume through its flat base disk. Its two lateral-surface
    // roots are an above-apex miss (t~13.82, excluded by the frustum check)
    // and a lateral *exit* point at t~7.537 (within the frustum, since the
    // ray keeps climbing through the canopy after entering via the base).
    // The old lateral-only implementation returned that exit point, 7.537,
    // as if it were the entry. The true entry is through the base cap disk
    // at t ~= 4.019950248448356 (hit point at radius^2 ~= 0.81 < baseRadius^2 = 9).
    const dir = normalize({ x: 0.1, y: 0, z: 1 })
    const oldWrongLateralExit = 7.5374067158406675
    const t = rayConeIntersection(
      { x: 0.5, y: 0, z: 0 },
      dir,
      apex,
      baseRadius,
      height,
    )
    expect(t).toBeCloseTo(4.019950248448356, 9)
    expect(t).not.toBeCloseTo(oldWrongLateralExit, 1)
  })

  it('hits the lateral surface with an angled (non-horizontal) ray, with no base-cap involvement', () => {
    // Reference t hand/tool-computed: origin (10,0,6),
    // direction normalize(-1,0,0.2) -> lateral entry at
    // t ~= 9.06492357972051 (hit z ~= 7.78, within the frustum); the ray's
    // base-cap crossing is behind the origin and outside the base disk, so
    // this exercises the lateral path specifically.
    const dir = normalize({ x: -1, y: 0, z: 0.2 })
    const t = rayConeIntersection(
      { x: 10, y: 0, z: 6 },
      dir,
      apex,
      baseRadius,
      height,
    )
    expect(t).toBeCloseTo(9.06492357972051, 9)
  })
})

describe('rayBoxIntersection', () => {
  const center = { x: 0, y: 0 }
  const halfExtent = 2
  const zMin = 0
  const zMax = 6

  it('hits the near face of a box', () => {
    const t = rayBoxIntersection(
      { x: 10, y: 0, z: 3 },
      { x: -1, y: 0, z: 0 },
      center,
      halfExtent,
      zMin,
      zMax,
    )
    expect(t).toBeCloseTo(8, 9)
  })

  it('misses above the box height even when the x-y footprint is crossed', () => {
    const t = rayBoxIntersection(
      { x: 10, y: 0, z: 10 },
      { x: -1, y: 0, z: 0 },
      center,
      halfExtent,
      zMin,
      zMax,
    )
    expect(t).toBeNull()
  })

  it('misses laterally outside the footprint', () => {
    const t = rayBoxIntersection(
      { x: 10, y: 5, z: 3 },
      { x: -1, y: 0, z: 0 },
      center,
      halfExtent,
      zMin,
      zMax,
    )
    expect(t).toBeNull()
  })

  it('does not count a hit exactly at/behind the ray origin (panel on the box surface, ray pointing away)', () => {
    // Starting exactly on the box's +x face (x=2) and heading further +x
    // (away from the box, which spans x in [-2,2]): the only geometric
    // "intersections" are at or behind the origin (t <= 0), which must not
    // count as a real occlusion per the module's MIN_HIT_DISTANCE_M rule.
    const t = rayBoxIntersection(
      { x: 2, y: 0, z: 3 },
      { x: 1, y: 0, z: 0 },
      center,
      halfExtent,
      zMin,
      zMax,
    )
    expect(t).toBeNull()
  })
})

describe('isPanelOccluded', () => {
  it('a panel is never occluded when there are no obstacles', () => {
    expect(
      isPanelOccluded({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, []),
    ).toBe(false)
  })

  it('a panel pointed straight up with no obstacles is never occluded', () => {
    const obstacles: Obstacle[] = [
      { kind: 'building', position: { x: 50, y: 50 }, heightM: 10, radiusM: 3 },
    ]
    expect(
      isPanelOccluded({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, obstacles),
    ).toBe(false)
  })

  describe('tree obstacle (trunk cylinder + foliage cone, matching ObstructionMesh.tsx proportions)', () => {
    // heightM=10, radiusM=3 -> trunkHeight=3.5, trunkRadius=max(0.36,0.08)=0.36,
    // foliageHeight=6.5, cone spans z in [3.5, 10] with base radius 3.
    const tree: Obstacle = {
      kind: 'tree',
      position: { x: 0, y: 0 },
      heightM: 10,
      radiusM: 3,
    }

    it('occludes a panel directly behind the trunk at a low sun angle', () => {
      // Panel at (10,0,0.5), sun direction due west (-x) at the horizon:
      // the ray at z=0.5 (within the trunk's [0, 3.5] range) crosses the
      // trunk's 0.36m-radius circle at x=0.36.
      const occluded = isPanelOccluded(
        { x: 10, y: 0, z: 0.5 },
        { x: -1, y: 0, z: 0 },
        [tree],
      )
      expect(occluded).toBe(true)
    })

    it('does not occlude the same panel when the sun is on the opposite side', () => {
      const occluded = isPanelOccluded(
        { x: 10, y: 0, z: 0.5 },
        { x: 1, y: 0, z: 0 },
        [tree],
      )
      expect(occluded).toBe(false)
    })
  })

  describe('building obstacle (box, matching ObstructionMesh.tsx proportions)', () => {
    const building: Obstacle = {
      kind: 'building',
      position: { x: 0, y: 0 },
      heightM: 6,
      radiusM: 2,
    }

    it('occludes a panel directly behind the building', () => {
      const occluded = isPanelOccluded(
        { x: 10, y: 0, z: 3 },
        { x: -1, y: 0, z: 0 },
        [building],
      )
      expect(occluded).toBe(true)
    })

    it('does not occlude when the sun is on the opposite side', () => {
      const occluded = isPanelOccluded(
        { x: 10, y: 0, z: 3 },
        { x: 1, y: 0, z: 0 },
        [building],
      )
      expect(occluded).toBe(false)
    })
  })

  describe('shape (roof-plane) obstacle, at a known tilt', () => {
    // Same tilted 45-degree roof plane as rayPolygonIntersection's test:
    // z = y + 1, spanning x,y in [-2, 2].
    const roof: Obstacle = {
      kind: 'shape',
      vertices: [
        { x: -2, y: -2, z: -1 },
        { x: 2, y: -2, z: -1 },
        { x: 2, y: 2, z: 3 },
        { x: -2, y: 2, z: 3 },
      ],
    }

    it('occludes a panel below the roof plane looking straight up', () => {
      const occluded = isPanelOccluded(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        [roof],
      )
      expect(occluded).toBe(true)
    })

    it('does not occlude when the ray points away from the roof plane', () => {
      const occluded = isPanelOccluded(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: -1 },
        [roof],
      )
      expect(occluded).toBe(false)
    })
  })

  it('occludes when any one of several obstacles blocks the ray, regardless of list order', () => {
    const blocking: Obstacle = {
      kind: 'building',
      position: { x: 0, y: 0 },
      heightM: 6,
      radiusM: 2,
    }
    const nonBlocking: Obstacle = {
      kind: 'building',
      position: { x: -50, y: -50 },
      heightM: 6,
      radiusM: 2,
    }
    const panel: Vec3 = { x: 10, y: 0, z: 3 }
    const sunDirection: Vec3 = { x: -1, y: 0, z: 0 }

    expect(isPanelOccluded(panel, sunDirection, [nonBlocking, blocking])).toBe(
      true,
    )
    expect(isPanelOccluded(panel, sunDirection, [blocking, nonBlocking])).toBe(
      true,
    )
  })
})
