/**
 * Direct-beam shadow occlusion via 3D ray-obstacle intersection.
 *
 * Generic ray-vs-primitive geometry (plane-polygon, cylinder, cone, box) plus
 * a composed `isPanelOccluded` entry point that tests a ray from a panel
 * toward the sun against a list of obstacles. This module has no knowledge
 * of `scene/` types (`TracedShape`, `Obstruction`, ...) or `simulation/`
 * types — it works purely in terms of `Vec3` points/vectors and the small
 * `Obstacle` union defined here, so it stays an importable leaf for both
 * `scene/` (to build an `Obstacle[]`) and `simulation/` (to call
 * `isPanelOccluded` from the per-hour loop) without creating a circular or
 * backward dependency. See
 * docs/superpowers/specs/2026-09-13-solarly-m3-design.md, "New pure module:
 * `src/solar-physics/shadowOcclusion.ts`".
 *
 * Coordinate convention: ENU meters (x = east, y = north, z = up), matching
 * `scene/derive`'s local projection and the M3 spec's `SceneGeometry`. All
 * distances are in meters.
 *
 * Pure functions — no I/O, no dependency on any other module.
 */

/** A point or direction vector in local ENU meters (x = east, y = north, z = up). */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * A shadow-casting obstacle, in the generic ray-tracing terms this module
 * works with (not `scene/`'s `TracedShape`/`Obstruction` types, so a future
 * caller — see issue #77 — maps those into this shape rather than this
 * module depending on them).
 *
 * - `'shape'` models a traced roof/ground plane (or any other flat shape)
 *   as its extruded 3D polygon vertices, matching how `scene/derive`'s
 *   `polygonToExtrusionGeometry` already represents one — tested via
 *   ray-vs-plane + point-in-polygon.
 * - `'tree'` and `'building'` intentionally mirror the M3 spec's
 *   `SceneGeometry['obstructions']` element shape (`kind`, `position`,
 *   `heightM`, `radiusM`) field-for-field, so a future `SceneGeometry ->
 *   Obstacle[]` mapping (issue #77) is closer to a relabel than a
 *   transform. `'tree'` is modeled as a trunk cylinder topped with a
 *   foliage cone, with the same proportions `ObstructionMesh.tsx` renders
 *   (see `treeGeometry` below) so the analytical occlusion test matches
 *   what M2's 3D view visually shows. `'building'` is modeled as a
 *   square-footprint box, also matching `ObstructionMesh.tsx`.
 */
export type Obstacle =
  | { kind: 'shape'; vertices: Vec3[] }
  | {
      kind: 'tree'
      position: { x: number; y: number }
      heightM: number
      radiusM: number
    }
  | {
      kind: 'building'
      position: { x: number; y: number }
      heightM: number
      radiusM: number
    }

/**
 * Minimum hit distance counted as a real occlusion. Excludes hits at or
 * before the ray origin (t <= 0, e.g. a panel sitting exactly on an
 * obstacle's own surface with the ray pointing away from it) — per the M3
 * spec, occlusion requires "a real finite-distance hit, not a hit exactly
 * at or before the origin". Set well below any plausible scene scale (a
 * roof/plot is at most a few hundred meters across, per `scene/derive`'s
 * own doc comment).
 */
const MIN_HIT_DISTANCE_M = 1e-6

/** General numeric tolerance for degenerate-geometry guards (parallel rays, zero-length vectors, etc). */
const EPSILON = 1e-9

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function length(v: Vec3): number {
  return Math.sqrt(dot(v, v))
}

function normalize(v: Vec3): Vec3 {
  const len = length(v)
  if (len < EPSILON) {
    throw new Error('shadowOcclusion: cannot normalize a zero-length vector')
  }
  return scale(v, 1 / len)
}

/**
 * Point at parameter `t` along a ray from `origin` in unit direction `direction`.
 */
function pointAt(origin: Vec3, direction: Vec3, t: number): Vec3 {
  return add(origin, scale(direction, t))
}

/**
 * Smaller of two candidate hit distances that is finite and > `MIN_HIT_DISTANCE_M`,
 * or `null` if neither qualifies. Used by the quadratic-surface primitives
 * (cylinder, cone) where the near root should be preferred but may fall
 * behind the ray origin (or behind the primitive's own bounds) while the far
 * root is still a valid, visible hit.
 */
function nearestValidRoot(t1: number, t2: number): number | null {
  const lo = Math.min(t1, t2)
  const hi = Math.max(t1, t2)
  if (lo > MIN_HIT_DISTANCE_M) return lo
  if (hi > MIN_HIT_DISTANCE_M) return hi
  return null
}

/**
 * Ray vs. a finite planar polygon in 3D (used for shape/roof occlusion — a
 * shape's already-extruded 3D vertices, e.g. from `scene/derive`'s
 * `polygonToExtrusionGeometry`, passed as a raw `Vec3[]`).
 *
 * Two-stage test: (1) ray-vs-infinite-plane, using the plane's normal from
 * the polygon's first two edges; (2) point-in-polygon on the hit point,
 * projected into the plane's own 2D basis (so it works for a plane at any
 * tilt/orientation, not just axis-aligned ones).
 *
 * @param origin Ray origin (e.g. a panel position).
 * @param direction Ray direction. Must be a unit vector (callers normalize
 *   once and reuse, e.g. `isPanelOccluded`'s `sunDirection`).
 * @param vertices The polygon's vertices, in order (>= 3), assumed planar
 *   and non-degenerate (already validated upstream — see the M3 spec's
 *   "Error handling" section).
 * @returns The distance `t` along the ray to the hit point, or `null` if
 *   the ray doesn't hit the polygon (misses the plane, hits behind the
 *   origin, or hits the plane outside the polygon's footprint).
 */
export function rayPolygonIntersection(
  origin: Vec3,
  direction: Vec3,
  vertices: Vec3[],
): number | null {
  if (vertices.length < 3) return null

  const v0 = vertices[0]
  const edge1 = subtract(vertices[1], v0)
  const edge2 = subtract(vertices[2], v0)
  const normal = cross(edge1, edge2)
  const normalLen = length(normal)
  if (normalLen < EPSILON) return null // degenerate (collinear) polygon

  const denom = dot(normal, direction)
  if (Math.abs(denom) < EPSILON) return null // ray parallel to plane

  const t = dot(subtract(v0, origin), normal) / denom
  if (!(t > MIN_HIT_DISTANCE_M)) return null

  const hit = pointAt(origin, direction, t)

  // Project the hit point and polygon into the plane's own 2D basis (u, v)
  // so point-in-polygon works regardless of the plane's 3D orientation.
  const u = normalize(edge1)
  const v = normalize(cross(normal, u))
  const project = (p: Vec3): { x: number; y: number } => {
    const rel = subtract(p, v0)
    return { x: dot(rel, u), y: dot(rel, v) }
  }
  const hit2d = project(hit)
  const poly2d = vertices.map(project)

  return pointInPolygon2D(hit2d, poly2d) ? t : null
}

/**
 * Point-in-polygon test (ray-casting / even-odd rule) in a flat 2D plane.
 * Local re-implementation rather than importing `scene/derive/geo.ts`'s
 * `pointInPolygon` — this module must not depend on `scene/` at all (see
 * module doc). Points exactly on an edge may resolve either way, same
 * caveat as `scene/derive/geo.ts`'s version; irrelevant here since exact
 * boundary coincidence is a measure-zero case for real sun-ray geometry.
 */
function pointInPolygon2D(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[],
): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const vi = polygon[i]
    const vj = polygon[j]
    const intersects =
      vi.y > point.y !== vj.y > point.y &&
      point.x < ((vj.x - vi.x) * (point.y - vi.y)) / (vj.y - vi.y) + vi.x
    if (intersects) inside = !inside
  }
  return inside
}

