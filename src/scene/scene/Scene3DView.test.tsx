import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

// R3F/WebGL needs a real GPU canvas, which jsdom doesn't provide — mirroring
// this project's existing MapLibre-in-tests pattern
// (`src/ui/LocationPicker.test.tsx`), `@react-three/fiber`'s `Canvas` and
// `@react-three/drei`'s `OrbitControls`/`Text` are mocked out entirely
// here. `Canvas` is stubbed to render its children through plain
// react-dom (bypassing R3F's own WebGL-backed reconciler) so the element
// *tree* (shape/panel mesh counts, gizmo presence) can still be asserted
// on — the actual WebGL rendering, camera controls, and lighting are NOT
// covered by these tests and need manual/browser verification (see the PR
// description).
// Captures every prop `<Canvas>` is rendered with, so the `frameloop`
// prop specifically (PR #70 review finding 1) can be asserted on without
// a real WebGL canvas — declared via `vi.hoisted` since `vi.mock`
// factories run before other module-scope code and can't close over an
// ordinary `const`.
const { canvasPropsLog } = vi.hoisted(() => ({
  canvasPropsLog: [] as Record<string, unknown>[],
}))

// Captures the *actual* props object passed to every `<primitive>` and
// `<directionalLight>` element as they're created, keyed by tag name — used
// by the PR #81 review finding 1 regression test below to compare object
// *identity* (not a stringified/serialized value) between the light's
// `target` prop and the primitive's `object` prop. This is necessary
// because the mocked `Canvas` above renders R3F's intrinsic elements
// (`directionallight`, `primitive`, etc.) through plain react-dom: a
// non-primitive prop value like `target={someObject}` gets serialized to
// the DOM as the attribute string `"[object Object]"` (via
// `node.setAttribute`), which is indistinguishable between two genuinely
// different objects — reading it back via `getAttribute`/DOM properties
// loses the very distinction (same object vs. two different objects with
// the same shape) this regression test needs to make. Intercepting at the
// `jsx`/`jsxs`/`jsxDEV` factory level (this project's `tsconfig.app.json`
// uses the automatic JSX runtime) captures the real, un-serialized prop
// values before react-dom ever touches them.
const { elementPropsLog } = vi.hoisted(() => ({
  elementPropsLog: { primitive: [], directionalLight: [] } as Record<
    'primitive' | 'directionalLight',
    Record<string, unknown>[]
  >,
}))

function recordElementProps(type: unknown, props: unknown) {
  if (type === 'primitive' || type === 'directionalLight') {
    elementPropsLog[type].push(props as Record<string, unknown>)
  }
}

vi.mock('react/jsx-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react/jsx-runtime')>()
  return {
    ...actual,
    jsx: (type: unknown, props: unknown, ...rest: unknown[]) => {
      recordElementProps(type, props)
      return (
        actual.jsx as (...args: unknown[]) => ReturnType<typeof actual.jsx>
      )(type, props, ...rest)
    },
    jsxs: (type: unknown, props: unknown, ...rest: unknown[]) => {
      recordElementProps(type, props)
      return (
        actual.jsxs as (...args: unknown[]) => ReturnType<typeof actual.jsxs>
      )(type, props, ...rest)
    },
  }
})

vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react/jsx-dev-runtime')>()
  return {
    ...actual,
    jsxDEV: (type: unknown, props: unknown, ...rest: unknown[]) => {
      recordElementProps(type, props)
      return (
        actual.jsxDEV as (
          ...args: unknown[]
        ) => ReturnType<typeof actual.jsxDEV>
      )(type, props, ...rest)
    },
  }
})

vi.mock('@react-three/fiber', () => ({
  Canvas: ({
    children,
    ...rest
  }: {
    children?: React.ReactNode
  } & Record<string, unknown>) => {
    canvasPropsLog.push(rest)
    return <div data-testid="r3f-canvas">{children}</div>
  },
}))

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => <div data-testid="orbit-controls" />,
  Text: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Billboard: ({
    children,
    ...rest
  }: {
    children?: React.ReactNode
  } & Record<string, unknown>) => <group {...rest}>{children}</group>,
}))

