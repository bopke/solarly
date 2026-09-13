/**
 * Panel auto-fill grid.
 *
 * Given a shape's flat footprint (local meters — e.g. the `vertices`
 * from `polygonToExtrusionGeometry`, projected flat, or just
 * `projectPolygonToLocalMeters(polygon).points`), a panel preset's real
 * `widthMm`/`heightMm` (from `panel-presets/`), and adjustable spacing,
 * lays out a grid of panel positions that fit within the shape.
 *
 * ## Simplification: axis-aligned grid + point-in-polygon, not true packing
 *
 * This computes an axis-aligned grid over the footprint's bounding box
 * (aligned to the local x/y axes, not compass directions), and includes a
 * cell only if its center falls inside the traced polygon (via
 * `pointInPolygon`). This is NOT a general polygon-packing algorithm — it
 * won't rotate the grid to better match an angled roof edge, and a cell
 * can be marked "inside" while one of its corners pokes slightly outside
 * an irregular polygon (or vice-versa near a concave edge). That's an
 * accepted simplification for M2: real panel layouts in practice are laid
 * out on an axis-aligned grid anyway (rows/columns), and the per-cell
 * center test is a reasonable, cheap approximation of "does this panel
 * fit" — full corner-containment or true packing can be revisited later
 * if traced shapes turn out to need it.
 *
 * ## Coordinate space: plan-view, not the true tilted surface
 *
 * `footprintM` is expected in the same *plan-view* local-meters x/y as the
 * traced polygon (e.g. `projectPolygonToLocalMeters(polygon).points`) —
 * NOT foreshortened along the slope direction. This lines up with
 * `polygonToExtrusionGeometry`'s tilted `vertices`: per that module's
 * plan-view fix, a tilted vertex's own `(x, y)` is always identical to its
 * plan-view `(x, y)` (only `z` is lifted), so a panel `center: Point2D`
 * from this function maps onto the tilted plane via that same `(x, y) ->
 * z` rule (`z = -(x * slope.x + y * slope.y) * tan(tiltDeg)`, using the
 * slope direction from the shape's chosen azimuth) — a renderer can look
 * up each panel's 3D center this way without this module needing to know
 * about tilt/azimuth at all.
 *
 * What this function does NOT yet do: panel `widthMm`/`heightMm` are laid
 * out at their real, physical (on-slope) size in this plan-view grid, so
 * each panel's *plan-view footprint* is actually smaller than its grid
 * cell along the slope axis (by the same `cos(tiltDeg)` foreshortening
 * that affects the traced polygon itself) — meaning this grid is
 * conservative (fewer panels than would truly fit) rather than
 * over-fitting, but isn't yet computing the tighter, foreshortened
 * plan-view cell size that would fit the true maximum panel count.
 * Tracked as a follow-up for whichever of #57/#59 renders and composes
 * this with `polygonToExtrusionGeometry`; not fixed here to avoid
 * changing this function's already-tested row/col/center semantics on a
 * hunch.
 *
 * Grid indices (`row`/`col`) are stable across the *entire bounding-box
 * grid*, not just the cells that end up inside the polygon — that's what
 * lets `excludedCells` address a specific cell (e.g. "the chimney is at
 * row 2, col 3") independent of which cells the polygon happens to
 * include.
 *
 * Pure function — no I/O, no dependency on any other module (`panel-presets/`
 * is only referenced in the doc comment above for the field names it needs;
 * this module doesn't import it).
 */

import { pointInPolygon, type Point2D } from './geo'

/** Panel dimensions this function needs, matching `PanelPreset` from `panel-presets/`. */
export interface PanelDimensions {
  /** Panel width, in millimeters (the shorter edge, per `panel-presets/`'s convention). */
  widthMm: number
  /** Panel height, in millimeters (the longer edge). */
  heightMm: number
}

/** A grid cell address, as used by `excludedCells`. */
export interface GridCell {
  row: number
  col: number
}

