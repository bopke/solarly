import { useMemo, useState } from 'react'
import * as THREE from 'three'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type {
  ExtrusionGeometry,
  PanelAutoFillOptions,
  PanelDimensions,
  Point2D,
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
import { ObstructionMesh } from './ObstructionMesh'
import { ObstructionPropertyPanel } from './ObstructionPropertyPanel'
import {
  createObstruction,
  type Obstruction,
  type ObstructionKind,
} from './obstructions'
import { intersectGroundPlane } from './obstructionPlacement'
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
  /**
   * Placed obstructions to render (trees/buildings, issue #58). Controlled:
   * when supplied, `Scene3DView` doesn't keep its own obstruction list and
   * every add/edit/delete is reported via `onObstructionsChange` for the
   * caller to apply. Omit both this and `onObstructionsChange` to let
   * `Scene3DView` manage the list itself (seeded from
   * `defaultObstructions`) — useful for standalone use/demos; the app's
   * real integration (#60) is expected to control this, the same way
   * `AppShell` supports controlled `mode`/`activeTab` but defaults to
   * owning them itself.
   */
  obstructions?: Obstruction[]
  /** Initial obstruction list for the *uncontrolled* case (`obstructions` omitted). Ignored when `obstructions` is supplied. */
  defaultObstructions?: Obstruction[]
  /** Called with the full next obstruction list on every add/edit/delete. Required to react to changes when `obstructions` is controlled; optional (but still called) in the uncontrolled case. */
  onObstructionsChange?: (obstructions: Obstruction[]) => void
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
      {/*
        Stops a click on a roof/plane from falling through to the
        invisible ground-plane mesh behind/below it (R3F only raycasts
        objects that have at least one pointer handler registered, so
        without this a plane mesh — which has no handler of its own —
        would be silently skipped and the click would place an
        obstruction underneath it instead of doing nothing).
      */}
      <mesh
        geometry={planeGeometry}
        onClick={(event: ThreeEvent<MouseEvent>) => event.stopPropagation()}
      >
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
 * spec's "3D scene" step, plus (issue #58) placed tree/building
 * obstructions. This component takes already-derived geometry as props
 * (from `scene/derive`) and renders it, with an orbit camera and a
 * north-arrow gizmo for orientation — it does not trace shapes, edit
 * tilt/azimuth, or wire into the app's data flow (#60); those are later
 * issues that compose this component.
 *
 * ## Obstruction placement: click-to-place + numeric adjust, not drag
 *
 * The design spec asks for "click empty ground to place a tree or
 * building obstruction and adjust its height via a small property
 * panel." Height obviously can't come from a single ground click (a click
 * only ever resolves to a point on the z=0 ground plane — see
 * `intersectGroundPlane` — it carries no vertical information), so some
 * separate height control is required regardless.
 *
 * For *moving* an already-placed obstruction, an in-3D drag gesture was
 * considered and deliberately not built: `OrbitControls` already owns the
 * canvas's left-drag gesture for orbiting the camera, and disabling or
 * conditionally intercepting that per-obstruction (only when a drag
 * starts on an obstruction mesh, not empty space) adds real complexity
 * and gesture-conflict risk for a milestone that explicitly excludes
 * shadow math and full flow wiring. Click-to-place plus a plain numeric
 * X/Y field in the property panel (`ObstructionPropertyPanel`) gives the
 * same capability — reposition an obstruction — with a much smaller,
 * more testable surface, consistent with this project's general
 * preference for simple, explicit UI over gesture-heavy interactions
 * elsewhere (see e.g. the system-config form). This can be revisited if
 * a future issue finds drag genuinely necessary.
 */
export function Scene3DView({
  shapes,
  defaultPanel,
  className,
  obstructions: controlledObstructions,
  defaultObstructions,
  onObstructionsChange,
}: Scene3DViewProps) {
  const isControlled = controlledObstructions !== undefined
  const [internalObstructions, setInternalObstructions] = useState<
    Obstruction[]
  >(defaultObstructions ?? [])
  const obstructions = isControlled
    ? controlledObstructions
    : internalObstructions

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingKind, setPendingKind] = useState<ObstructionKind>('tree')

  function commitObstructions(next: Obstruction[]) {
    if (!isControlled) setInternalObstructions(next)
    onObstructionsChange?.(next)
  }

  function handlePlace(point: Point2D) {
    const obstruction = createObstruction(pendingKind, point)
    commitObstructions([...obstructions, obstruction])
    setSelectedId(obstruction.id)
  }

  function handleGroundClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()
    // Real R3F events carry `.ray` directly. In tests, the mocked Canvas
    // renders through plain react-dom (see `Scene3DView.test.tsx`'s
    // module doc), so `onClick` receives an ordinary React SyntheticEvent
    // instead — a test-injected `.ray` on the underlying native event
    // (`event.nativeEvent`) is used as a fallback so that path stays
    // testable without changing production behavior (`ThreeEvent` always
    // carries its own `.ray`, so the fallback is inert in production).
    const ray =
      event.ray ??
      (event.nativeEvent as unknown as { ray?: typeof event.ray }).ray
    if (!ray) return
    const point = intersectGroundPlane({
      origin: { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z },
      direction: { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z },
    })
    if (point) handlePlace(point)
  }

  function handleSelect(id: string) {
    setSelectedId(id)
  }

  function handleUpdate(
    id: string,
    patch: Partial<Pick<Obstruction, 'position' | 'heightM' | 'radiusM'>>,
  ) {
    commitObstructions(
      obstructions.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    )
  }

  function handleDelete(id: string) {
    commitObstructions(obstructions.filter((o) => o.id !== id))
    setSelectedId((current) => (current === id ? null : current))
  }

  const selectedObstruction = obstructions.find((o) => o.id === selectedId)

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
      <div className={styles.obstructionToolbar}>
        <span className={styles.obstructionToolbarLabel}>
          Click ground to place:
        </span>
        <button
          type="button"
          className={
            pendingKind === 'tree'
              ? styles.toolbarButtonActive
              : styles.toolbarButton
          }
          onClick={() => setPendingKind('tree')}
        >
          Tree
        </button>
        <button
          type="button"
          className={
            pendingKind === 'building'
              ? styles.toolbarButtonActive
              : styles.toolbarButton
          }
          onClick={() => setPendingKind('building')}
        >
          Building
        </button>
      </div>
      {selectedObstruction && (
        <ObstructionPropertyPanel
          obstruction={selectedObstruction}
          onChange={(patch) => handleUpdate(selectedObstruction.id, patch)}
          onDelete={() => handleDelete(selectedObstruction.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
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
        {/*
          Invisible ground-plane mesh purely to receive click events —
          see `handleGroundClick` and `intersectGroundPlane`'s doc for why
          the actual placement point is computed from the click ray
          rather than this mesh's own raycast hit point. Sized generously
          relative to the shapes/grid so a click just outside the grid
          still resolves.
        */}
        <mesh
          name="ground-plane"
          onClick={handleGroundClick}
          rotation={[0, 0, 0]}
        >
          <planeGeometry args={[gridSize * 2, gridSize * 2]} />
          <meshBasicMaterial visible={false} />
        </mesh>
        {shapes.map((shape) => (
          <ShapeMesh
            key={shape.id}
            shape={shape}
            defaultPanel={defaultPanel}
            sceneOrigin={sceneOrigin}
          />
        ))}
        {obstructions.map((obstruction) => (
          <ObstructionMesh
            key={obstruction.id}
            obstruction={obstruction}
            selected={obstruction.id === selectedId}
            onSelect={handleSelect}
          />
        ))}
      </Canvas>
    </div>
  )
}
