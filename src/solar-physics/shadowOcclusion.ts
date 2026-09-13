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
 * Computes a planar polygon's normal via Newell's method — summing the
 * cross-product contribution of every edge, rather than taking a single
 * vertex triple's cross product. This is robust to a degenerate *leading*
 * triple: a traced polygon can legitimately contain redundant collinear
 * vertices (e.g. from a tracing tool adding extra points along a straight
 * edge — see `scene/derive/geo.ts`'s doc comment on that), and if the first
 * three vertices happen to be collinear, `cross(v1-v0, v2-v0)` is the zero
 * vector even though the polygon as a whole is perfectly valid and planar.
 * Newell's method sums every edge pair, so any single degenerate triple
 * (or several) contributes zero to the sum without zeroing it out, as long
 * as the polygon isn't degenerate overall.
 */
function newellNormal(vertices: Vec3[]): Vec3 {
  let nx = 0
  let ny = 0
  let nz = 0
  const n = vertices.length
  for (let i = 0; i < n; i++) {
    const curr = vertices[i]
    const next = vertices[(i + 1) % n]
    nx += (curr.y - next.y) * (curr.z + next.z)
    ny += (curr.z - next.z) * (curr.x + next.x)
    nz += (curr.x - next.x) * (curr.y + next.y)
  }
  return { x: nx, y: ny, z: nz }
}

/**
 * The first edge (consecutive-vertex difference, wrapping around) with a
 * non-negligible length, used as the polygon's 2D-projection basis vector.
 * Scanning forward (rather than assuming `vertices[1] - vertices[0]`) keeps
 * this robust to a leading run of coincident vertices, the same class of
 * degenerate input `newellNormal` is robust to.
 */
function firstNonDegenerateEdge(vertices: Vec3[]): Vec3 | null {
  const n = vertices.length
  for (let i = 0; i < n; i++) {
    const edge = subtract(vertices[(i + 1) % n], vertices[i])
    if (length(edge) >= EPSILON) return edge
  }
  return null
}

/**
 * Ray vs. a finite planar polygon in 3D (used for shape/roof occlusion — a
 * shape's already-extruded 3D vertices, e.g. from `scene/derive`'s
 * `polygonToExtrusionGeometry`, passed as a raw `Vec3[]`).
 *
 * Two-stage test: (1) ray-vs-infinite-plane, using the plane's normal
 * computed via Newell's method across every edge (robust to a degenerate
 * leading vertex triple — see `newellNormal`); (2) point-in-polygon on the
 * hit point, projected into the plane's own 2D basis (so it works for a
 * plane at any tilt/orientation, not just axis-aligned ones).
 *
 * @param origin Ray origin (e.g. a panel position).
 * @param direction Ray direction. Must be a unit vector (callers normalize
 *   once and reuse, e.g. `isPanelOccluded`'s `sunDirection`).
 * @param vertices The polygon's vertices, in order (>= 3), assumed planar
 *   and non-degenerate as a whole (already validated upstream — see the M3
 *   spec's "Error handling" section) — but individual redundant collinear
 *   vertices are expected and handled, not assumed absent.
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
  const normal = newellNormal(vertices)
  const normalLen = length(normal)
  if (normalLen < EPSILON) return null // degenerate (collinear/coincident) polygon

  const denom = dot(normal, direction)
  if (Math.abs(denom) < EPSILON) return null // ray parallel to plane

  const t = dot(subtract(v0, origin), normal) / denom
  if (!(t > MIN_HIT_DISTANCE_M)) return null

  const hit = pointAt(origin, direction, t)

  // Project the hit point and polygon into the plane's own 2D basis (u, v)
  // so point-in-polygon works regardless of the plane's 3D orientation.
  const basisEdge = firstNonDegenerateEdge(vertices)
  if (basisEdge === null) return null // degenerate: all vertices coincide
  const u = normalize(basisEdge)
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
 * Ray vs. a finite, vertical (z-axis-aligned) *capped* cylinder — used for a
 * tree obstruction's trunk. Models the lateral surface AND the top/bottom
 * end-cap disks, so a ray that enters or exits through a cap (rather than
 * the lateral surface) is still correctly detected — e.g. a near-vertical
 * ray passing close to the axis, whose lateral-surface crossing (if any)
 * falls outside `[zMin, zMax]` even though the ray genuinely passes through
 * the cylinder's volume via one of its end caps.
 *
 * @param origin Ray origin.
 * @param direction Ray direction (unit vector).
 * @param center Ground-plane (x, y) center of the cylinder's axis.
 * @param radius Cylinder radius, in meters.
 * @param zMin Bottom of the cylinder, in meters (z, up).
 * @param zMax Top of the cylinder, in meters.
 * @returns Distance `t` to the nearest valid hit (lateral surface or either
 *   end cap), or `null`.
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
  const dz = direction.z

  const withinHeight = (t: number): boolean => {
    const z = origin.z + t * dz
    return z >= zMin && z <= zMax
  }

  const candidates: number[] = []

  // Lateral surface: skipped (not just guarded) when the ray is
  // (near-)parallel to the axis, since the quadratic's `a` coefficient goes
  // to zero there — any real crossing in that case is via an end cap,
  // handled below.
  const a = dx * dx + dy * dy
  if (a >= EPSILON) {
    const b = 2 * (ox * dx + oy * dy)
    const c = ox * ox + oy * oy - radius * radius
    const discriminant = b * b - 4 * a * c
    if (discriminant >= 0) {
      const sqrtDisc = Math.sqrt(discriminant)
      const t1 = (-b - sqrtDisc) / (2 * a)
      const t2 = (-b + sqrtDisc) / (2 * a)
      if (withinHeight(t1)) candidates.push(t1)
      if (withinHeight(t2)) candidates.push(t2)
    }
  }

  // End caps: ray vs. the plane at z = zMin / zMax, then check the hit
  // point falls within the cap's circular disk (radius from the axis).
  // Skipped only when the ray travels purely horizontally (dz ~ 0), since
  // it then never crosses a cap plane at all (or runs along it, a
  // measure-zero case not worth special-casing).
  if (Math.abs(dz) >= EPSILON) {
    for (const zCap of [zMin, zMax]) {
      const t = (zCap - origin.z) / dz
      const hx = ox + t * dx
      const hy = oy + t * dy
      if (hx * hx + hy * hy <= radius * radius) candidates.push(t)
    }
  }

  const valid = candidates.filter((t) => t > MIN_HIT_DISTANCE_M)
  if (valid.length === 0) return null
  return Math.min(...valid)
}

/**
 * Ray vs. a finite, upward-pointing (apex-up) circular cone with a flat
 * circular base cap — used for a tree obstruction's foliage canopy, sitting
 * atop its trunk cylinder. See `treeGeometry` for how a `'tree'` `Obstacle`'s
 * `heightM`/`radiusM` are split into trunk + cone dimensions, matching
 * `ObstructionMesh.tsx`.
 *
 * Models both the lateral (sloped) surface and the flat base disk, and
 * returns the nearest valid hit among them — a ray can enter the cone's
 * volume through either, and picking the lateral surface's root nearest the
 * origin isn't enough on its own: a ray that actually enters through the
 * (unmodeled-until-now) base cap has no valid lateral root at its true entry
 * point, so a naive "nearest lateral root" search skips straight to the
 * lateral *exit* point instead, returning a too-large distance.
 *
 * @param origin Ray origin.
 * @param direction Ray direction (unit vector).
 * @param apex The cone's apex (tip), at the top of the canopy.
 * @param baseRadius Radius of the cone's base, in meters.
 * @param height Vertical extent of the cone (apex.z - baseZ), in meters. Must be > 0.
 * @returns Distance `t` to the nearest valid hit (lateral surface or base
 *   cap), or `null`.
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
  // below excludes the unwanted opposite nappe. This models the lateral
  // (sloped) surface only, extended infinitely in both nappes — the base
  // cap is handled separately below.
  const a = dx * dx + dy * dy - k * k * dz * dz
  const b = 2 * (px * dx + py * dy + k * k * ez * dz)
  const c = px * px + py * py - k * k * ez * ez

  const withinLateralFrustum = (t: number): boolean => {
    const z = origin.z + t * dz
    return z <= apex.z && z >= apex.z - height
  }

  const candidates: number[] = []

  if (Math.abs(a) < EPSILON) {
    if (Math.abs(b) >= EPSILON) {
      const t = -c / b
      if (withinLateralFrustum(t)) candidates.push(t)
    }
  } else {
    const discriminant = b * b - 4 * a * c
    if (discriminant >= 0) {
      const sqrtDisc = Math.sqrt(discriminant)
      const t1 = (-b - sqrtDisc) / (2 * a)
      const t2 = (-b + sqrtDisc) / (2 * a)
      if (withinLateralFrustum(t1)) candidates.push(t1)
      if (withinLateralFrustum(t2)) candidates.push(t2)
    }
  }

  // Base cap: ray vs. the flat disk at z = apex.z - height, radius
  // baseRadius, centered on the axis. Skipped only when the ray travels
  // purely horizontally (dz ~ 0), since it then never crosses the cap
  // plane at all.
  if (Math.abs(dz) >= EPSILON) {
    const baseZ = apex.z - height
    const t = (baseZ - origin.z) / dz
    const hx = origin.x + t * dx - apex.x
    const hy = origin.y + t * dy - apex.y
    if (hx * hx + hy * hy <= baseRadius * baseRadius) candidates.push(t)
  }

  const valid = candidates.filter((t) => t > MIN_HIT_DISTANCE_M)
  if (valid.length === 0) return null
  return Math.min(...valid)
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
 *   it was computed beyond it being a unit vector, and does not validate or
 *   re-normalize it. This is a deliberate choice, not an oversight: unlike
 *   `poaIrradiance` (a public per-hour entry point that guards its inputs),
 *   `isPanelOccluded` and its primitives are internal geometric building
 *   blocks called from inside a per-panel, per-hour inner loop — not a
 *   public API boundary a caller reaches directly with raw external data.
 *   Validating here would duplicate a check that belongs once, at the call
 *   site that derives `sunDirection` from altitude/azimuth, not repeated on
 *   every obstacle test. A malformed direction (NaN/zero/non-unit) fails
 *   open — it yields no shading rather than throwing — which is verified
 *   behavior, not an assumption.
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
