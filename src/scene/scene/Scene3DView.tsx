import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type {
  ExtrusionGeometry,
  PanelAutoFillOptions,
  PanelDimensions,
  PanelPlacement,
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
import {
  intersectGroundPlane,
  isInsideAnyFootprint,
} from './obstructionPlacement'
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

/**
 * One shape's computed panel auto-fill result, as reported by
 * `onPanelLayoutChange` (PR #70 review finding 2). `panelCount` is just
 * `panels.length`, included directly so a consumer (issue #61's "Apply")
 * doesn't need to re-derive it; `panels` is included too in case a future
 * consumer needs per-panel placement rather than just the count. Keyed by
 * `shapeId` (== `Scene3DShape.id` == the traced shape's own id), matching
 * `SceneDesignState.shapeConfigs`'s `shapeId` keying so a consumer can
 * join this with the rest of the scene state the same way.
 */
export interface ShapePanelLayout {
  shapeId: string
  panelCount: number
  panels: PanelPlacement[]
}

export interface Scene3DViewProps {
  /** One or more configured shapes to render. */
  shapes: Scene3DShape[]
  /** Panel dimensions used for any shape that doesn't specify its own `panel`. */
  defaultPanel?: PanelDimensions
  /**
   * Called with the auto-filled panel layout for every shape whenever it's
   * (re)computed — i.e. whenever `shapes`, `defaultPanel`, or a shape's own
   * `panel`/`panelFillOptions` changes. This is the *same* computation
   * (`panelAutoFillGrid`) that drives the rendered panel meshes, so a
   * caller reading this gets exactly the panel count the user saw
   * rendered, rather than having to independently re-run
   * `panelAutoFillGrid` and risk it diverging (PR #70 review finding 2).
   * A shape with no resolved panel dimensions (no `shape.panel` and no
   * `defaultPanel`) reports an empty `panels`/zero `panelCount`, matching
   * its unrendered panel mesh.
   */
  onPanelLayoutChange?: (layouts: ShapePanelLayout[]) => void
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
  panels,
  sceneOrigin,
}: {
  shape: Scene3DShape
  /**
   * This shape's auto-filled panel placements, computed once by the
   * parent `Scene3DView` (per-shape, in its `shapePanelLayouts` memo) so
   * the same computation backs both the rendered mesh here and the
   * `onPanelLayoutChange` report — see `ShapePanelLayout`'s doc.
   */
  panels: PanelPlacement[]
  sceneOrigin: { lat: number; lon: number }
}) {
  const { geometry } = shape

  const offset = useMemo(
    () => offsetToSceneOrigin(geometry.origin, sceneOrigin),
    [geometry.origin, sceneOrigin],
  )

  const planeGeometry = useMemo(
    () => buildPlaneGeometry(geometry.vertices),
    [geometry.vertices],
  )

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
 * A shape's plan-view footprint (its `ExtrusionGeometry.vertices`
 * projected to `(x, y)`, i.e. ignoring tilt/z entirely) in the shared
 * scene-local frame — the same frame `ShapeMesh` renders in, obtained the
 * same way (`offsetToSceneOrigin`). Used by `isInsideAnyFootprint` to
 * reject obstruction placement under a shape; see that function's doc for
 * why this has to be a plan-view check rather than relying on 3D raycast
 * ordering.
 */