// Imported after the mocks above so the mocked modules are in place.
import { Scene3DView } from './Scene3DView'
import { panelAutoFillGrid, polygonToExtrusionGeometry } from '../derive'

const flatSquare = (latOffset: number, lonOffset: number, sizeDeg = 0.0005) => [
  { lat: 52.5 + latOffset, lon: 13.4 + lonOffset },
  { lat: 52.5 + latOffset + sizeDeg, lon: 13.4 + lonOffset },
  { lat: 52.5 + latOffset + sizeDeg, lon: 13.4 + lonOffset + sizeDeg },
  { lat: 52.5 + latOffset, lon: 13.4 + lonOffset + sizeDeg },
]

const genericResidentialPanel = { widthMm: 1134, heightMm: 1722 }

// NorthArrowGizmo always renders 2 <mesh> elements (shaft + head cone),
// present regardless of how many shapes are given.
const GIZMO_MESH_COUNT = 2
// Scene3DView always renders one invisible ground-plane <mesh> for
// click-to-place obstructions (issue #58), regardless of shape/obstruction
// count.
const GROUND_PLANE_MESH_COUNT = 1
// Plus one separate visible shadow-receiving ground <mesh> (issue #76) —
// see Scene3DView.tsx's "ground-shadow" doc comment for why this can't be
// merged into the (invisible) ground-plane mesh above.
const GROUND_SHADOW_MESH_COUNT = 1

