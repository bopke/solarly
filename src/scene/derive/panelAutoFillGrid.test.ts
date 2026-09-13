import { describe, expect, it } from 'vitest'
import { panelAutoFillGrid } from './panelAutoFillGrid'
import type { Point2D } from './geo'

describe('panelAutoFillGrid', () => {
  const rectangle4x2: Point2D[] = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 2 },
    { x: 0, y: 2 },
  ]
  // 1m x 0.5m panels, no gap: fits exactly 4 columns x 4 rows = 16 panels
  // in the 4m x 2m rectangle above (a hand-checkable exact tiling).
  const panel1mBy0_5m = { widthMm: 1000, heightMm: 500 }

  it('rejects a degenerate footprint (fewer than 3 points)', () => {
    expect(() =>
      panelAutoFillGrid(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        panel1mBy0_5m,
      ),
    ).toThrow()
  })

  it('rejects non-positive panel dimensions', () => {
    expect(() =>
      panelAutoFillGrid(rectangle4x2, { widthMm: 0, heightMm: 500 }),
    ).toThrow()
  })

  it('exactly tiles a rectangle whose dimensions are whole multiples of the panel size (no gap)', () => {
    const result = panelAutoFillGrid(rectangle4x2, panel1mBy0_5m, {
      columnGapM: 0,
      rowGapM: 0,
    })
    expect(result.cols).toBe(4)
    expect(result.rows).toBe(4)
    expect(result.panels).toHaveLength(16)
  })

  it('no panel corner falls outside the footprint bounding box', () => {
    const result = panelAutoFillGrid(rectangle4x2, panel1mBy0_5m, {
      columnGapM: 0,
      rowGapM: 0,
    })
    for (const panel of result.panels) {
      for (const corner of panel.corners) {
        expect(corner.x).toBeGreaterThanOrEqual(0 - 1e-9)
        expect(corner.x).toBeLessThanOrEqual(4 + 1e-9)
        expect(corner.y).toBeGreaterThanOrEqual(0 - 1e-9)
        expect(corner.y).toBeLessThanOrEqual(2 + 1e-9)
      }
    }
  })

  it('adding gaps reduces how many panels fit', () => {
    const noGap = panelAutoFillGrid(rectangle4x2, panel1mBy0_5m, {
      columnGapM: 0,
      rowGapM: 0,
    })
    const withGap = panelAutoFillGrid(rectangle4x2, panel1mBy0_5m, {
      columnGapM: 0.5,
      rowGapM: 0.5,
    })
    expect(withGap.panels.length).toBeLessThan(noGap.panels.length)
  })

  it('excludes a specific marked cell (e.g. a chimney) from the result', () => {
    const withoutExclusion = panelAutoFillGrid(rectangle4x2, panel1mBy0_5m, {
      columnGapM: 0,
      rowGapM: 0,
    })
    const withExclusion = panelAutoFillGrid(rectangle4x2, panel1mBy0_5m, {
      columnGapM: 0,
      rowGapM: 0,
      excludedCells: [{ row: 1, col: 2 }],
    })
    expect(withExclusion.panels).toHaveLength(
      withoutExclusion.panels.length - 1,
    )
    expect(withExclusion.panels.some((p) => p.row === 1 && p.col === 2)).toBe(
      false,
    )
  })

  it("excluding a cell outside the grid range is a no-op (doesn't throw, doesn't drop anything)", () => {
    const result = panelAutoFillGrid(rectangle4x2, panel1mBy0_5m, {
      columnGapM: 0,
      rowGapM: 0,
      excludedCells: [{ row: 99, col: 99 }],
    })
    expect(result.panels).toHaveLength(16)
  })

  it('rotate90 swaps panel width/height, changing how many fit', () => {
    // A 1m x 0.5m panel rotated 90deg becomes 0.5m x 1m: 8 columns x 2
    // rows = 16 panels still fit the 4m x 2m rectangle exactly (a
    // different, but also exact, hand-checkable tiling).
    const result = panelAutoFillGrid(rectangle4x2, panel1mBy0_5m, {
      columnGapM: 0,
      rowGapM: 0,
      rotate90: true,
    })
    expect(result.cols).toBe(8)
    expect(result.rows).toBe(2)
    expect(result.panels).toHaveLength(16)
  })

  it('a triangular footprint only includes grid cells whose center is inside the triangle', () => {
    // Right triangle with legs of 4m along both axes: (0,0), (4,0), (0,4).
    // With 1m x 1m panels and no gap, the bounding-box grid is 4x4 = 16
    // cells; a cell (row r, col c)'s center (c+0.5, r+0.5) is inside the
    // triangle (x + y < 4) exactly when r + c <= 2, which holds for 6 of
    // the 16 cells — a hand-countable expected value.
    const triangle: Point2D[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ]
    const panel1m = { widthMm: 1000, heightMm: 1000 }
    const result = panelAutoFillGrid(triangle, panel1m, {
      columnGapM: 0,
      rowGapM: 0,
    })
    expect(result.rows).toBe(4)
    expect(result.cols).toBe(4)
    expect(result.panels).toHaveLength(6)
    for (const panel of result.panels) {
      expect(panel.row + panel.col).toBeLessThanOrEqual(2)
    }
  })

  it('is a pure function: repeated calls with the same inputs return equal results', () => {
    const first = panelAutoFillGrid(rectangle4x2, panel1mBy0_5m)
    const second = panelAutoFillGrid(rectangle4x2, panel1mBy0_5m)
    expect(second).toEqual(first)
  })
})
