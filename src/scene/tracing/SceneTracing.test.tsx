import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature } from 'geojson'

// Neither MapLibre nor mapbox-gl-draw work under jsdom (both need a real
// WebGL canvas) — mocked here, same pattern as `LocationPicker.test.tsx`.
// The mocks are deliberately event-driven: `FakeMap.emit(...)` and the
// `simulateCreate`/`simulateUpdate` helpers on `FakeDraw` stand in for
// what real user interaction with the drawing tool would trigger, so the
// tests below exercise this component's *handling* of those events (tag
// assignment, validation, the output callback) rather than the drawing
// mechanics themselves — those need manual/browser verification (see the
// PR description).
const { FakeMap, FakeDraw, mapInstances, drawInstances } = vi.hoisted(() => {
  const mapInstances: InstanceType<typeof FakeMapClass>[] = []
  const drawInstances: InstanceType<typeof FakeDrawClass>[] = []

  class FakeMapClass {
    style: unknown
    center: [number, number]
    zoom: number
    handlers: Record<string, Array<(event: unknown) => void>> = {}
    constructor(options: {
      style: unknown
      center: [number, number]
      zoom: number
    }) {
      this.style = options.style
      this.center = options.center
      this.zoom = options.zoom
      mapInstances.push(this)
    }
    addControl(control: {
      onAdd?: (map: unknown) => HTMLElement
      onRemove?: (map: unknown) => void
    }) {
      control.onAdd?.(this)
      return this
    }
    on(event: string, handler: (event: unknown) => void) {
      ;(this.handlers[event] ??= []).push(handler)
      return this
    }
    off(event: string, handler: (event: unknown) => void) {
      this.handlers[event] = (this.handlers[event] ?? []).filter(
        (h) => h !== handler,
      )
      return this
    }
    setStyle(style: unknown) {
      this.style = style
    }
    remove() {}
    emit(event: string, payload: unknown) {
      for (const handler of this.handlers[event] ?? []) handler(payload)
    }
  }

  class FakeDrawClass {
    options: { suppressAPIEvents?: boolean } & Record<string, unknown>
    features: Record<string, Feature> = {}
    map: FakeMapClass | null = null
    lastMode: string | null = null
    private nextId = 1
    constructor(options: { suppressAPIEvents?: boolean }) {
      this.options = options
      drawInstances.push(this)
    }
    onAdd(map: FakeMapClass) {
      this.map = map
      return document.createElement('div')
    }
    onRemove() {}
    get(id: string) {
      return this.features[id]
    }
    setFeatureProperty(id: string, key: string, value: unknown) {
      const feature = this.features[id]
      if (feature) {
        feature.properties = { ...feature.properties, [key]: value }
      }
    }
    delete(id: string) {
      // Mirrors real `@mapbox/mapbox-gl-draw`: `suppressAPIEvents`
      // defaults to `true`, meaning a *programmatic* `draw.delete(id)`
      // call like this one stays silent (no `draw.delete` event) unless
      // the caller explicitly passed `suppressAPIEvents: false` — see the
      // doc comment on `drawOptions` in SceneTracing.tsx. Only user
      // mouse/keyboard interaction (not modeled by this test helper)
      // fires the event unconditionally in the real library. Making this
      // conditional (rather than always emitting, as before) is what lets
      // a regression test actually catch a revert of that fix.
      const feature = this.features[id]
      delete this.features[id]
      if (this.options.suppressAPIEvents === false) {
        this.map?.emit('draw.delete', { features: feature ? [feature] : [] })
      }
    }
    changeMode(mode: string) {
      this.lastMode = mode
    }
    /** Test helper: simulate the user completing a new polygon. */
    simulateCreate(ring: [number, number][]) {
      const id = `f${this.nextId++}`
      const closedRing = [...ring, ring[0]]
      const feature: Feature = {
        id,
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [closedRing] },
      }
      this.features[id] = feature
      this.map?.emit('draw.create', { features: [feature] })
      return id
    }
    /** Test helper: simulate the user editing an existing polygon's vertices. */
    simulateUpdate(id: string, ring: [number, number][]) {
      const feature = this.features[id]
      if (!feature || feature.geometry.type !== 'Polygon') return
      feature.geometry.coordinates = [[...ring, ring[0]]]
      this.map?.emit('draw.update', { features: [feature] })
    }
  }

  return {
    FakeMap: FakeMapClass,
    FakeDraw: FakeDrawClass,
    mapInstances,
    drawInstances,
  }
})

