/**
 * Compass label for a given azimuth in degrees, e.g. 180 -> "S", 135 -> "SE".
 * Uses the 8-point compass; out-of-range or non-finite input returns `''`.
 *
 * Lives here (rather than in `src/ui/` or `src/scene/`) because it's a pure,
 * zero-dependency helper consumed by both `src/scene/configure/validation.ts`
 * and `src/ui/SystemConfigForm/validation.ts` — unlike those modules'
 * independently-duplicated `FIELD_RULES` (a deliberate copy, to avoid
 * `scene/configure` taking a real dependency on `src/ui/`), this helper has
 * zero UI coupling, so there's no boundary reason to keep it duplicated
 * (see issue #91).
 */
export function azimuthCompassLabel(azimuthDeg: number): string {
  if (!Number.isFinite(azimuthDeg)) {
    return ''
  }
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const normalized = ((azimuthDeg % 360) + 360) % 360
  const index = Math.round(normalized / 45) % 8
  return points[index]
}
