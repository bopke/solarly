/**
 * Approximates a UTC offset from longitude alone (15° of longitude ≈ 1
 * hour of solar time). This is a deliberate M1 simplification — it
 * ignores real timezone boundaries, political offsets (e.g. half-hour or
 * 45-minute zones, or countries that don't follow the "natural" offset
 * for their longitude), and daylight saving time. A full IANA
 * timezone-database lookup (e.g. via a tz-lookup library or an API) is
 * out of scope for M1. See docs/decisions/0012-location-picker.md.
 *
 * Returns a string like "UTC+2" or "UTC-5".
 */
export function approximateTimezone(lon: number): string {
  const rawOffset = Math.round(lon / 15)
  // Clamp to the real range of UTC offsets in use (UTC-12 .. UTC+14) in
  // case of a slightly out-of-range longitude.
  const offset = Math.max(-12, Math.min(14, rawOffset))
  const sign = offset >= 0 ? '+' : '-'
  return `UTC${sign}${Math.abs(offset)}`
}
