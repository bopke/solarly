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