describe('Scene3DView', () => {
  it('renders the mocked canvas and orbit controls with no shapes', () => {
    const { getByTestId } = render(<Scene3DView shapes={[]} />)
    expect(getByTestId('r3f-canvas')).toBeInTheDocument()
    expect(getByTestId('orbit-controls')).toBeInTheDocument()
  })

  it('sets frameloop="demand" on the Canvas, not the default continuous "always" loop (PR #70 review finding 1)', () => {
    canvasPropsLog.length = 0
    render(<Scene3DView shapes={[]} />)
    expect(canvasPropsLog).toHaveLength(1)
    expect(canvasPropsLog[0].frameloop).toBe('demand')
  })

  it('reports each shape’s auto-filled panel count/placements via onPanelLayoutChange (PR #70 review finding 2)', () => {
    const shapes = [
      {
        id: 'a',
        geometry: polygonToExtrusionGeometry(flatSquare(0, 0, 0.001), 20, 180),
      },
      {
        id: 'b',
        geometry: polygonToExtrusionGeometry(flatSquare(0.01, 0), 20, 180),
      },
    ]
    const onPanelLayoutChange = vi.fn()
    render(
      <Scene3DView
        shapes={shapes}
        defaultPanel={genericResidentialPanel}
        onPanelLayoutChange={onPanelLayoutChange}
      />,
    )
    expect(onPanelLayoutChange).toHaveBeenCalled()
    const layouts = onPanelLayoutChange.mock.calls.at(-1)?.[0]
    expect(layouts).toHaveLength(2)
    expect(layouts[0].shapeId).toBe('a')
    // The small shape (0.001deg) fits exactly one panel; the count here
    // must match the number of panel meshes actually rendered for it, not
    // an independently-recomputed value — see the doc comment on
    // `Scene3DView`'s `shapePanelLayouts` memo.
    expect(layouts[0].panelCount).toBe(layouts[0].panels.length)
    expect(layouts[0].panelCount).toBeGreaterThan(0)
  })

  it('reports zero panels for a shape with no resolvable panel dimensions', () => {
    const shapes = [
      {
        id: 'a',
        geometry: polygonToExtrusionGeometry(flatSquare(0, 0), 20, 180),
      },
    ]
    const onPanelLayoutChange = vi.fn()
    render(
      <Scene3DView shapes={shapes} onPanelLayoutChange={onPanelLayoutChange} />,
    )
    const layouts = onPanelLayoutChange.mock.calls.at(-1)?.[0]
    expect(layouts).toEqual([{ shapeId: 'a', panelCount: 0, panels: [] }])
  })

  it('renders one plane mesh per shape, with no panel mesh when no panel dims are given', () => {
    const shapes = [
      {
        id: 'a',
        geometry: polygonToExtrusionGeometry(flatSquare(0, 0), 20, 180),
      },
      {
        id: 'b',
        geometry: polygonToExtrusionGeometry(flatSquare(0.01, 0), 30, 90),
      },
    ]
    const { container } = render(<Scene3DView shapes={shapes} />)
    // One <mesh> (the plane) per shape, no panel mesh since no panel
    // dimensions were supplied at either the shape or component level,
    // plus the gizmo's fixed 2 meshes.
    expect(container.querySelectorAll('mesh')).toHaveLength(
      shapes.length +
        GIZMO_MESH_COUNT +
        GROUND_PLANE_MESH_COUNT +
        GROUND_SHADOW_MESH_COUNT,
    )
  })

  it('renders a panel mesh alongside the plane mesh when a defaultPanel is supplied', () => {
    const shapes = [
      {
        id: 'a',
        geometry: polygonToExtrusionGeometry(flatSquare(0, 0, 0.001), 20, 180),
      },
    ]
    const { container } = render(
      <Scene3DView shapes={shapes} defaultPanel={genericResidentialPanel} />,
    )
    // Plane mesh + panel mesh, plus the gizmo's fixed 2 meshes.
    expect(container.querySelectorAll('mesh')).toHaveLength(
      2 + GIZMO_MESH_COUNT + GROUND_PLANE_MESH_COUNT + GROUND_SHADOW_MESH_COUNT,
    )
  })

  it('lets a shape override the panel preset used for its own auto-fill', () => {
    // A weak `toBeGreaterThanOrEqual(1)` assertion here would still pass
    // even if the override were silently ignored (issue #85 item 6) — the
    // shape's own oversized `panel` (2m x 1m, versus the 1.134m x 1.722m
    // default) fits a different, exactly-computable panel count on this
    // footprint, so asserting the *layout actually used* is what proves
    // the override took effect.
    const shapeGeometry = polygonToExtrusionGeometry(
      flatSquare(0, 0, 0.001),
      20,
      180,
    )
    const overridePanel = { widthMm: 2000, heightMm: 1000 }
    const shapes = [
      {
        id: 'a',
        geometry: shapeGeometry,
        panel: overridePanel,
      },
    ]
    const onPanelLayoutChange = vi.fn()
    const { container } = render(
      <Scene3DView
        shapes={shapes}
        defaultPanel={genericResidentialPanel}
        onPanelLayoutChange={onPanelLayoutChange}
      />,
    )

    const footprint = shapeGeometry.vertices.map((v) => ({ x: v.x, y: v.y }))
    const expectedOverrideCount = panelAutoFillGrid(footprint, overridePanel)
      .panels.length
    const expectedDefaultCount = panelAutoFillGrid(
      footprint,
      genericResidentialPanel,
    ).panels.length

    // Sanity check that these two panel sizes actually produce a
    // different count on this footprint — otherwise the assertion below
    // wouldn't distinguish "override applied" from "override ignored".
    expect(expectedOverrideCount).not.toBe(expectedDefaultCount)

    const layouts = onPanelLayoutChange.mock.calls.at(-1)?.[0]
    expect(layouts[0].panelCount).toBe(expectedOverrideCount)
    // Plane mesh + panel mesh, plus the gizmo's fixed 2 meshes.
    expect(container.querySelectorAll('mesh')).toHaveLength(
      2 + GIZMO_MESH_COUNT + GROUND_PLANE_MESH_COUNT + GROUND_SHADOW_MESH_COUNT,
    )
  })
})

