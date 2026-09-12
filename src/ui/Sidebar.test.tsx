import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

/**
 * jsdom's `matchMedia` (when present at all) never reflects a real
 * viewport width, so the narrow/desktop breakpoint used by `Sidebar`'s
 * `useMediaQuery` hook has to be simulated explicitly — this stub lets a
 * test control `matches` and fire `change` events the way a real browser
 * would on resize.
 */
function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const mql = {
    get matches() {
      return matches
    },
    media: '',
    addEventListener: (
      _type: string,
      cb: (event: MediaQueryListEvent) => void,
    ) => listeners.add(cb),
    removeEventListener: (
      _type: string,
      cb: (event: MediaQueryListEvent) => void,
    ) => listeners.delete(cb),
  }
  vi.spyOn(window, 'matchMedia').mockReturnValue(
    mql as unknown as MediaQueryList,
  )
  return {
    setMatches(next: boolean) {
      matches = next
      listeners.forEach((cb) => cb({ matches: next } as MediaQueryListEvent))
    },
  }
}

function renderSidebar({
  defaultExpanded = true,
  narrow = true,
}: { defaultExpanded?: boolean; narrow?: boolean } = {}) {
  const { setMatches } = mockMatchMedia(narrow)
  const utils = render(
    <Sidebar
      mode="tmy"
      onModeChange={vi.fn()}
      onUpdate={vi.fn()}
      defaultExpanded={defaultExpanded}
    />,
  )
  return { ...utils, setMatches }
}

function getSidebarContent() {
  const toggle = screen.getByRole('button', { name: /settings/i })
  const contentId = toggle.getAttribute('aria-controls')
  return document.getElementById(contentId!)
}

describe('Sidebar', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts expanded by default, exposing its sections', () => {
    renderSidebar()
    const toggle = screen.getByRole('button', { name: /settings/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('radiogroup', { name: /mode/i })).toBeVisible()
  })

  it('collapses the content when the accordion toggle is clicked (narrow viewport)', () => {
    renderSidebar({ narrow: true })
    const toggle = screen.getByRole('button', { name: /settings/i })

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(getSidebarContent()).not.toBeVisible()
  })

  it('expands again on a second click', () => {
    renderSidebar({ narrow: true })
    const toggle = screen.getByRole('button', { name: /settings/i })

    fireEvent.click(toggle)
    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(getSidebarContent()).toBeVisible()
  })

  it('honors defaultExpanded=false at a narrow viewport', () => {
    renderSidebar({ defaultExpanded: false, narrow: true })
    expect(screen.getByRole('button', { name: /settings/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(getSidebarContent()).not.toBeVisible()
  })

  it('is never actually collapsed at a desktop viewport, even with defaultExpanded=false', () => {
    // Regression for: collapsing state persisting past the breakpoint left
    // the sidebar's content hidden with no visible control to undo it,
    // since the accordion toggle is display:none at desktop widths.
    renderSidebar({ defaultExpanded: false, narrow: false })
    expect(screen.getByRole('button', { name: /settings/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(getSidebarContent()).toBeVisible()
  })

  it('regains reachable content after collapsing on mobile, then widening past the breakpoint', () => {
    // Regression for the resize bug: collapse at <768px, then resize back
    // to >=768px, and the sidebar must become usable again without a
    // reload — no dead end where the toggle is hidden and the content is
    // permanently `display: none`.
    const { setMatches } = renderSidebar({ narrow: true })
    const toggle = screen.getByRole('button', { name: /settings/i })

    fireEvent.click(toggle) // collapse while narrow
    expect(getSidebarContent()).not.toBeVisible()

    act(() => {
      setMatches(false) // simulate widening past the breakpoint
    })

    expect(getSidebarContent()).toBeVisible()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })
})
