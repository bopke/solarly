/**
 * Pure Three.js `BufferGeometry` builders for the R3F scene view.
 *
 * Kept separate from `Scene3DView.tsx` (and free of any React/R3F import)
 * so the actual vertex/index math can be unit-tested directly under
 * Vitest/jsdom — constructing a `THREE.BufferGeometry` needs no WebGL
 * context, only rendering it does. See `Scene3DView.test.tsx` for the
 * "mocked Canvas" rendering smoke tests and the module README for why the
 * split is worth it.
 */

import * as THREE from 'three'
import type { ExtrusionGeometry, Vec3 } from '../derive'
import type { PanelPlacement } from '../derive'
import type { Point2D } from '../derive'

/**
 * Height/depth of a rendered panel "box", in meters. Schematic only — this
 * project's real panels are a few cm thick, but a visually-legible schematic
 * view benefits from a slightly exaggerated thickness so panels read as
 * distinct volumes rather than paper-thin coincident planes. Not tied to
 * any panel preset's real thickness (none of the panel-presets fields
 * carry one).
 */
export const PANEL_THICKNESS_M = 0.04

/**
 * Builds the flat (tilted) plane mesh geometry for one shape, from its
 * `ExtrusionGeometry.vertices` (already in 3D local meters, planar by
 * construction — see `polygonToExtrusionGeometry`'s module doc). Uses
 * `THREE.ShapeUtils.triangulateShape` to triangulate the polygon by index
 * in its own local (x, y) plan-view coordinates (identical to the polygon's
 * original winding — see that module's doc for why a tilted vertex's own
 * `(x, y)` always equals its plan-view `(x, y)`), then re-attaches the real
 * (tilted) `z` per vertex. Vertex winding isn't normalized to a particular
 * front-facing convention (a traced polygon's winding order isn't
 * guaranteed), so the caller should render this with a double-sided
 * material rather than relying on face culling.
 */