/**
 * Ray vs. a finite, vertical (z-axis-aligned) cylinder — used for a tree
 * obstruction's trunk.
 *
 * @param origin Ray origin.
 * @param direction Ray direction (unit vector).
 * @param center Ground-plane (x, y) center of the cylinder's axis.
 * @param radius Cylinder radius, in meters.
 * @param zMin Bottom of the cylinder, in meters (z, up).
 * @param zMax Top of the cylinder, in meters.
 * @returns Distance `t` to the nearest valid hit, or `null`.
 */
export function rayCylinderIntersection(
  origin: Vec3,
  direction: Vec3,
  center: { x: number; y: number },
  radius: number,
  zMin: number,
  zMax: number,
): number | null {
  const ox = origin.x - center.x
  const oy = origin.y - center.y
  const dx = direction.x
  const dy = direction.y

  const a = dx * dx + dy * dy
  const withinHeight = (t: number): boolean => {
    const z = origin.z + t * direction.z
    return z >= zMin && z <= zMax
  }

  if (a < EPSILON) {
    // Ray is (near-)parallel to the cylinder's axis: either always inside
    // the infinite cylinder's circular cross-section, or always outside.
    const distSq = ox * ox + oy * oy
    if (distSq > radius * radius) return null
    // Inside the circle for all t: the first surface crossed, entering the
    // height range, is at zMin or zMax depending on travel direction.
    if (Math.abs(direction.z) < EPSILON) return null // no movement at all
    const tToZMin = (zMin - origin.z) / direction.z
    const tToZMax = (zMax - origin.z) / direction.z
    return nearestValidRoot(tToZMin, tToZMax)
  }

  const b = 2 * (ox * dx + oy * dy)
  const c = ox * ox + oy * oy - radius * radius
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null // ray misses the infinite cylinder entirely

  const sqrtDisc = Math.sqrt(discriminant)
  const t1 = (-b - sqrtDisc) / (2 * a)
  const t2 = (-b + sqrtDisc) / (2 * a)

  const lo = Math.min(t1, t2)
  const hi = Math.max(t1, t2)
  if (lo > MIN_HIT_DISTANCE_M && withinHeight(lo)) return lo
  if (hi > MIN_HIT_DISTANCE_M && withinHeight(hi)) return hi
  return null
}

