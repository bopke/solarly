/**
 * Public types for `scene/configure` — the "configure each traced shape"
 * step (M2 design spec, issue #59). See `ConfigureShapes.tsx` for the
 * component itself.
 */

/**
 * The minimal location shape this module needs — just enough for the
 * ground-array latitude-based defaults (see `defaultsForShape.ts`).
 * Deliberately declared locally rather than importing `simulation`'s
 * `Location` or `LocationPicker`'s `ResolvedLocation`: structural typing
 * makes all three interchangeable, and `scene/configure` — like
 * `scene/derive` and `scene/tracing` before it — stays self-contained
 * rather than reaching into another module just for a two-field type.
 */
export interface ConfigureShapesLocation {
  /** Latitude, positive north (-90 to 90). */
  lat: number
  /** Longitude, positive east (-180 to 180). */
  lon: number
}

/**
 * One traced shape's resolved tilt/azimuth configuration — this module's
 * output shape, consumed downstream by the 3D scene (#57), flow wiring
 * (#60), and the final Apply/derive-`SystemConfig` step (#61).
 */
export interface ShapeConfig {
  /** The `TracedShape.id` this configuration belongs to. */
  shapeId: string
  /** Panel/plane tilt angle from horizontal, in degrees. Valid range: 0-90. */
  tiltDeg: number
  /**
   * Panel/plane azimuth (compass direction it faces), in degrees clockwise
   * from true north (0=N, 90=E, 180=S, 270=W). Valid range: 0-360.
   */
  azimuthDeg: number
}

/** Field-level validation errors for one shape's tilt/azimuth fields. */
export type ShapeConfigFieldErrors = Partial<{
  tiltDeg: string
  azimuthDeg: string
}>

/**
 * Callback invoked whenever any shape's config or overall validity
 * changes.
 *
 * `configs` holds one entry per shape currently in `props.shapes`, in the
 * same order, with best-effort parsed numeric values (an invalid or empty
 * field falls back to `0`, not any previously-valid value) — always check
 * `isValid` before treating `configs` as trustworthy input to a
 * calculation, since invalid values are surfaced inline rather than
 * clamped or rejected outright. `isValid` is `true` only when every
 * shape's fields are valid.
 */
export type ConfigureShapesChangeHandler = (
  configs: ShapeConfig[],
  isValid: boolean,
) => void