// Simulates a click ray straight down from (x, y, 10) toward the ground
// plane (z = 0), matching `intersectGroundPlane`'s expectations — see its
// own unit tests in `obstructionPlacement.test.ts` for the underlying math.
//
// Real R3F pointer events (`ThreeEvent<MouseEvent>`) carry a `.ray`
// property directly on the event object, entirely outside React's own
// SyntheticEvent system. The mocked Canvas here renders through plain
// react-dom instead, so `onClick` receives an ordinary React
// SyntheticEvent wrapping a real browser `MouseEvent` — and neither
// `fireEvent.click`'s `eventInit` dict nor the `MouseEvent` constructor
// itself will carry an arbitrary extra property like `ray` (unknown init
// keys are silently dropped). So the event is built by hand here and the
// custom `ray` property is defined on it directly before dispatch, via
// the lower-level `fireEvent(element, event)` overload.
function clickGround(element: Element, x: number, y: number) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'ray', {
    value: { origin: { x, y, z: 10 }, direction: { x: 0, y: 0, z: -1 } },
  })
  fireEvent(element, event)
}

describe('Scene3DView sun-position scrubber (issue #76)', () => {
  const shapes = [
    {
      id: 'a',
      geometry: polygonToExtrusionGeometry(flatSquare(0, 0), 20, 180),
    },
  ]

  it('renders the day-of-year and time-of-day scrubber controls', () => {
    render(<Scene3DView shapes={shapes} />)
    expect(screen.getByLabelText(/day of year/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/time of day/i)).toBeInTheDocument()
  })

  it('renders a shadow-casting directionalLight positioned along the sun direction at the default (summer midday) setting', () => {
    const { container } = render(<Scene3DView shapes={shapes} />)
    const light = container.querySelector('directionallight')
    expect(light).not.toBeNull()
    // A real value is present (not e.g. "0,0,0") — the exact number is
    // covered precisely by sunScrubber.test.ts (and, for the underlying
    // altitude/azimuth -> ENU conversion, solar-physics/sunDirection.test.ts);
    // this just confirms the rendered light is actually wired to a computed
    // position.
    expect(light?.getAttribute('position')).toMatch(
      /-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?/,
    )
    expect(screen.getByText(/sun altitude/i)).toBeInTheDocument()
  })

  // Regression coverage for PR #81 review finding 1 (see sunLightTarget.test.ts
  // for the underlying Three.js world-matrix analysis): `DirectionalLight`'s
  // `target` must be a genuine scene-graph node (rendered here via a
  // `<primitive>` sibling), not the `target-position` JSX shorthand, which
  // only ever sets an orphaned `Object3D`'s *local* position and never
  // attaches it to the scene graph. `sunLightTarget.test.ts` verifies the
  // real-`three` consequence of that distinction (a detached target's
  // `matrixWorld` never updates); this test instead exercises the actual
  // mounted `Scene3DView` component (mocking only `Canvas`/`OrbitControls`/
  // `Text`, per this file's module doc) so a revert of the real fix in
  // `Scene3DView.tsx` — reintroducing `target-position` — fails *this*
  // suite too, not just the standalone `three`-object test.
  it('wires the directionalLight to a real scene-graph target object, not a target-position prop (PR #81 review finding 1)', () => {
    elementPropsLog.primitive.length = 0
    elementPropsLog.directionalLight.length = 0

    const { container } = render(<Scene3DView shapes={shapes} />)
    const light = container.querySelector('directionallight')
    expect(light).not.toBeNull()

    // The buggy pattern used a `target-position` JSX prop shorthand, which
    // React Three Fiber renders as a `target-position` DOM attribute in
    // this mocked (plain react-dom) tree. Its absence confirms the fix's
    // `<primitive object={sunTarget} .../>` + `target={sunTarget}` pattern
    // is in place instead.
    expect(light?.getAttribute('target-position')).toBeNull()

    // The fix renders the light's target as its own `<primitive>` node — a
    // real sibling in the R3F tree, not just a prop value on the light.
    // Confirm it's the *same* target object the light's `target` prop was
    // given, by comparing the real (un-serialized) prop values captured at
    // the `jsx`/`jsxs`/`jsxDEV` factory level — see `elementPropsLog`'s doc
    // comment above for why DOM attributes/properties can't distinguish
    // this (a non-primitive prop collapses to `"[object Object]"` either
    // way, so a bug that swapped in some *other* object as the target would
    // be invisible to a plain DOM-attribute check).
    expect(elementPropsLog.primitive).toHaveLength(1)
    expect(elementPropsLog.directionalLight).toHaveLength(1)
    const primitiveObject = elementPropsLog.primitive[0].object
    const lightTarget = elementPropsLog.directionalLight[0].target
    expect(primitiveObject).toBeDefined()
    expect(lightTarget).toBe(primitiveObject)
  })

  it('moving the time-of-day slider changes the rendered light position (shadows move)', () => {
    const { container } = render(<Scene3DView shapes={shapes} />)
    const before = container
      .querySelector('directionallight')
      ?.getAttribute('position')

    fireEvent.change(screen.getByLabelText(/time of day/i), {
      target: { value: '9' },
    })

    const after = container
      .querySelector('directionallight')
      ?.getAttribute('position')
    expect(after).not.toBe(before)
  })

  it('moving the day-of-year slider also changes the rendered light position', () => {
    const { container } = render(<Scene3DView shapes={shapes} />)
    const before = container
      .querySelector('directionallight')
      ?.getAttribute('position')

    fireEvent.change(screen.getByLabelText(/day of year/i), {
      target: { value: '355' },
    })

    const after = container
      .querySelector('directionallight')
      ?.getAttribute('position')
    expect(after).not.toBe(before)
  })

  it('omits the shadow-casting light and shows a status message when the scrubbed time puts the sun below the horizon', () => {
    const { container } = render(<Scene3DView shapes={shapes} />)
    // Berlin (this suite's default shape origin), day 172 (summer), 01:00
    // UTC (~03:00 local) is well before sunrise.
    fireEvent.change(screen.getByLabelText(/time of day/i), {
      target: { value: '1' },
    })
    expect(container.querySelector('directionallight')).toBeNull()
    expect(screen.getByText(/sun below horizon/i)).toBeInTheDocument()
  })
})

