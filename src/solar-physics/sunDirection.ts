/**
 * Converts `sunPosition()`'s altitude/azimuth output into the ENU (x=east,
 * y=north, z=up) unit direction vector `shadowOcclusion.ts`'s
 * `isPanelOccluded` expects for its `sunDirection` argument.
 *
 * `simulation/` may only depend on `solar-physics/` and `data-sources/`
 * (never `scene/`, per the module-boundary rule in CLAUDE.md and the M1
 * design spec), so this conversion lives here rather than in `scene/` —
 * `solar-physics/` is a layer both `scene/` and `simulation/` can import
 * from. This used to be duplicated in `scene/scene/sunDirection.ts`
 * (issue #76) because that copy shipped first and this module-boundary
 * rule left no way for `simulation/`'s per-hour occlusion loop (issue #77)
 * to reach into `scene/scene/`; that duplicate has since been removed and
 * `scene/scene/sunScrubber.ts`'s sun-position scrubber now imports this
 * function directly (issue #91, item 4).
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
 * `scene/derive/polygonToExtrusionGeometry.ts` and `geometryBuilders.ts`'s
 * `liftToPlane` already use for this exact conversion: azimuth 0 (north)
 * -> +y, 90 (east) -> +x, 180 (south) -> -y, 270 (west) -> -x. `altitude`
 * is degrees above the horizon
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
