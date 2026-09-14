import { Billboard, Text } from '@react-three/drei'

/**
 * Simple custom north-arrow gizmo: a cone-tipped arrow pointing toward
 * `+y` (north, per `scene/derive`'s local-meters convention: x = east,
 * y = north, z = up) with an "N" label above it, placed at a fixed
 * `position` in the scene (the caller offsets it just outside the
 * rendered shapes' bounds so it doesn't overlap them).
 *
 * Deliberately not one of drei's `GizmoHelper`/`GizmoViewport` — those
 * render a fixed-to-viewport navigation cube (X/Y/Z axis colors), not a
 * scene-anchored compass arrow, which is what the M2 spec and issue #57
 * ask for ("orientation" relative to true north, not a generic axis
 * helper).
 *
 * The "N" label is wrapped in drei's `<Billboard>` (issue #85 item 5):
 * without it, a plain `<Text>` lies flat in this z-up scene (its own local
 * plane, facing `+z` by default), so it's only readable from close to
 * directly overhead — for any other camera angle (the app's default orbit
 * position included) it appears edge-on or upside-down. `<Billboard>`
 * continuously rotates its children to face the active camera, so the
 * label stays legible from wherever the user has orbited to.
 */
export function NorthArrowGizmo({
  position = [0, 0, 0],
  size = 1,
}: {
  position?: [number, number, number]
  size?: number
}) {
  const shaftHeight = size * 0.7
  const headHeight = size * 0.3
  return (
    <group position={position}>
      {/* Shaft: a thin cylinder from the base up to just below the head, laid along +y ("north"). */}
      <mesh position={[0, shaftHeight / 2, 0]} rotation={[0, 0, 0]}>
        <cylinderGeometry args={[size * 0.03, size * 0.03, shaftHeight, 8]} />
        <meshStandardMaterial color="#c0392b" />
      </mesh>
      {/* Head: a cone whose apex points along +y by default in Three.js. */}
      <mesh position={[0, shaftHeight + headHeight / 2, 0]}>
        <coneGeometry args={[size * 0.09, headHeight, 12]} />
        <meshStandardMaterial color="#c0392b" />
      </mesh>
      <Billboard position={[0, size * 1.15, 0]}>
        <Text
          fontSize={size * 0.25}
          color="#c0392b"
          anchorX="center"
          anchorY="bottom"
        >
          N
        </Text>
      </Billboard>
    </group>
  )
}