/**
 * Ray vs. a finite, upward-pointing (apex-up) circular cone — used for a
 * tree obstruction's foliage canopy, sitting atop its trunk cylinder. See
 * `treeGeometry` for how a `'tree'` `Obstacle`'s `heightM`/`radiusM` are
 * split into trunk + cone dimensions, matching `ObstructionMesh.tsx`.
 *
 * @param origin Ray origin.
 * @param direction Ray direction (unit vector).
 * @param apex The cone's apex (tip), at the top of the canopy.
 * @param baseRadius Radius of the cone's base, in meters.
 * @param height Vertical extent of the cone (apex.z - baseZ), in meters. Must be > 0.
 * @returns Distance `t` to the nearest valid hit, or `null`.
 */
export function rayConeIntersection(
  origin: Vec3,
  direction: Vec3,
  apex: Vec3,
  baseRadius: number,
  height: number,
): number | null {
  if (height <= 0 || baseRadius <= 0) return null

  const k = baseRadius / height
  const px = origin.x - apex.x
  const py = origin.y - apex.y
  const ez = apex.z - origin.z // apex.z - origin.z: how far "up" origin is from the apex
  const dx = direction.x
  const dy = direction.y
  const dz = direction.z

  // Double-napped cone equation (px + t*dx)^2 + (py + t*dy)^2 = k^2 * (ez - t*dz)^2,
  // where (ez - t*dz) is the (signed) vertical drop from the apex to the
  // point at parameter t. Solved as a quadratic in t; the z-range check
  // below excludes the unwanted opposite nappe.
  const a = dx * dx + dy * dy - k * k * dz * dz
  const b = 2 * (px * dx + py * dy + k * k * ez * dz)
  const c = px * px + py * py - k * k * ez * ez

  const withinFrustum = (t: number): boolean => {
    const z = origin.z + t * dz
    return z <= apex.z && z >= apex.z - height
  }

  if (Math.abs(a) < EPSILON) {
    if (Math.abs(b) < EPSILON) return null // degenerate: no solution
    const t = -c / b
    return t > MIN_HIT_DISTANCE_M && withinFrustum(t) ? t : null
  }

  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null

  const sqrtDisc = Math.sqrt(discriminant)
  const t1 = (-b - sqrtDisc) / (2 * a)
  const t2 = (-b + sqrtDisc) / (2 * a)

  const lo = Math.min(t1, t2)
  const hi = Math.max(t1, t2)
  if (lo > MIN_HIT_DISTANCE_M && withinFrustum(lo)) return lo
  if (hi > MIN_HIT_DISTANCE_M && withinFrustum(hi)) return hi
  return null
}

