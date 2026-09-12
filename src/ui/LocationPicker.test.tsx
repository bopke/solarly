import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeocodeResult } from '../data-sources/nominatim'

// MapLibre needs a real WebGL canvas, which jsdom doesn't provide, so it's
// mocked out entirely here. The map/pin interaction logic that *depends*
// on MapLibre callbacks (click-to-place, drag-to-move) is exercised
// through this mock's `on()` handlers; the actual rendering, tiles, and
// WebGL behavior are NOT covered by these tests and need manual/browser
// verification (see the PR description).
//
// `vi.mock` factories are hoisted above the rest of the module, so the
// classes and instance-tracking arrays they reference must be created via
// `vi.hoisted` rather than as ordinary top-level declarations.
const { FakeMap, FakeMarker, mapInstances, markerInstances } = vi.hoisted(
  () => {
    const mapInstances: InstanceType<typeof FakeMapClass>[] = []
    const markerInstances: InstanceType<typeof FakeMarkerClass>[] = []

    class FakeMapClass {
      handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
      center: [number, number]
      zoom: number
      constructor(options: { center: [number, number]; zoom: number }) {
        this.center = options.center
        this.zoom = options.zoom
        mapInstances.push(this)
      }
      addControl() {
        return this
      }
      on(event: string, handler: (...args: unknown[]) => void) {
        ;(this.handlers[event] ??= []).push(handler)
        return this
      }
      flyTo(options: { center: [number, number]; zoom: number }) {
        this.center = options.center
        this.zoom = options.zoom
      }
      remove() {}
    }

    class FakeMarkerClass {
      lngLat: { lng: number; lat: number } = { lng: 0, lat: 0 }
      handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
      constructor() {
        markerInstances.push(this)
      }
      setLngLat(coords: [number, number]) {
        this.lngLat = { lng: coords[0], lat: coords[1] }
        return this
      }
      getLngLat() {
        return this.lngLat
      }
      addTo() {
        return this
      }
      on(event: string, handler: (...args: unknown[]) => void) {
        ;(this.handlers[event] ??= []).push(handler)
        return this
      }
      remove() {}
    }

    return {
      FakeMap: FakeMapClass,
      FakeMarker: FakeMarkerClass,
      mapInstances,
      markerInstances,
    }
  },
)

vi.mock('maplibre-gl', () => ({
  Map: FakeMap,
  Marker: FakeMarker,
  NavigationControl: class {},
}))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

vi.mock('../data-sources/nominatim', () => ({
  geocode: vi.fn(),
}))

// Imported after the mocks above so the mocked modules are in place.
import { LocationPicker } from './LocationPicker'
import { geocode } from '../data-sources/nominatim'

const mockedGeocode = vi.mocked(geocode)

const berlinResult: GeocodeResult = {
  lat: 52.517,
  lon: 13.3889,
  displayName: 'Berlin, Germany',
}

const parisResult: GeocodeResult = {
  lat: 48.8566,
  lon: 2.3522,
  displayName: 'Paris, France',
}