describe('Scene3DView obstructions', () => {
  const shapes = [
    {
      id: 'a',
      geometry: polygonToExtrusionGeometry(flatSquare(0, 0), 20, 180),
    },
  ]
  // `flatSquare(0, 0)`'s default 0.0005deg size, centered on its own
  // centroid by `polygonToExtrusionGeometry`, resolves to a plan-view
  // footprint of roughly x: [-17, 17], y: [-28, 28] in scene-local
  // meters (see `obstructionPlacement.test.ts`'s footprint-blocking
  // tests for the same shape/tilt). Ground clicks in these tests use
  // points well outside that footprint so they aren't blocked by the
  // #69-review footprint-containment check — clicks *inside* it are
  // covered separately below. Deliberately asymmetric (x !== |y|, and
  // even the signs differ) rather than e.g. `{ x: 60, y: 60 }` — a
  // symmetric point can't catch an accidental x/y swap anywhere along the
  // click -> `intersectGroundPlane` -> `handlePlace` ->
  // `onObstructionsChange` chain, since `{ x: 60, y: 60 }` reads back
  // identically either way.
  const OUTSIDE_FOOTPRINT = { x: 60, y: -40 }

  it('places a tree (the default kind) on a ground click and shows its property panel', () => {
    const { container } = render(<Scene3DView shapes={shapes} />)
    const ground = container.querySelector('mesh[name="ground-plane"]')
    expect(ground).not.toBeNull()

    clickGround(ground as Element, OUTSIDE_FOOTPRINT.x, OUTSIDE_FOOTPRINT.y)

    expect(screen.getByTestId('obstruction-property-panel')).toBeInTheDocument()
    expect(screen.getByText('tree')).toBeInTheDocument()
    // Default tree height, per `createObstruction`.
    expect(screen.getByLabelText(/height/i)).toHaveValue(5)
  })

  it('places a building once the toolbar toggle is switched', () => {
    const { container } = render(<Scene3DView shapes={shapes} />)
    fireEvent.click(screen.getByText('Building'))
    const ground = container.querySelector('mesh[name="ground-plane"]')

    clickGround(ground as Element, OUTSIDE_FOOTPRINT.x, OUTSIDE_FOOTPRINT.y)

    expect(screen.getByText('building')).toBeInTheDocument()
    expect(screen.getByLabelText(/height/i)).toHaveValue(6)
  })

  it('reports the placed obstruction via onObstructionsChange (controlled usage)', () => {
    const onObstructionsChange = vi.fn()
    const { container } = render(
      <Scene3DView
        shapes={shapes}
        obstructions={[]}
        onObstructionsChange={onObstructionsChange}
      />,
    )
    const ground = container.querySelector('mesh[name="ground-plane"]')

    clickGround(ground as Element, OUTSIDE_FOOTPRINT.x, OUTSIDE_FOOTPRINT.y)

    expect(onObstructionsChange).toHaveBeenCalledTimes(1)
    const [next] = onObstructionsChange.mock.calls[0]
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({
      kind: 'tree',
      position: OUTSIDE_FOOTPRINT,
    })
  })

  it('edits height via the property panel and deletes via the Remove button', () => {
    const { container } = render(<Scene3DView shapes={shapes} />)
    const ground = container.querySelector('mesh[name="ground-plane"]')
    clickGround(ground as Element, OUTSIDE_FOOTPRINT.x, OUTSIDE_FOOTPRINT.y)

    const heightInput = screen.getByLabelText(/height/i)
    fireEvent.change(heightInput, { target: { value: '8' } })
    expect(screen.getByLabelText(/height/i)).toHaveValue(8)

    fireEvent.click(screen.getByText('Remove'))
    expect(
      screen.queryByTestId('obstruction-property-panel'),
    ).not.toBeInTheDocument()
  })

  it('does not place an obstruction under a tilted roof (downslope-half regression, #69 review)', () => {
    // Matches the reviewer's repro shape (a tilted roof) and a ground
    // point genuinely inside its plan-view footprint — before the fix,
    // this is exactly the class of click that fell through the roof's
    // `stopPropagation` guard and placed an obstruction underneath it.
    const { container } = render(<Scene3DView shapes={shapes} />)
    const ground = container.querySelector('mesh[name="ground-plane"]')

    clickGround(ground as Element, 3, 4)

    expect(
      screen.queryByTestId('obstruction-property-panel'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/can.t place an obstruction inside a traced shape/i),
    ).toBeInTheDocument()
  })

  it('still places an obstruction on a genuinely empty ground click near (but outside) a shape', () => {
    const { container } = render(<Scene3DView shapes={shapes} />)
    const ground = container.querySelector('mesh[name="ground-plane"]')

    // Just past the shape's y-extent (~28m), still well within the
    // ground-plane mesh.
    clickGround(ground as Element, 0, 35)

    expect(screen.getByTestId('obstruction-property-panel')).toBeInTheDocument()
    expect(
      screen.queryByText(/can.t place an obstruction inside a traced shape/i),
    ).not.toBeInTheDocument()
  })

  it('rejects a property-panel move that would land an obstruction under a shape, mirroring the click-placement guard (issue #86 item 1)', () => {
    const { container } = render(<Scene3DView shapes={shapes} />)
    const ground = container.querySelector('mesh[name="ground-plane"]')
    clickGround(ground as Element, OUTSIDE_FOOTPRINT.x, OUTSIDE_FOOTPRINT.y)

    const xInput = screen.getByLabelText(/position east/i)
    const yInput = screen.getByLabelText(/position north/i)

    // x alone (3, 60) is still outside the shape's footprint, so this
    // move is legitimate and should go through...
    fireEvent.change(xInput, { target: { value: '3' } })
    expect(xInput).toHaveValue(3)

    // ...but (3, 4) — the same point `obstructionPlacement.test.ts` and
    // the earlier "does not place an obstruction under a tilted roof"
    // test use as a click genuinely inside the footprint — must be
    // rejected here too, not just for a fresh click-to-place.
    fireEvent.change(yInput, { target: { value: '4' } })
    expect(yInput).toHaveValue(60)
    expect(
      screen.getByText(/can.t place an obstruction inside a traced shape/i),
    ).toBeInTheDocument()
  })

  it('auto-dismisses the placement-blocked cue after a few seconds instead of persisting indefinitely (issue #94 item 3)', () => {
    vi.useFakeTimers()
    try {
      const { container } = render(<Scene3DView shapes={shapes} />)
      const ground = container.querySelector('mesh[name="ground-plane"]')

      clickGround(ground as Element, 3, 4)
      expect(
        screen.getByText(/can.t place an obstruction inside a traced shape/i),
      ).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(3000)
      })

      expect(
        screen.queryByText(/can.t place an obstruction inside a traced shape/i),
      ).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts with the given controlled obstructions rendered, with no ground click needed', () => {
    const initial = [
      {
        id: 'fixed-1',
        kind: 'tree' as const,
        position: { x: 2, y: 2 },
        heightM: 5,
        radiusM: 1.5,
      },
    ]
    const { container } = render(
      <Scene3DView shapes={shapes} obstructions={initial} />,
    )
    expect(
      container.querySelector('[name="obstruction-tree-fixed-1"]'),
    ).not.toBeNull()
  })
})