vi.mock('maplibre-gl', () => ({
  Map: FakeMap,
  NavigationControl: class {},
}))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))
vi.mock('@mapbox/mapbox-gl-draw', () => ({ default: FakeDraw }))
vi.mock('@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css', () => ({}))

// Imported after the mocks above so the mocked modules are in place.
import { SceneTracing } from './SceneTracing'
import { MAPBOX_SATELLITE_SOURCE_ID } from './mapboxSatellite'

// A roughly 100m x 100m square near the equator — comfortably above the
// near-zero-area validation threshold. [lon, lat] tuples, matching
// mapbox-gl-draw's GeoJSON coordinate order.
const VALID_SQUARE: [number, number][] = [
  [0, 0],
  [0.0009, 0],
  [0.0009, 0.0009],
  [0, 0.0009],
]

// A bowtie — self-intersecting.
const BOWTIE: [number, number][] = [
  [0, 0],
  [0.001, 0.001],
  [0.001, 0],
  [0, 0.001],
]

// Effectively a single point repeated — near-zero area.
const TINY: [number, number][] = [
  [0, 0],
  [0.0000001, 0],
  [0.0000001, 0.0000001],
  [0, 0.0000001],
]

const CENTER = { lat: 52.5, lon: 13.4 }

describe('SceneTracing', () => {
  beforeEach(() => {
    mapInstances.length = 0
    drawInstances.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('satellite tile fallback', () => {
    it('falls back to the plain style with a notice when no API key is configured', () => {
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={vi.fn()}
          mapboxApiKey=""
        />,
      )

      expect(mapInstances[0].style).toBe(
        'https://tiles.openfreemap.org/styles/liberty',
      )
      expect(screen.getByRole('status')).toHaveTextContent(
        /no mapbox api key is configured/i,
      )
    })

    it('uses the Mapbox Satellite raster style when a key is configured, with no notice', () => {
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={vi.fn()}
          mapboxApiKey="test-token-123"
        />,
      )

      const style = mapInstances[0].style as {
        sources: Record<string, { tiles: string[] }>
      }
      expect(style.sources['mapbox-satellite'].tiles[0]).toContain(
        'access_token=test-token-123',
      )
      expect(style.sources['mapbox-satellite'].tiles[0]).toContain(
        'api.mapbox.com/v4/mapbox.satellite/',
      )
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('falls back to the plain style with a notice when a genuine satellite-source error occurs (e.g. auth failure)', () => {
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={vi.fn()}
          mapboxApiKey="invalid-token"
        />,
      )

      act(() => {
        mapInstances[0].emit('error', {
          error: { status: 401, message: 'Unauthorized' },
          sourceId: MAPBOX_SATELLITE_SOURCE_ID,
        })
      })

      expect(mapInstances[0].style).toBe(
        'https://tiles.openfreemap.org/styles/liberty',
      )
      expect(screen.getByRole('status')).toHaveTextContent(
        /satellite imagery failed to load/i,
      )
    })

    it('only falls back once, even if further satellite-source errors occur', () => {
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={vi.fn()}
          mapboxApiKey="invalid-token"
        />,
      )

      act(() => {
        mapInstances[0].emit('error', {
          error: { status: 401 },
          sourceId: MAPBOX_SATELLITE_SOURCE_ID,
        })
        mapInstances[0].emit('error', {
          error: { status: 401 },
          sourceId: MAPBOX_SATELLITE_SOURCE_ID,
        })
      })

      // setStyle called at most once in practice — asserted indirectly:
      // the notice text is still the tile-error one, not duplicated or
      // reverted.
      expect(screen.getAllByRole('status')).toHaveLength(1)
    })

    // Regression coverage for the bug found in code review: mapbox-gl-draw's
    // bundled default layer styles (e.g. gl-draw-lines's line-dasharray)
    // fail MapLibre's stricter style-spec validation and fire `error`
    // severity map `error` events unrelated to satellite tile/auth
    // failures. Those events carry no sourceId (or a sourceId belonging to
    // some other layer/source) and must NOT trigger the satellite ->
    // plain-style fallback, or a valid API key's imagery would be
    // discarded every time draw's own layers are added.
    it('does NOT fall back when the map error is unrelated draw-layer style-validation noise (no matching sourceId)', () => {
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={vi.fn()}
          mapboxApiKey="valid-token"
        />,
      )

      act(() => {
        mapInstances[0].emit('error', {
          error: {
            message:
              'layers.gl-draw-lines.cold.paint.line-dasharray[2][0]: Expression name must be a string, but found number instead.',
          },
          // No sourceId at all — this is exactly how mapbox-gl-draw's
          // style-validation errors surface in real MapLibre (fired
          // directly on the style/map, not bubbled from a source).
        })
      })

      const style = mapInstances[0].style as {
        sources: Record<string, { tiles: string[] }>
      }
      expect(style.sources[MAPBOX_SATELLITE_SOURCE_ID]).toBeDefined()
      expect(mapInstances[0].style).not.toBe(
        'https://tiles.openfreemap.org/styles/liberty',
      )
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('does NOT fall back when the map error names an unrelated sourceId', () => {
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={vi.fn()}
          mapboxApiKey="valid-token"
        />,
      )

      act(() => {
        mapInstances[0].emit('error', {
          error: { message: 'some other source error' },
          sourceId: 'some-other-source',
        })
      })

      expect(mapInstances[0].style).not.toBe(
        'https://tiles.openfreemap.org/styles/liberty',
      )
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  describe('shape tagging', () => {
    it('tags a newly drawn shape as roof-face by default', () => {
      const onShapesChange = vi.fn()
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={onShapesChange}
          mapboxApiKey="token"
        />,
      )

      act(() => {
        drawInstances[0].simulateCreate(VALID_SQUARE)
      })

      expect(onShapesChange).toHaveBeenLastCalledWith(
        [expect.objectContaining({ kind: 'roof-face' })],
        false,
      )
    })

    it('tags a newly drawn shape as ground-array after toggling "Next shape"', () => {
      const onShapesChange = vi.fn()
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={onShapesChange}
          mapboxApiKey="token"
        />,
      )

      fireEvent.click(screen.getByLabelText('Ground array'))

      act(() => {
        drawInstances[0].simulateCreate(VALID_SQUARE)
      })

      expect(onShapesChange).toHaveBeenLastCalledWith(
        [expect.objectContaining({ kind: 'ground-array' })],
        false,
      )
    })

    it('lets an existing shape be re-tagged after the fact', () => {
      const onShapesChange = vi.fn()
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={onShapesChange}
          mapboxApiKey="token"
        />,
      )

      let id = ''
      act(() => {
        id = drawInstances[0].simulateCreate(VALID_SQUARE)
      })

      const item = screen.getByTestId(`shape-${id}`)
      fireEvent.change(within(item).getByRole('combobox'), {
        target: { value: 'ground-array' },
      })

      expect(onShapesChange).toHaveBeenLastCalledWith(
        [expect.objectContaining({ id, kind: 'ground-array' })],
        false,
      )
      expect(drawInstances[0].get(id)?.properties?.kind).toBe('ground-array')
    })

    it('starts drawing via the "Draw polygon" button', () => {
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={vi.fn()}
          mapboxApiKey="token"
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Draw polygon' }))

      expect(drawInstances[0].lastMode).toBe('draw_polygon')
    })
  })

  describe('output shape / callback', () => {
    it('fires onShapesChange with the traced polygon on create', () => {
      const onShapesChange = vi.fn()
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={onShapesChange}
          mapboxApiKey="token"
        />,
      )

      let id = ''
      act(() => {
        id = drawInstances[0].simulateCreate(VALID_SQUARE)
      })

      expect(onShapesChange).toHaveBeenLastCalledWith(
        [
          {
            id,
            kind: 'roof-face',
            polygon: VALID_SQUARE.map(([lon, lat]) => ({ lat, lon })),
          },
        ],
        false,
      )
    })

    it('fires onShapesChange with the updated polygon on edit', () => {
      const onShapesChange = vi.fn()
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={onShapesChange}
          mapboxApiKey="token"
        />,
      )

      let id = ''
      act(() => {
        id = drawInstances[0].simulateCreate(VALID_SQUARE)
      })

      const movedSquare: [number, number][] = [
        [1, 1],
        [1.0009, 1],
        [1.0009, 1.0009],
        [1, 1.0009],
      ]
      act(() => {
        drawInstances[0].simulateUpdate(id, movedSquare)
      })

      expect(onShapesChange).toHaveBeenLastCalledWith(
        [
          {
            id,
            kind: 'roof-face',
            polygon: movedSquare.map(([lon, lat]) => ({ lat, lon })),
          },
        ],
        false,
      )
    })

    it('fires onShapesChange without the shape after delete', () => {
      const onShapesChange = vi.fn()
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={onShapesChange}
          mapboxApiKey="token"
        />,
      )

      let id = ''
      act(() => {
        id = drawInstances[0].simulateCreate(VALID_SQUARE)
      })
      expect(onShapesChange).toHaveBeenLastCalledWith(
        [expect.objectContaining({ id })],
        false,
      )

      const item = screen.getByTestId(`shape-${id}`)
      fireEvent.click(within(item).getByRole('button', { name: /delete/i }))

      expect(onShapesChange).toHaveBeenLastCalledWith([], false)
      expect(screen.queryByTestId(`shape-${id}`)).not.toBeInTheDocument()
    })

    // Regression coverage: `MapboxDraw` must be constructed with
    // `suppressAPIEvents: false` so `handleDeleteShape`'s programmatic
    // `draw.delete(id)` call actually fires `draw.delete` (mapbox-gl-draw
    // defaults `suppressAPIEvents` to `true`, which silences exactly this
    // kind of programmatic call). `FakeDrawClass.delete` above only emits
    // when this option is explicitly `false` — matching the real
    // library's default-suppresses behavior — so this test (and the one
    // above, which depends on the delete event reaching React state) would
    // fail if `suppressAPIEvents: false` were ever reverted, unlike an
    // assertion that only checks `onShapesChange` output.
    it('constructs MapboxDraw with suppressAPIEvents: false so programmatic delete reaches React state', () => {
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={vi.fn()}
          mapboxApiKey="token"
        />,
      )

      expect(drawInstances[0].options).toMatchObject({
        suppressAPIEvents: false,
      })
    })

    it('deleting one shape does not affect other traced shapes', () => {
      const onShapesChange = vi.fn()
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={onShapesChange}
          mapboxApiKey="token"
        />,
      )

      let firstId = ''
      let secondId = ''
      act(() => {
        firstId = drawInstances[0].simulateCreate(VALID_SQUARE)
        secondId = drawInstances[0].simulateCreate(
          VALID_SQUARE.map(([lon, lat]) => [lon + 1, lat + 1]) as [
            number,
            number,
          ][],
        )
      })

      const firstItem = screen.getByTestId(`shape-${firstId}`)
      fireEvent.click(
        within(firstItem).getByRole('button', { name: /delete/i }),
      )

      expect(screen.queryByTestId(`shape-${firstId}`)).not.toBeInTheDocument()
      expect(screen.getByTestId(`shape-${secondId}`)).toBeInTheDocument()
      expect(onShapesChange).toHaveBeenLastCalledWith(
        [expect.objectContaining({ id: secondId })],
        false,
      )
    })
  })

  describe('validation', () => {
    it('flags a self-intersecting polygon inline and excludes it from onShapesChange', () => {
      const onShapesChange = vi.fn()
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={onShapesChange}
          mapboxApiKey="token"
        />,
      )

      let id = ''
      act(() => {
        id = drawInstances[0].simulateCreate(BOWTIE)
      })

      const item = screen.getByTestId(`shape-${id}`)
      expect(within(item).getByRole('alert')).toHaveTextContent(
        /cross themselves/i,
      )
      expect(onShapesChange).toHaveBeenLastCalledWith([], true)
      // The invalid shape stays visible/editable rather than being removed.
      expect(screen.getByTestId(`shape-${id}`)).toBeInTheDocument()
    })

    it('flags a near-zero-area polygon inline and excludes it from onShapesChange', () => {
      const onShapesChange = vi.fn()
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={onShapesChange}
          mapboxApiKey="token"
        />,
      )

      let id = ''
      act(() => {
        id = drawInstances[0].simulateCreate(TINY)
      })

      const item = screen.getByTestId(`shape-${id}`)
      expect(within(item).getByRole('alert')).toHaveTextContent(/too small/i)
      expect(onShapesChange).toHaveBeenLastCalledWith([], true)
    })

    it('an invalid shape does not affect an already-valid shape in the output', () => {
      const onShapesChange = vi.fn()
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={onShapesChange}
          mapboxApiKey="token"
        />,
      )

      let validId = ''
      act(() => {
        validId = drawInstances[0].simulateCreate(VALID_SQUARE)
      })
      act(() => {
        drawInstances[0].simulateCreate(BOWTIE)
      })

      expect(onShapesChange).toHaveBeenLastCalledWith(
        [expect.objectContaining({ id: validId })],
        true,
      )
    })

    it('signals hasInvalidShapes so callers can distinguish "nothing drawn" from "everything invalid"', () => {
      const onShapesChange = vi.fn()
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={onShapesChange}
          mapboxApiKey="token"
        />,
      )

      // Nothing drawn yet: empty shapes, not flagged as invalid.
      expect(onShapesChange).toHaveBeenLastCalledWith([], false)

      let id = ''
      act(() => {
        id = drawInstances[0].simulateCreate(BOWTIE)
      })

      // Drawn, but invalid: still an empty valid-shapes array, but now
      // flagged so a caller can block proceeding.
      expect(onShapesChange).toHaveBeenLastCalledWith([], true)

      act(() => {
        drawInstances[0].simulateUpdate(id, VALID_SQUARE)
      })

      expect(onShapesChange).toHaveBeenLastCalledWith(
        [expect.objectContaining({ id })],
        false,
      )
    })

    it('fixing an invalid polygon by editing it clears the error and includes it in the output', () => {
      const onShapesChange = vi.fn()
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={onShapesChange}
          mapboxApiKey="token"
        />,
      )

      let id = ''
      act(() => {
        id = drawInstances[0].simulateCreate(BOWTIE)
      })
      const item = screen.getByTestId(`shape-${id}`)
      expect(within(item).getByRole('alert')).toBeInTheDocument()

      act(() => {
        drawInstances[0].simulateUpdate(id, VALID_SQUARE)
      })

      expect(
        within(screen.getByTestId(`shape-${id}`)).queryByRole('alert'),
      ).not.toBeInTheDocument()
      expect(onShapesChange).toHaveBeenLastCalledWith(
        [expect.objectContaining({ id })],
        false,
      )
    })
  })

  describe('mapbox-gl-draw in-progress feature quirks', () => {
    // Regression coverage for a real crash found during manual browser
    // verification (not reachable via the FakeDraw helpers above, which
    // always produce complete rings): entering draw_polygon mode makes
    // real mapbox-gl-draw create its own transient "in-progress" feature
    // immediately — with `coordinates: null` right at mode-start, then a
    // ring containing a `null` placeholder entry (for the vertex
    // currently following the mouse) once the user has placed some but
    // not all vertices. Both must be handled without crashing or adding
    // a bogus list entry.
    it('ignores a draw.create for a feature with null coordinates (mode just started)', () => {
      const onShapesChange = vi.fn()
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={onShapesChange}
          mapboxApiKey="token"
        />,
      )

      expect(() => {
        act(() => {
          mapInstances[0].emit('draw.create', {
            features: [
              {
                id: 'in-progress',
                type: 'Feature',
                properties: {},
                geometry: { type: 'Polygon', coordinates: null },
              },
            ],
          })
        })
      }).not.toThrow()

      expect(screen.getByText(/no shapes traced yet/i)).toBeInTheDocument()
      expect(onShapesChange).toHaveBeenLastCalledWith([], false)
    })

    it('ignores a draw.update whose ring contains a null (in-progress) vertex', () => {
      const onShapesChange = vi.fn()
      render(
        <SceneTracing
          center={CENTER}
          onShapesChange={onShapesChange}
          mapboxApiKey="token"
        />,
      )

      let id = ''
      act(() => {
        id = drawInstances[0].simulateCreate(VALID_SQUARE)
      })

      expect(() => {
        act(() => {
          mapInstances[0].emit('draw.update', {
            features: [
              {
                id,
                type: 'Feature',
                properties: { kind: 'roof-face' },
                geometry: {
                  type: 'Polygon',
                  coordinates: [[[13.4, 52.5], null, [13.41, 52.5]]],
                },
              },
            ],
          })
        })
      }).not.toThrow()

      // The null placeholder vertex is filtered out rather than crashing —
      // the two remaining real points read as a (still-incomplete, 2
      // point) polygon, correctly flagged as too few vertices rather than
      // treated as 0 points. It's excluded from onShapesChange (like any
      // invalid shape) but stays visible in the list.
      const item = screen.getByTestId(`shape-${id}`)
      expect(within(item).getByRole('alert')).toHaveTextContent(
        /at least 3 points/i,
      )
      expect(onShapesChange).toHaveBeenLastCalledWith([], true)
    })
  })
})