describe('LocationPicker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mapInstances.length = 0
    markerInstances.length = 0
    mockedGeocode.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('debounces search input before calling geocode', async () => {
    mockedGeocode.mockResolvedValue([berlinResult])
    render(<LocationPicker onLocationChange={vi.fn()} />)

    const input = screen.getByLabelText('Search for a location')
    fireEvent.change(input, { target: { value: 'Berl' } })
    fireEvent.change(input, { target: { value: 'Berlin' } })

    // Not yet — debounce hasn't elapsed.
    expect(mockedGeocode).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(349)
    })
    expect(mockedGeocode).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    // Only one call — for the final value — not one per keystroke.
    expect(mockedGeocode).toHaveBeenCalledTimes(1)
    expect(mockedGeocode).toHaveBeenCalledWith(
      'Berlin',
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it('shows an inline "no results" message when geocode resolves empty', async () => {
    mockedGeocode.mockResolvedValue([])
    render(<LocationPicker onLocationChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Search for a location'), {
      target: { value: 'asdkjhqwlekjh' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(screen.getByText(/no results found/i)).toBeInTheDocument()
  })

  it('shows an inline error message when geocode rejects with a real failure', async () => {
    mockedGeocode.mockRejectedValue(
      new Error('Nominatim geocoding request failed'),
    )
    render(<LocationPicker onLocationChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Search for a location'), {
      target: { value: 'Berlin' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Nominatim geocoding request failed')
  })

  it('does not show an error for an AbortError (timeout or cancellation)', async () => {
    // The Nominatim client normalizes both its own request timeout and a
    // caller-provided abort to `err.name === 'AbortError'` — the picker
    // must not surface that as a user-facing error message.
    const abortError = new Error('signal timed out')
    abortError.name = 'AbortError'
    mockedGeocode.mockRejectedValue(abortError)
    render(<LocationPicker onLocationChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Search for a location'), {
      target: { value: 'Berlin' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('calls onLocationChange with the resolved shape when a result is selected', async () => {
    mockedGeocode.mockResolvedValue([berlinResult])
    const onLocationChange = vi.fn()
    render(<LocationPicker onLocationChange={onLocationChange} />)

    fireEvent.change(screen.getByLabelText('Search for a location'), {
      target: { value: 'Berlin' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    const option = screen.getByText('Berlin, Germany')
    fireEvent.mouseDown(option)

    expect(onLocationChange).toHaveBeenCalledTimes(1)
    expect(onLocationChange).toHaveBeenCalledWith({
      lat: berlinResult.lat,
      lon: berlinResult.lon,
      utcOffsetHours: 1,
    })

    // The resolved coordinates are also displayed to the user.
    expect(screen.getByText(/52\.51700/)).toBeInTheDocument()
    expect(screen.getByText(/≈ UTC\+1/)).toBeInTheDocument()
  })

  it('flies the map to the selected result at the resolved zoom', async () => {
    mockedGeocode.mockResolvedValue([berlinResult])
    render(<LocationPicker onLocationChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Search for a location'), {
      target: { value: 'Berlin' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    fireEvent.mouseDown(screen.getByText('Berlin, Germany'))

    const map = mapInstances[0]
    expect(map.center).toEqual([berlinResult.lon, berlinResult.lat])
    expect(map.zoom).toBe(11)
  })

  it('creates a marker when a search result is selected', async () => {
    mockedGeocode.mockResolvedValue([berlinResult])
    render(<LocationPicker onLocationChange={vi.fn()} />)

    expect(markerInstances).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('Search for a location'), {
      target: { value: 'Berlin' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    fireEvent.mouseDown(screen.getByText('Berlin, Germany'))

    expect(markerInstances).toHaveLength(1)
    expect(markerInstances[0].lngLat).toEqual({
      lng: berlinResult.lon,
      lat: berlinResult.lat,
    })
  })

  it('does not re-trigger a search after selecting a result (regression)', async () => {
    mockedGeocode.mockResolvedValue([berlinResult])
    render(<LocationPicker onLocationChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Search for a location'), {
      target: { value: 'Berlin' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    fireEvent.mouseDown(screen.getByText('Berlin, Germany'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // Selecting a result set the query to the displayed name; that alone
    // must not have fired a second search.
    expect(mockedGeocode).toHaveBeenCalledTimes(1)
  })

  it('regression: selecting a result whose display name equals the typed query does not swallow the next search', async () => {
    // This is the exact repro from the review: type text that already
    // equals the result's displayName (so `setQuery` in the selection
    // handler is a no-op and the search effect never re-runs), then type
    // something new — the next genuine search must still fire. A one-shot
    // "skip the next effect run" boolean flag fails this because nothing
    // ever consumes it.
    mockedGeocode
      .mockResolvedValueOnce([berlinResult])
      .mockResolvedValueOnce([parisResult])
    render(<LocationPicker onLocationChange={vi.fn()} />)

    const input = screen.getByLabelText('Search for a location')

    // Type exactly "Berlin, Germany" — the same string the result option
    // will display.
    fireEvent.change(input, { target: { value: 'Berlin, Germany' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(mockedGeocode).toHaveBeenCalledTimes(1)

    // Select it. setQuery('Berlin, Germany') is a no-op since query is
    // already that value.
    fireEvent.mouseDown(screen.getByText('Berlin, Germany'))

    // Now type a genuinely new query.
    fireEvent.change(input, { target: { value: 'Paris' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(mockedGeocode).toHaveBeenCalledTimes(2)
    expect(mockedGeocode).toHaveBeenLastCalledWith(
      'Paris',
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it('places the pin and resolves a location on map click without forcing a camera move (fallback interaction)', async () => {
    const onLocationChange = vi.fn()
    render(<LocationPicker onLocationChange={onLocationChange} />)

    const map = mapInstances[0]
    expect(map).toBeDefined()
    const centerBeforeClick = map.center
    const zoomBeforeClick = map.zoom

    act(() => {
      map.handlers['click']?.forEach((handler) =>
        handler({ lngLat: { lat: 48.8566, lng: 2.3522 } }),
      )
    })

    expect(onLocationChange).toHaveBeenCalledWith({
      lat: 48.8566,
      lon: 2.3522,
      utcOffsetHours: 0,
    })

    // Map click is a coarse-exploration interaction: it must not recenter
    // or force a zoom change (regression for the "every pin placement
    // forces zoom 11" bug).
    expect(map.center).toEqual(centerBeforeClick)
    expect(map.zoom).toBe(zoomBeforeClick)
  })

  it('updates the resolved location when the pin is dragged, without forcing a camera move', async () => {
    const onLocationChange = vi.fn()
    render(
      <LocationPicker
        onLocationChange={onLocationChange}
        initialLocation={{ lat: 40.7128, lon: -74.006 }}
      />,
    )

    const map = mapInstances[0]
    const marker = markerInstances[0]
    expect(marker).toBeDefined()
    marker.setLngLat([-73.9, 40.8])

    const zoomBeforeDrag = map.zoom
    const centerBeforeDrag = map.center

    act(() => {
      marker.handlers['dragend']?.forEach((handler) => handler())
    })

    expect(onLocationChange).toHaveBeenCalledWith({
      lat: 40.8,
      lon: -73.9,
      utcOffsetHours: -5,
    })

    // Dragging the pin must not snap the map back to the resolved zoom —
    // the user is already positioned/zoomed where they want to be.
    expect(map.zoom).toBe(zoomBeforeDrag)
    expect(map.center).toEqual(centerBeforeDrag)
  })
})
