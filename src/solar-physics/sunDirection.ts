/**
 * Converts `sunPosition()`'s altitude/azimuth output into the ENU (x=east,
 * y=north, z=up) unit direction vector `shadowOcclusion.ts`'s
 * `isPanelOccluded` expects for its `sunDirection` argument.
 *
 * This is a deliberate, small duplicate of `scene/scene/sunDirection.ts`'s
 * `sunAltitudeAzimuthToEnuDirection` (issue #76), not an import of it:
 * `simulation/` may only depend on `solar-physics/` and `data-sources/`
 * (never `scene/`, per the module-boundary rule in CLAUDE.md and the M1
 * design spec), so a helper living in `scene/scene/` is the wrong layer
 * for `simulation/`'s per-hour occlusion loop (issue #77) to reach into.
 * `solar-physics/` is a layer both `scene/` and `simulation/` can import
 * from, so this keeps the conversion logic co-located with `sunPosition`
 * itself rather than introducing a new cross-module dependency. The two
 * copies are the exact same formula (see below) — worth consolidating
 * into one shared implementation later (flagged in issue #77's PR
 * description as a follow-up), but out of scope to do here since #76's
 * copy is already shipped/reviewed and this module boundary rule leaves
 * no third option.
 *
 * Pure function — no I/O, no dependency on any other module.
 */

import type { Vec3 } from './shadowOcclusion'

/**
 * Converts a sun altitude/azimuth pair (as returned by
 * `solar-physics/sunPosition`) into a unit ENU direction vector pointing
 * *from a point in the scene toward the sun*.
 *
 * `sunPosition`'s `azimuth` is degrees clockwise from true north (0-360,
 * see its own doc comment) — matching the same `x = sin, y = cos` mapping
 * `scene/derive/polygonToExtrusionGeometry.ts`, `geometryBuilders.ts`'s
 * `liftToPlane`, and `scene/scene/sunDirection.ts` already use for this
 * exact conversion: azimuth 0 (north) -> +y, 90 (east) -> +x, 180 (south)
 * -> -y, 270 (west) -> -x. `altitude` is degrees above the horizon
 * (negative when the sun is below it); `cos(altitude)` scales the
 * horizontal (x, y) component down as the sun climbs toward zenith, and
 * `sin(altitude)` gives the vertical (z) component, so at altitude=90
 * (straight up) this correctly collapses to `(0, 0, 1)` regardless of
 * azimuth. Callers with the sun below the horizon (altitude <= 0) still
 * get a well-formed (if physically moot) unit vector — `isPanelOccluded`
 * makes no assumption about sun-above-horizon, and any hour with the sun
 * below the horizon already has a zero direct-beam component from
 * `decomposeGhi`, so this vector's exact direction is inconsequential in
 * that case (see `runTmySimulation`/`runLiveSimulation`'s doc comments on
 * how this is used).
 */
export function sunAltitudeAzimuthToEnuDirection(
  altitudeDeg: number,
  azimuthDeg: number,
): Vec3 {
  const altRad = (altitudeDeg * Math.PI) / 180
  const azRad = (azimuthDeg * Math.PI) / 180
  const horizontal = Math.cos(altRad)
  return {
    x: horizontal * Math.sin(azRad),
    y: horizontal * Math.cos(azRad),
    z: Math.sin(altRad),
  }
}
