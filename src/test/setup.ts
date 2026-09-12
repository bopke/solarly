import '@testing-library/jest-dom/vitest'

// jsdom does not implement `window.matchMedia` at all. Components that use
// it (e.g. `Sidebar`'s narrow/desktop breakpoint check) need at least a
// no-op stub to render without throwing; individual tests that care about
// a specific breakpoint state (see `Sidebar.test.tsx`) override this with
// their own mock. Defaults to "no query matches" (i.e. desktop width).
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

// jsdom does not implement `ResizeObserver` either. Recharts' `ResponsiveContainer`
// (used by the Forecast chart, see `ForecastChart.tsx`) checks for it and simply
// skips responsive sizing when absent rather than throwing, but that leaves the
// container at 0×0 in tests, so charts render with no series. This stub reports a
// fixed, comfortably non-zero size once synchronously on observe — enough for
// Recharts to lay out real `<svg>` content that component tests can assert on.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class StubResizeObserver implements ResizeObserver {
    private readonly callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }
    observe(target: Element) {
      const rect = { width: 800, height: 400 }
      Object.defineProperty(target, 'clientWidth', {
        configurable: true,
        value: rect.width,
      })
      Object.defineProperty(target, 'clientHeight', {
        configurable: true,
        value: rect.height,
      })
      this.callback(
        [{ target, contentRect: rect } as unknown as ResizeObserverEntry],
        this,
      )
    }
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = StubResizeObserver
}
