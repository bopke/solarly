import { useMemo } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type {
  ExtrusionGeometry,
  PanelAutoFillOptions,
  PanelDimensions,
} from '../derive'
import { panelAutoFillGrid } from '../derive'
import {
  buildPanelsGeometry,
  buildPlaneGeometry,
  computeBounds,
  mergeBounds,
  offsetToSceneOrigin,
  type Bounds3,
} from './geometryBuilders'
import { NorthArrowGizmo } from './NorthArrowGizmo'
import styles from './Scene3DView.module.css'

/**
 * One configured shape to render: its already-derived tilted-plane
 * geometry (`ExtrusionGeometry`, from `scene/derive`'s
 * `polygonToExtrusionGeometry` — this component does not trace, tilt, or
 * orient anything itself, it only renders what it's given) plus the panel
 * preset and layout options to auto-fill it with.
 */
export interface Scene3DShape {
  /** Stable identifier (e.g. the traced shape's id), used as the React key. */
  id: string
  geometry: ExtrusionGeometry
  /**
   * Panel dimensions to auto-fill this shape with (`widthMm`/`heightMm`,
   * matching a `panel-presets/` entry). Falls back to `Scene3DView`'s
   * `defaultPanel` prop when omitted — a shape with neither renders its
   * plane with no panel grid.
   */
  panel?: PanelDimensions
  /** Panel auto-fill layout options (spacing, orientation, excluded cells) for this shape only. */
  panelFillOptions?: PanelAutoFillOptions
}

export interface Scene3DViewProps {
  /** One or more configured shapes to render. */
  shapes: Scene3DShape[]
  /** Panel dimensions used for any shape that doesn't specify its own `panel`. */
  defaultPanel?: PanelDimensions
  /** Applied to the wrapping element, for layout/sizing by the caller. */
  className?: string
}

const PLANE_COLOR = '#93a3b8'
const PANEL_COLOR = '#1f3a5f'

function ShapeMesh({
  shape,
  defaultPanel,
  sceneOrigin,
}: {
  shape: Scene3DShape
  defaultPanel: PanelDimensions | undefined
  sceneOrigin: { lat: number; lon: number }
}) {
  const { geometry } = shape
  const panelDims = shape.panel ?? defaultPanel

  const offset = useMemo(
    () => offsetToSceneOrigin(geometry.origin, sceneOrigin),
    [geometry.origin, sceneOrigin],
  )

  const planeGeometry = useMemo(
    () => buildPlaneGeometry(geometry.vertices),
    [geometry.vertices],
  )

  const panels = useMemo(() => {
    if (!panelDims) return []
    const footprint = geometry.vertices.map((v) => ({ x: v.x, y: v.y }))
    return panelAutoFillGrid(footprint, panelDims, shape.panelFillOptions)
      .panels
  }, [geometry.vertices, panelDims, shape.panelFillOptions])

  const panelsGeometry = useMemo(
    () =>
      panels.length > 0
        ? buildPanelsGeometry(
            panels,
            geometry.tiltDeg,
            geometry.azimuthDeg,
            geometry.normal,
          )
        : undefined,
    [panels, geometry.tiltDeg, geometry.azimuthDeg, geometry.normal],
  )

  return (
    <group position={[offset.x, offset.y, 0]}>
      <mesh geometry={planeGeometry}>
        <meshStandardMaterial color={PLANE_COLOR} side={THREE.DoubleSide} />
      </mesh>
      {panelsGeometry && (
        <mesh geometry={panelsGeometry}>
          <meshStandardMaterial color={PANEL_COLOR} />
        </mesh>
      )}
    </group>
  )
}

/** Bounds of one shape's rendered footprint, in the shared scene-local frame. */
function shapeBounds(
  shape: Scene3DShape,
  sceneOrigin: { lat: number; lon: number },
): Bounds3 {
  const offset = offsetToSceneOrigin(shape.geometry.origin, sceneOrigin)
  const bounds = computeBounds(shape.geometry.vertices)
  return {
    min: {
      x: bounds.min.x + offset.x,
      y: bounds.min.y + offset.y,
      z: bounds.min.z,
    },
    max: {
      x: bounds.max.x + offset.x,
      y: bounds.max.y + offset.y,
      z: bounds.max.z,
    },
  }
}

/**
 * A React Three Fiber 3D view of one or more configured shapes, each an
 * auto-filled panel grid on a tilted plane, per issue #57 / the M2 design
 * spec's "3D scene" step. This component is intentionally self-contained:
 * it takes already-derived geometry as props (from `scene/derive`) and
 * renders it, with an orbit camera and a north-arrow gizmo for
 * orientation — it does not trace shapes, edit tilt/azimuth, place
 * obstructions (#58), or wire into the app's data flow (#60); those are
 * later issues that compose this component.
 */
export function Scene3DView({
  shapes,
  defaultPanel,
  className,
}: Scene3DViewProps) {
  // Every `ExtrusionGeometry` is independently centered on its own
  // polygon's centroid (see that module's doc) — pick the first shape's
  // origin as the shared scene-local frame's reference point so multiple
  // shapes render at their correct relative positions instead of all
  // piling up at (0, 0). Arbitrary but harmless: only relative rendering
  // position depends on this choice, nothing else.
  const firstShapeOrigin = shapes[0]?.geometry.origin
  const sceneOrigin = useMemo(
    () => firstShapeOrigin ?? { lat: 0, lon: 0 },
    [firstShapeOrigin],
  )

  const bounds = useMemo(() => {
    if (shapes.length === 0) {
      return { min: { x: -5, y: -5, z: 0 }, max: { x: 5, y: 5, z: 2 } }
    }
    return mergeBounds(shapes.map((s) => shapeBounds(s, sceneOrigin)))
  }, [shapes, sceneOrigin])

  const { cameraPosition, target, gizmoPosition, gridSize } = useMemo(() => {
    const spanX = bounds.max.x - bounds.min.x
    const spanY = bounds.max.y - bounds.min.y
    const centerX = (bounds.min.x + bounds.max.x) / 2
    const centerY = (bounds.min.y + bounds.max.y) / 2
    const centerZ = (bounds.min.z + bounds.max.z) / 2
    const span = Math.max(spanX, spanY, 4)
    const distance = span * 1.4
    return {
      cameraPosition: [
        centerX + distance,
        centerY - distance,
        centerZ + distance * 0.9,
      ] as [number, number, number],
      target: [centerX, centerY, centerZ] as [number, number, number],
      gizmoPosition: [
        bounds.min.x - span * 0.15,
        bounds.max.y + span * 0.15,
        0,
      ] as [number, number, number],
      gridSize: Math.ceil(span * 1.6),
    }
  }, [bounds])

  return (
    <div className={[styles.viewport, className].filter(Boolean).join(' ')}>
      <Canvas camera={{ position: cameraPosition, fov: 45, up: [0, 0, 1] }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[20, -10, 30]} intensity={0.9} />
        <OrbitControls makeDefault target={target} />
        <NorthArrowGizmo
          position={gizmoPosition}
          size={Math.max(gridSize * 0.08, 1)}
        />
        <gridHelper
          args={[gridSize, Math.max(1, Math.round(gridSize / 2))]}
          rotation={[Math.PI / 2, 0, 0]}
        />
        {shapes.map((shape) => (
          <ShapeMesh
            key={shape.id}
            shape={shape}
            defaultPanel={defaultPanel}
            sceneOrigin={sceneOrigin}
          />
        ))}
      </Canvas>
    </div>
  )
}
