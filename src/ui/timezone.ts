/**
 * Approximates a UTC offset from longitude alone (15° of longitude ≈ 1
 * hour of solar time). This is a deliberate M1 simplification — it
 * ignores real timezone boundaries, political offsets (e.g. half-hour or
 * 45-minute zones, or countries that don't follow the "natural" offset
 * for their longitude), and daylight saving time. A full IANA
 * timezone-database lookup (e.g. via a tz-lookup library or an API) is
 * out of scope for M1. See docs/decisions/0012-location-picker.md.
 *
 * Returns a whole-hour offset (e.g. `2` or `-5`), not a display string —
 * callers that need a label should format it with `formatUtcOffset`.
 */
export function approximateTimezone(lon: number): number {
  const rawOffset = Math.round(lon / 15)
  // Clamp to the real range of UTC offsets in use (UTC-12 .. UTC+14) in
  // case of a slightly out-of-range longitude.
  return Math.max(-12, Math.min(14, rawOffset))
}

/**
 * Formats an hour offset (as returned by `approximateTimezone`) as a
 * display string, e.g. `2` -> `"≈ UTC+2"`. The leading "≈" is intentional:
 * this is a longitude-based approximation with no DST awareness, so a
 * bare "UTC+2" would assert a precision the value doesn't have — e.g. for
 * Berlin (lon ≈ 13.39, so `approximateTimezone` returns `1`) the real
 * local offset is UTC+2 for roughly half the year (CEST).
 */
export function formatUtcOffset(offsetHours: number): string {
  const sign = offsetHours >= 0 ? '+' : '-'
  return `≈ UTC${sign}${Math.abs(offsetHours)}`
}
