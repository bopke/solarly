/**
 * Obstruction data model for issue #58 ("scene: obstruction placement
 * (trees/buildings) in the 3D view"), part of M2's scene editor
 * (`docs/superpowers/specs/2026-09-13-solarly-m2-design.md`'s "3D scene"
 * step: "The user can click empty ground to place a tree or building
 * obstruction and adjust its height via a small property panel.").
 *
 * Deliberately a plain, minimal data shape — this is what M3's
 * shadow-casting and issues #60/#61 (flow wiring, the "Apply" step) will
 * consume later, per issue #58's scope note, so it stays a flat record
 * rather than growing kind-specific fields now. `radiusM` doubles as
 * "canopy radius" for a tree and "footprint half-width" for a building
 * (both kinds render as roughly axis-symmetric footprints — see
 * `ObstructionMesh.tsx`), which is enough for a schematic view and for a
 * future shadow model to approximate a silhouette from.
 */

import type { Point2D } from '../derive'

export type ObstructionKind = 'tree' | 'building'

export interface Obstruction {
  /** Stable identifier, used as the React key and for lookups on update/delete. */
  id: string
  kind: ObstructionKind
  /**
   * Footprint center, in the same scene-local meters frame as
   * `Scene3DShape` geometry (x = east, y = north, relative to
   * `Scene3DView`'s shared `sceneOrigin` — see `geometryBuilders.ts`'s
   * `offsetToSceneOrigin`). Ground-plane clicks are already resolved into
   * this frame by `intersectGroundPlane`, so no further offset is needed
   * when placing or rendering an obstruction.
   */
  position: Point2D
  /** Height above ground, in meters. */
  heightM: number
  /** Canopy radius (tree) or footprint half-width (building), in meters. */
  radiusM: number
}

const DEFAULT_TREE_HEIGHT_M = 5
const DEFAULT_TREE_RADIUS_M = 1.5
const DEFAULT_BUILDING_HEIGHT_M = 6
const DEFAULT_BUILDING_RADIUS_M = 3

export const MIN_OBSTRUCTION_HEIGHT_M = 0.5
export const MIN_OBSTRUCTION_RADIUS_M = 0.2

let fallbackIdCounter = 0

/**
 * Generates a reasonably-unique obstruction id. Prefers `crypto.randomUUID`
 * (available in every environment this app targets — evergreen browsers,
 * and Vitest's jsdom, both expose it) with a small counter-based fallback
 * so this never throws in an unusual environment.
 */
function generateObstructionId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  fallbackIdCounter += 1
  return `obstruction-${fallbackIdCounter}`
}

/** Builds a new obstruction of the given kind at `position`, with sensible default height/radius for that kind. */
export function createObstruction(
  kind: ObstructionKind,
  position: Point2D,
): Obstruction {
  return {
    id: generateObstructionId(),
    kind,
    position,
    heightM:
      kind === 'tree' ? DEFAULT_TREE_HEIGHT_M : DEFAULT_BUILDING_HEIGHT_M,
    radiusM:
      kind === 'tree' ? DEFAULT_TREE_RADIUS_M : DEFAULT_BUILDING_RADIUS_M,
  }
}