/** A single placed panel. */
export interface PanelPlacement extends GridCell {
  /** Panel center, in the same local-meters frame as the input footprint. */
  center: Point2D
  /** Panel footprint corners (axis-aligned rectangle), in order, in local meters. */
  corners: Point2D[]
}

export interface PanelAutoFillOptions {
  /** Gap between panels along a row (in the grid's local x direction), in meters. Default 0.02 (2cm), a typical panel-to-panel racking gap. */
  columnGapM?: number
  /** Gap between rows (in the grid's local y direction), in meters. Default 0.02 (2cm). */
  rowGapM?: number
  /** Rotate each panel 90° (swap width/height) before laying out — e.g. "portrait" vs "landscape" orientation. Default false. */
  rotate90?: boolean
  /** Grid cells to exclude from the result (e.g. a chimney or vent pipe obstructing that cell), addressed by stable {row, col} grid indices. */
  excludedCells?: GridCell[]
}

export interface PanelAutoFillResult {
  panels: PanelPlacement[]
  /** Number of grid rows spanned by the footprint's bounding box (including cells excluded or outside the polygon). */
  rows: number
  /** Number of grid columns spanned by the footprint's bounding box (including cells excluded or outside the polygon). */
  cols: number
}

const DEFAULT_GAP_M = 0.02

function boundingBox(points: Point2D[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Lays out a grid of panel positions that fit within `footprintM`.
 *
 * @param footprintM Flat shape footprint, in local meters (at least 3 points).
 * @param panel Real panel dimensions (`widthMm`/`heightMm`), e.g. from a `panel-presets/` entry.
 * @param options Spacing, orientation, and cell-exclusion options.
 */
export function panelAutoFillGrid(
  footprintM: Point2D[],
  panel: PanelDimensions,
  options: PanelAutoFillOptions = {},
): PanelAutoFillResult {
  if (footprintM.length < 3) {
    throw new Error('panelAutoFillGrid: footprintM must have at least 3 points')
  }
  if (panel.widthMm <= 0 || panel.heightMm <= 0) {
    throw new Error(
      'panelAutoFillGrid: panel widthMm/heightMm must be positive',
    )
  }

  const columnGapM = options.columnGapM ?? DEFAULT_GAP_M
  const rowGapM = options.rowGapM ?? DEFAULT_GAP_M
  const excludedSet = new Set(
    (options.excludedCells ?? []).map((c) => `${c.row}:${c.col}`),
  )

  const panelWidthM = (options.rotate90 ? panel.heightMm : panel.widthMm) / 1000
  const panelHeightM =
    (options.rotate90 ? panel.widthMm : panel.heightMm) / 1000

  const { minX, minY, maxX, maxY } = boundingBox(footprintM)
  const bboxWidth = maxX - minX
  const bboxHeight = maxY - minY

  const colStep = panelWidthM + columnGapM
  const rowStep = panelHeightM + rowGapM

  // n panels of width w with (n-1) gaps of size g fit in span S when
  // n*w + (n-1)*g <= S, i.e. n <= (S + g) / (w + g).
  const cols = Math.max(0, Math.floor((bboxWidth + columnGapM) / colStep))
  const rows = Math.max(0, Math.floor((bboxHeight + rowGapM) / rowStep))

  const panels: PanelPlacement[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (excludedSet.has(`${row}:${col}`)) continue

      const cellMinX = minX + col * colStep
      const cellMinY = minY + row * rowStep
      const cellMaxX = cellMinX + panelWidthM
      const cellMaxY = cellMinY + panelHeightM
      const center: Point2D = {
        x: (cellMinX + cellMaxX) / 2,
        y: (cellMinY + cellMaxY) / 2,
      }

      if (!pointInPolygon(center, footprintM)) continue

      panels.push({
        row,
        col,
        center,
        corners: [
          { x: cellMinX, y: cellMinY },
          { x: cellMaxX, y: cellMinY },
          { x: cellMaxX, y: cellMaxY },
          { x: cellMinX, y: cellMaxY },
        ],
      })
    }
  }

  return { panels, rows, cols }
}
