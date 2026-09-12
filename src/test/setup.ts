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

// jsdom implements neither `ResizeObserver` nor real layout — Recharts'
// `ResponsiveContainer` (used by `DailyChart` and future Monthly/Heatmap/
// Forecast chart tabs) needs both to size itself. A no-op observer plus a
// stubbed non-zero element size is enough for it to render its children
// instead of bailing out with a "width(0) and height(0)" warning.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

if (typeof HTMLElement !== 'undefined') {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    value: 800,
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: 400,
  })
}

if (typeof Element !== 'undefined') {
  Element.prototype.getBoundingClientRect = () =>
    ({
      width: 800,
      height: 400,
      top: 0,
      left: 0,
      bottom: 400,
      right: 800,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect
}