describe('Scene3DView gridHelper centering (issue #85 item 3)', () => {
  it('centers the gridHelper on the scene bounds, not on the first shape’s own centroid', () => {
    // Two shapes offset from each other: the first shape's own centroid
    // (`sceneOrigin`, the shared frame's arbitrary reference point) sits
    // at local (0, 0), but the scene's actual bounds center — with a
    // second shape offset roughly 0.01deg (~1.1km) north — is nowhere
    // near (0, 0). Before the fix, `gridHelper` rendered with no explicit
    // `position` at all (i.e. pinned to (0, 0, 0), `sceneOrigin`).
    const shapes = [
      {
        id: 'a',
        geometry: polygonToExtrusionGeometry(flatSquare(0, 0), 20, 180),
      },
      {
        id: 'b',
        geometry: polygonToExtrusionGeometry(flatSquare(0.01, 0), 20, 180),
      },
    ]
    const { container } = render(<Scene3DView shapes={shapes} />)
    const grid = container.querySelector('gridhelper')
    expect(grid).not.toBeNull()
    const [x, y] = (grid?.getAttribute('position') ?? '').split(',').map(Number)
    // Not pinned at the origin (that would be the pre-fix, first-shape-
    // centroid behavior)...
    expect(x !== 0 || y !== 0).toBe(true)
    // ...and specifically offset toward the second, northward shape (a
    // positive y — north — shift), not some unrelated value.
    expect(y).toBeGreaterThan(0)
  })
})

