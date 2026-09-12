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
