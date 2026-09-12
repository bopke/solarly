/**
 * Shared types for the app shell. Sibling UI issues (location picker,
 * system config form, chart tabs) can import these to type their own
 * props against the shell's expectations.
 */

/** Simulation mode: TMY (climate-normal) vs Live (short-term forecast). */
export type Mode = 'tmy' | 'live'

/** Identifiers for the main-area tabs. */
export type TabId = 'daily' | 'monthly' | 'heatmap' | 'forecast'

/** Which tabs are visible in each mode, in display order. */
export const TABS_BY_MODE: Record<Mode, TabId[]> = {
  tmy: ['daily', 'monthly', 'heatmap'],
  live: ['forecast'],
}

export const TAB_LABELS: Record<TabId, string> = {
  daily: 'Daily',
  monthly: 'Monthly',
  heatmap: 'Heatmap',
  forecast: 'Forecast',
}

/**
 * The project-wide narrow/desktop breakpoint, in px. Below this width the
 * sidebar collapses to a top accordion (see `Sidebar.module.css` and
 * `Sidebar.tsx`'s `useIsNarrowViewport` hook). Recorded here as the single
 * source of truth for JS; the CSS Modules that mirror it in `@media
 * (max-width: 768px)` rules must be kept in sync by hand (CSS Modules
 * don't support importing a JS constant into a media query) — see ADR
 * 0060 for why 768px was picked.
 */
export const SIDEBAR_BREAKPOINT_PX = 768

/** `matchMedia` query string for {@link SIDEBAR_BREAKPOINT_PX}. */
export const SIDEBAR_BREAKPOINT_QUERY = `(max-width: ${SIDEBAR_BREAKPOINT_PX}px)`
