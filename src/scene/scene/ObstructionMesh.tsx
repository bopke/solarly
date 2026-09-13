import type { ThreeEvent } from '@react-three/fiber'
import type { Obstruction } from './obstructions'

/**
 * Simple schematic obstruction geometry, consistent with the rest of the
 * scene's non-photorealistic style (flat-colored primitives, no
 * textures — see `NorthArrowGizmo.tsx`): a tree is a cylinder trunk
 * topped with a cone of foliage; a building is a box. Both use Three.js'
 * built-in geometries (`cylinderGeometry`/`coneGeometry`/`boxGeometry`),
 * which default to a *local +y* height axis — the same convention
 * `NorthArrowGizmo` relies on for its arrow shaft/head. To stand upright
 * in this scene's z-up convention (`scene/derive`'s x=east/y=north/z=up),
 * each obstruction is wrapped in a group rotated -90 deg about x (`[Math.PI
 * / 2, 0, 0]`), which maps local +y to world +z; children are then
 * positioned using local-y "height" the same way `NorthArrowGizmo`
 * positions its shaft/head.
 */

const TRUNK_COLOR = '#6b4423'
const FOLIAGE_COLOR = '#3f7d3f'
const FOLIAGE_COLOR_SELECTED = '#5aa85a'
const BUILDING_COLOR = '#9c8a72'
const BUILDING_COLOR_SELECTED = '#c2af92'

export interface ObstructionMeshProps {
  obstruction: Obstruction
  selected: boolean
  onSelect: (id: string) => void
}

export function ObstructionMesh({
  obstruction,
  selected,
  onSelect,
}: ObstructionMeshProps) {
  const { id, kind, position, heightM, radiusM } = obstruction

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    // Selecting an obstruction must not also place a new one on the
    // ground plane behind/below it — see `Scene3DView`'s ground-plane
    // click handler, which places on any click that reaches it.
    event.stopPropagation()
    onSelect(id)
  }

  if (kind === 'tree') {
    const trunkHeight = heightM * 0.35
    const trunkRadius = Math.max(radiusM * 0.12, 0.08)
    const foliageHeight = Math.max(heightM - trunkHeight, 0.1)
    return (
      <group
        position={[position.x, position.y, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        onClick={handleClick}
        name={`obstruction-tree-${id}`}
      >
        <mesh position={[0, trunkHeight / 2, 0]}>
          <cylinderGeometry args={[trunkRadius, trunkRadius, trunkHeight, 8]} />
          <meshStandardMaterial color={TRUNK_COLOR} />
        </mesh>
        <mesh position={[0, trunkHeight + foliageHeight / 2, 0]}>
          <coneGeometry args={[radiusM, foliageHeight, 12]} />
          <meshStandardMaterial
            color={selected ? FOLIAGE_COLOR_SELECTED : FOLIAGE_COLOR}
          />
        </mesh>
      </group>
    )
  }

  return (
    <group
      position={[position.x, position.y, 0]}
      rotation={[Math.PI / 2, 0, 0]}
      onClick={handleClick}
      name={`obstruction-building-${id}`}
    >
      <mesh position={[0, heightM / 2, 0]}>
        <boxGeometry args={[radiusM * 2, heightM, radiusM * 2]} />
        <meshStandardMaterial
          color={selected ? BUILDING_COLOR_SELECTED : BUILDING_COLOR}
        />
      </mesh>
    </group>
  )
}