function shapeFootprint(
  shape: Scene3DShape,
  sceneOrigin: { lat: number; lon: number },
): Point2D[] {
  const offset = offsetToSceneOrigin(shape.geometry.origin, sceneOrigin)
  return shape.geometry.vertices.map((v) => ({
    x: v.x + offset.x,
    y: v.y + offset.y,
  }))
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
  onPanelLayoutChange,
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
  // Brief inline cue shown when a ground click resolves to a point inside
  // a shape's own footprint (issue #58 PR #69 review) — placement is
  // silently rejected in that case, but the cue tells the user why
  // nothing happened rather than leaving the click feeling ignored.
  const [placementBlocked, setPlacementBlocked] = useState(false)

  function commitObstructions(next: Obstruction[]) {
    if (!isControlled) setInternalObstructions(next)
    onObstructionsChange?.(next)
  }

  function handlePlace(point: Point2D) {
    if (isInsideAnyFootprint(point, shapeFootprints)) {
      // Ground-plane point is really underneath a traced shape's
      // footprint (e.g. the downslope half of a tilted roof, which
      // straddles z = 0 — see `isInsideAnyFootprint`'s doc). Reject the
      // placement rather than dropping an obstruction inside the shape.
      setPlacementBlocked(true)
      return
    }
    setPlacementBlocked(false)
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

  // Plan-view footprint of every shape, in the same scene-local frame a
  // ground click resolves to — used by `handleGroundClick` to reject
  // placement under a shape regardless of its tilt or the current camera
  // angle. See `isInsideAnyFootprint`'s doc for why this can't rely on
  // 3D raycast ordering / `stopPropagation` alone.
  const shapeFootprints = useMemo(
    () => shapes.map((shape) => shapeFootprint(shape, sceneOrigin)),
    [shapes, sceneOrigin],
  )

  // Panel auto-fill, computed once per shape here (rather than inside
  // `ShapeMesh`) so the exact same result backs both the rendered panel
  // mesh and the `onPanelLayoutChange` report to the caller — see
  // `ShapePanelLayout`'s doc comment (PR #70 review finding 2).
  const shapePanelLayouts = useMemo<ShapePanelLayout[]>(
    () =>
      shapes.map((shape) => {
        const panelDims = shape.panel ?? defaultPanel
        if (!panelDims) {
          return { shapeId: shape.id, panelCount: 0, panels: [] }
        }
        const footprint = shape.geometry.vertices.map((v) => ({
          x: v.x,
          y: v.y,
        }))
        const panels = panelAutoFillGrid(
          footprint,
          panelDims,
          shape.panelFillOptions,
        ).panels
        return { shapeId: shape.id, panelCount: panels.length, panels }
      }),
    [shapes, defaultPanel],
  )

  const onPanelLayoutChangeRef = useRef(onPanelLayoutChange)
  onPanelLayoutChangeRef.current = onPanelLayoutChange
  useEffect(() => {
    onPanelLayoutChangeRef.current?.(shapePanelLayouts)
    // `onPanelLayoutChangeRef` is a ref precisely so a caller passing an
    // inline arrow function (the expected common case, mirroring
    // `onStateChange` in `SceneEditorFlow`) doesn't re-fire this effect on
    // every parent render when `shapePanelLayouts` itself hasn't changed.
  }, [shapePanelLayouts])

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
        {placementBlocked && (
          <span role="status" className={styles.obstructionToolbarWarning}>
            Can&rsquo;t place an obstruction inside a traced shape.
          </span>
        )}
      </div>
      {selectedObstruction && (
        <ObstructionPropertyPanel
          obstruction={selectedObstruction}
          onChange={(patch) => handleUpdate(selectedObstruction.id, patch)}
          onDelete={() => handleDelete(selectedObstruction.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
      {/*
        `frameloop="demand"` (PR #70 review finding 1): without this,
        `@react-three/fiber` defaults to `frameloop="always"` — a
        continuous ~60fps `requestAnimationFrame` loop for as long as this
        `<Canvas>` stays mounted. Combined with `SceneEditorFlow`'s
        deliberate never-unmount design (each step's component, including
        this one, is mounted at most once and then only CSS
        visibility-toggled — see that component's doc comment), that meant
        once a user reached step 3 even once, the WebGL scene kept
        rendering at full framerate for the rest of the page session, even
        with the overlay fully closed. `"demand"` only re-renders when
        something actually changes: R3F's own reconciler calls
        `invalidate()` automatically after every commit to this scene's
        React tree (so obstruction add/edit/delete and shape/panel prop
        changes all still repaint), and drei's `OrbitControls` calls
        `invalidate()` on its own `change` events (so orbiting/panning/
        zooming still repaints). Nothing in this component mutates a
        Three.js object imperatively outside of React state/props (no
        `useFrame`, no direct ref mutation), so there's no path that would
        need an explicit `invalidate()` call of its own.
      */}
      <Canvas
        frameloop="demand"
        camera={{ position: cameraPosition, fov: 45, up: [0, 0, 1] }}
      >
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
        {shapes.map((shape, index) => (
          <ShapeMesh
            key={shape.id}
            shape={shape}
            panels={shapePanelLayouts[index].panels}
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