/**
 * Ray vs. a finite, axis-aligned, square-footprint box — used for a
 * building obstruction, matching `ObstructionMesh.tsx`'s box geometry
 * (`radiusM * 2` square footprint centered on the obstruction's position,
 * from the ground up to `heightM`).
 *
 * Standard slab method (Kay-Kajiya): intersect the ray against each pair of
 * parallel faces (x, y, z) and narrow the valid `t` interval each time.
 *
 * @param origin Ray origin.
 * @param direction Ray direction (unit vector).
 * @param center Ground-plane (x, y) center of the box's footprint.
 * @param halfExtent Half the box's footprint side length, in meters (so
 *   the footprint spans `[center - halfExtent, center + halfExtent]` in
 *   both x and y).
 * @param zMin Bottom of the box, in meters.
 * @param zMax Top of the box, in meters.
 * @returns Distance `t` to the nearest valid hit, or `null`.
 */
export function rayBoxIntersection(
  origin: Vec3,
  direction: Vec3,
  center: { x: number; y: number },
  halfExtent: number,
  zMin: number,
  zMax: number,
): number | null {
  const bounds = [
    {
      min: center.x - halfExtent,
      max: center.x + halfExtent,
      o: origin.x,
      d: direction.x,
    },
    {
      min: center.y - halfExtent,
      max: center.y + halfExtent,
      o: origin.y,
      d: direction.y,
    },
    { min: zMin, max: zMax, o: origin.z, d: direction.z },
  ]

  let tEnter = -Infinity
  let tExit = Infinity

  for (const { min, max, o, d } of bounds) {
    if (Math.abs(d) < EPSILON) {
      // Ray parallel to this pair of faces: must already be within the slab.
      if (o < min || o > max) return null
      continue
    }
    let t1 = (min - o) / d
    let t2 = (max - o) / d
    if (t1 > t2) [t1, t2] = [t2, t1]
    tEnter = Math.max(tEnter, t1)
    tExit = Math.min(tExit, t2)
    if (tEnter > tExit) return null
  }

  if (tEnter > MIN_HIT_DISTANCE_M) return tEnter
  if (tExit > MIN_HIT_DISTANCE_M) return tExit
  return null
}

/**
 * Splits a `'tree'` `Obstacle`'s `heightM`/`radiusM` into trunk-cylinder and
 * foliage-cone dimensions, with the exact same proportions
 * `ObstructionMesh.tsx` uses to render a tree (trunk = 35% of total height,
 * trunk radius = 12% of canopy radius clamped to a 0.08m minimum, foliage
 * cone fills the rest) — kept in sync so the analytical occlusion test
 * matches what M2's 3D view visually shows.
 */
