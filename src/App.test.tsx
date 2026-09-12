import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// App mounts LocationPicker (see src/App.tsx), which creates a real
// MapLibre GL map on mount. MapLibre needs WebGL2, which jsdom doesn't
// provide, so it's mocked out here too — this test only needs to verify
// the page shell renders, not map behavior (see src/ui/LocationPicker.test.tsx
// for that).
vi.mock('maplibre-gl', () => ({
  Map: class {
    addControl() {
      return this
    }
    on() {
      return this
    }
    remove() {}
  },
  Marker: class {
    setLngLat() {
      return this
    }
    getLngLat() {
      return { lat: 0, lng: 0 }
    }
    addTo() {
      return this
    }
    on() {
      return this
    }
    remove() {}
  },
  NavigationControl: class {},
}))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

const { default: App } = await import('./App')

describe('App', () => {
  it('renders the Solarly heading', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: /solarly/i }),
    ).toBeInTheDocument()
  })

  it('renders the location picker search input', () => {
    render(<App />)
    expect(screen.getByLabelText('Search for a location')).toBeInTheDocument()
  })
})
