import type { SimulationResult } from '../simulation/types'
import { powerToColor, SEQUENTIAL_BLUE_RAMP } from './heatmapColorScale'
import styles from './Heatmap.module.css'

export interface HeatmapProps {
  /** TMY simulation result to render, or `undefined` before one exists. */
  result: SimulationResult | undefined
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const HOUR_TICKS = [0, 6, 12, 18, 23]

const CELL_W = 28
const CELL_H = 12
const LABEL_COL_W = 32
const MONTH_LABEL_H = 18
const CHART_W_PADDING = 8

/**
 * Hour-of-day x day-of-year heatmap of panel power output (W).
 *
 * **Sparse-data rendering approach:** `SimulationResult` only contains one
 * representative day per calendar month (12 points along the day-of-year
 * axis, not 365) — see `docs/decisions/0040-tmy-disaggregation-approach.md`
 * ("Representative-day-per-month, not a full 365-day simulation"). This
 * component renders that as **12 discrete columns, one per representative
 * day, labeled by month** (option (a) from issue #16) rather than
 * interpolating a continuous 365-day surface. A full-width interpolated
 * heatmap would visually imply day-to-day resolution the underlying data
 * doesn't have — the ADR's own follow-up section flags day-of-year
 * interpolation as a possible *future* enhancement, not something to fake
 * now. Discrete, clearly-labeled columns are simpler and more honest about
 * what was actually simulated.
 *
 * Color: sequential (single-hue, light-to-dark) blue scale mapped across
 * every rendered cell's power value — see `heatmapColorScale.ts`.
 */
export function Heatmap({ result }: HeatmapProps) {
  const months = result?.months ?? []

  if (months.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No heatmap data yet</p>
        <p className={styles.emptyHint}>
          Run a TMY simulation to see hour-of-day x month power output.
        </p>
      </div>
    )
  }

  const sortedMonths = [...months].sort((a, b) => a.month - b.month)

  let maxPowerW = 0
  for (const m of sortedMonths) {
    for (const h of m.representativeDayHourly) {
      if (h.powerW > maxPowerW) maxPowerW = h.powerW
    }
  }

  const chartW = sortedMonths.length * CELL_W
  const chartH = HOURS.length * CELL_H
  const svgW = LABEL_COL_W + chartW + CHART_W_PADDING
  const svgH = MONTH_LABEL_H + chartH

  return (
    <div className={styles.container}>
      <svg
        role="img"
        aria-label="Heatmap of power output by hour of day and month, from each month's representative day"
        className={styles.svg}
        viewBox={`0 0 ${svgW} ${svgH}`}
        width={svgW}
        height={svgH}
      >
        {/* Month (column) labels */}
        {sortedMonths.map((m, colIdx) => (
          <text
            key={`label-${m.month}`}
            x={LABEL_COL_W + colIdx * CELL_W + CELL_W / 2}
            y={MONTH_LABEL_H - 5}
            textAnchor="middle"
            className={styles.axisLabel}
          >
            {MONTH_ABBR[m.month - 1] ?? m.month}
          </text>
        ))}

        {/* Hour (row) tick labels */}
        {HOUR_TICKS.map((hour) => (
          <text
            key={`hour-${hour}`}
            x={LABEL_COL_W - 6}
            y={MONTH_LABEL_H + hour * CELL_H + CELL_H / 2 + 3}
            textAnchor="end"
            className={styles.axisLabel}
          >
            {hour}
          </text>
        ))}

        {/* Cells */}
        {sortedMonths.map((m, colIdx) => {
          const byHour = new Map(
            m.representativeDayHourly.map((h) => [h.hour, h.powerW]),
          )
          return HOURS.map((hour) => {
            const powerW = byHour.get(hour) ?? 0
            return (
              <rect
                key={`cell-${m.month}-${hour}`}
                data-testid={`heatmap-cell-${m.month}-${hour}`}
                x={LABEL_COL_W + colIdx * CELL_W}
                y={MONTH_LABEL_H + hour * CELL_H}
                width={CELL_W}
                height={CELL_H}
                fill={powerToColor(powerW, maxPowerW)}
                className={styles.cell}
              >
                <title>
                  {`${MONTH_ABBR[m.month - 1] ?? m.month} ${String(hour).padStart(2, '0')}:00 - ${powerW.toFixed(0)} W`}
                </title>
              </rect>
            )
          })
        })}
      </svg>

      <Legend maxPowerW={maxPowerW} />
    </div>
  )
}

function Legend({ maxPowerW }: { maxPowerW: number }) {
  const stops = SEQUENTIAL_BLUE_RAMP
  const gradientId = 'heatmap-legend-gradient'

  return (
    <div className={styles.legend} aria-hidden="true">
      <span className={styles.legendLabel}>0 W</span>
      <svg width={140} height={12} className={styles.legendSwatch}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            {stops.map(([step, hex], i) => (
              <stop
                key={step}
                offset={`${(i / (stops.length - 1)) * 100}%`}
                stopColor={hex}
              />
            ))}
          </linearGradient>
        </defs>
        <rect width={140} height={12} fill={`url(#${gradientId})`} />
      </svg>
      <span className={styles.legendLabel}>{Math.round(maxPowerW)} W</span>
    </div>
  )
}