function treeGeometry(
  position: { x: number; y: number },
  heightM: number,
  radiusM: number,
): {
  trunk: {
    center: { x: number; y: number }
    radius: number
    zMin: number
    zMax: number
  }
  foliage: { apex: Vec3; baseRadius: number; height: number }
} {
  const trunkHeight = heightM * 0.35
  const trunkRadius = Math.max(radiusM * 0.12, 0.08)
  const foliageHeight = Math.max(heightM - trunkHeight, 0.1)
  const canopyTopZ = trunkHeight + foliageHeight

  return {
    trunk: {
      center: position,
      radius: trunkRadius,
      zMin: 0,
      zMax: trunkHeight,
    },
    foliage: {
      apex: { x: position.x, y: position.y, z: canopyTopZ },
      baseRadius: radiusM,
      height: foliageHeight,
    },
  }
}

/**
 * Tests whether a single ray-vs-obstacle intersection occludes: any real,
 * finite-distance hit (`t > MIN_HIT_DISTANCE_M`) counts, regardless of its
 * exact distance — for shadow occlusion, the sun is effectively at
 * infinity, so any obstacle hit anywhere along the ray blocks the beam.
 */
function obstacleHit(
  origin: Vec3,
  direction: Vec3,
  obstacle: Obstacle,
): number | null {
  switch (obstacle.kind) {
    case 'shape':
      return rayPolygonIntersection(origin, direction, obstacle.vertices)
    case 'building': {
      const halfExtent = obstacle.radiusM
      return rayBoxIntersection(
        origin,
        direction,
        obstacle.position,
        halfExtent,
        0,
        obstacle.heightM,
      )
    }
    case 'tree': {
      const { trunk, foliage } = treeGeometry(
        obstacle.position,
        obstacle.heightM,
        obstacle.radiusM,
      )
      const trunkHit = rayCylinderIntersection(
        origin,
        direction,
        trunk.center,
        trunk.radius,
        trunk.zMin,
        trunk.zMax,
      )
      const foliageHit = rayConeIntersection(
        origin,
        direction,
        foliage.apex,
        foliage.baseRadius,
        foliage.height,
      )
      if (trunkHit === null) return foliageHit
      if (foliageHit === null) return trunkHit
      return Math.min(trunkHit, foliageHit)
    }
  }
}

/**
 * Composed entry point: is `panelPosition` occluded from direct sunlight by
 * any of `obstacles`, given the sun's current direction?
 *
 * Tests the ray from the panel toward the sun against every obstacle in
 * turn and returns `true` on the first real (finite-distance, strictly
 * beyond the panel itself) hit — matching the M3 spec's "iterating obstacle
 * primitives and returning true on the first hit". Per the spec's
 * direct-only-occlusion scope decision, this only determines whether the
 * *direct-beam* component should be zeroed for the hour; diffuse skylight
 * is unaffected and handled by the caller (`simulation`'s per-hour loop,
 * issue #77 — out of scope here).
 *
 * @param panelPosition The panel's position, in local ENU meters.
 * @param sunDirection Unit vector from the panel toward the sun, in local
 *   ENU meters (x = east, y = north, z = up). Callers derive this from the
 *   hour's already-computed sun altitude/azimuth (see the M3 spec's
 *   "Simulation loop changes"); this module makes no assumption about how
 *   it was computed beyond it being a unit vector.
 * @param obstacles Candidate shadow-casters (shapes and/or obstructions),
 *   already excluding the panel's own shape (a shape never occludes its
 *   own panels, per the spec).
 */
export function isPanelOccluded(
  panelPosition: Vec3,
  sunDirection: Vec3,
  obstacles: Obstacle[],
): boolean {
  for (const obstacle of obstacles) {
    const hit = obstacleHit(panelPosition, sunDirection, obstacle)
    if (hit !== null && hit > MIN_HIT_DISTANCE_M) return true
  }
  return false
}