export function buildPlaneGeometry(vertices: Vec3[]): THREE.BufferGeometry {
  const flat = vertices.map((v) => new THREE.Vector2(v.x, v.y))
  const triangles = THREE.ShapeUtils.triangulateShape(flat, [])

  const positions = new Float32Array(vertices.length * 3)
  vertices.forEach((v, i) => {
    positions[i * 3] = v.x
    positions[i * 3 + 1] = v.y
    positions[i * 3 + 2] = v.z
  })

  const index: number[] = []
  for (const [a, b, c] of triangles) {
    index.push(a, b, c)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Lifts a plan-view `(x, y)` point onto a shape's tilted plane, returning
 * its `z`. Mirrors `polygonToExtrusionGeometry`'s own per-vertex formula
 * (documented in `panelAutoFillGrid.ts`'s "Coordinate space" section as the
 * contract a renderer composing the two functions should use): a point's
 * `(x, y)` never changes, only its height above the plan-view footprint.
 */
export function liftToPlane(
  point: Point2D,
  tiltDeg: number,
  azimuthDeg: number,
): number {
  const tiltRad = (tiltDeg * Math.PI) / 180
  const azimuthRad = (azimuthDeg * Math.PI) / 180
  const slope = { x: Math.sin(azimuthRad), y: Math.cos(azimuthRad) }
  const s = point.x * slope.x + point.y * slope.y
  return -s * Math.tan(tiltRad)
}

/**
 * Builds one merged `BufferGeometry` containing an extruded "box" for every
 * placed panel on a shape (all panels of a shape share one geometry/mesh
 * for render performance, rather than one draw call per panel).
 *
 * Each panel's 4 plan-view corners (from `panelAutoFillGrid`'s
 * `PanelPlacement.corners`) are lifted onto the shape's tilted plane via
 * `liftToPlane` (so a panel is a parallelogram on the tilted surface, not
 * necessarily an axis-aligned rectangle in 3D, when azimuth isn't a
 * multiple of 90 degrees — see `panelAutoFillGrid`'s module doc for why its
 * grid is axis-aligned in plan view rather than rotated to the azimuth).
 * The panel is then given a small thickness by offsetting a second set of
 * corners along the shape's surface `normal`. The lifted (on-plane) corners
 * form the box's *bottom* face, and the box is extruded *upward* — along
 * `+normal` — to build the top face, so the panel sits visibly above the
 * roof surface rather than being coplanar with it (a coplanar top face
 * causes z-fighting against the roof mesh underneath — see the PR #68
 * review for the render artifact this produced before the fix).
 */
export function buildPanelsGeometry(
  panels: PanelPlacement[],
  tiltDeg: number,
  azimuthDeg: number,
  normal: Vec3,
  thicknessM: number = PANEL_THICKNESS_M,
): THREE.BufferGeometry {
  const positions: number[] = []
  const index: number[] = []

  const pushQuad = (
    base: number,
    a: number,
    b: number,
    c: number,
    d: number,
  ) => {
    index.push(base + a, base + b, base + c, base + a, base + c, base + d)
  }

  for (const panel of panels) {
    const bottom: Vec3[] = panel.corners.map((c) => ({
      x: c.x,
      y: c.y,
      z: liftToPlane(c, tiltDeg, azimuthDeg),
    }))
    const top: Vec3[] = bottom.map((c) => ({
      x: c.x + normal.x * thicknessM,
      y: c.y + normal.y * thicknessM,
      z: c.z + normal.z * thicknessM,
    }))

    const base = positions.length / 3
    for (const v of [...top, ...bottom]) {
      positions.push(v.x, v.y, v.z)
    }

    // top (0-3), bottom (4-7, reverse winding so it faces outward/down)
    pushQuad(base, 0, 1, 2, 3)
    pushQuad(base, 7, 6, 5, 4)
    // four sides
    pushQuad(base, 0, 4, 5, 1)
    pushQuad(base, 1, 5, 6, 2)
    pushQuad(base, 2, 6, 7, 3)
    pushQuad(base, 3, 7, 4, 0)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(positions), 3),
  )
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/** Axis-aligned bounding box of a set of 3D points, in local meters. */
export interface Bounds3 {
  min: Vec3
  max: Vec3
}

export function computeBounds(points: Vec3[]): Bounds3 {
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const p of points) {
    if (p.x < min.x) min.x = p.x
    if (p.y < min.y) min.y = p.y
    if (p.z < min.z) min.z = p.z
    if (p.x > max.x) max.x = p.x
    if (p.y > max.y) max.y = p.y
    if (p.z > max.z) max.z = p.z
  }
  return { min, max }
}

export function mergeBounds(bounds: Bounds3[]): Bounds3 {
  if (bounds.length === 0) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }
  }
  return bounds.reduce((acc, b) => ({
    min: {
      x: Math.min(acc.min.x, b.min.x),
      y: Math.min(acc.min.y, b.min.y),
      z: Math.min(acc.min.z, b.min.z),
    },
    max: {
      x: Math.max(acc.max.x, b.max.x),
      y: Math.max(acc.max.y, b.max.y),
      z: Math.max(acc.max.z, b.max.z),
    },
  }))
}

/**
 * Offsets a shape's local-meters vertices (relative to its own
 * `ExtrusionGeometry.origin`) into one scene-wide local frame, relative to
 * `sceneOrigin`. Every `ExtrusionGeometry` is independently centered on its
 * own polygon's centroid (see that module's doc), so multiple shapes can't
 * be rendered at face value in the same scene without this — otherwise two
 * shapes from different roof faces would both render centered on `(0, 0)`
 * and overlap regardless of their real relative position.
 *
 * Reuses the same small-scale equirectangular approximation
 * `scene/derive/geo.ts` already relies on (see its module doc): summing
 * two independently-projected local-meters offsets isn't exactly
 * equivalent to a single projection centered on `sceneOrigin`, but the
 * error is negligible at the plot/roof scale this project targets.
 */
export function offsetToSceneOrigin(
  shapeOrigin: { lat: number; lon: number },
  sceneOrigin: { lat: number; lon: number },
): Point2D {
  const EARTH_RADIUS_M = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const originLatRad = toRad(sceneOrigin.lat)
  return {
    x:
      toRad(shapeOrigin.lon - sceneOrigin.lon) *
      Math.cos(originLatRad) *
      EARTH_RADIUS_M,
    y: toRad(shapeOrigin.lat - sceneOrigin.lat) * EARTH_RADIUS_M,
  }
}

/** Translates a shape's `ExtrusionGeometry` vertices by a 2D (x, y) offset. */
export function translateVertices(vertices: Vec3[], offset: Point2D): Vec3[] {
  return vertices.map((v) => ({ x: v.x + offset.x, y: v.y + offset.y, z: v.z }))
}

export type { ExtrusionGeometry }