describe('Scene3DView BufferGeometry disposal (issue #85 item 2)', () => {
  it('disposes a shape’s plane/panel geometry when its inputs change and on unmount', () => {
    const disposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    disposeSpy.mockClear()

    const shapes = [
      {
        id: 'a',
        geometry: polygonToExtrusionGeometry(flatSquare(0, 0, 0.001), 20, 180),
      },
    ]
    const { rerender, unmount } = render(
      <Scene3DView shapes={shapes} defaultPanel={genericResidentialPanel} />,
    )
    expect(disposeSpy).not.toHaveBeenCalled()

    // Re-deriving geometry for a changed tilt must dispose the geometry
    // it's replacing, not just drop the JS reference and leak the GPU
    // buffers.
    const retiltedShapes = [
      {
        id: 'a',
        geometry: polygonToExtrusionGeometry(flatSquare(0, 0, 0.001), 35, 180),
      },
    ]
    rerender(
      <Scene3DView
        shapes={retiltedShapes}
        defaultPanel={genericResidentialPanel}
      />,
    )
    expect(disposeSpy).toHaveBeenCalled()
    const callsAfterRetilt = disposeSpy.mock.calls.length

    unmount()
    expect(disposeSpy.mock.calls.length).toBeGreaterThan(callsAfterRetilt)

    disposeSpy.mockRestore()
  })
})
