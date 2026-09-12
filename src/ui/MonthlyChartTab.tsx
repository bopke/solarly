import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import type { ReactElement } from 'react'
import type { SimulationResult } from '../simulation/types'
import styles from './MonthlyChartTab.module.css'

export interface MonthlyChartTabProps {
  /**
   * TMY simulation result to chart, or `undefined` while no run has
   * completed yet (e.g. before the first "Update" click) — see
   * {@link MainArea}'s empty/loading states, which normally take priority
   * over rendering this tab at all. Renders its own empty message if a
   * caller shows this tab anyway.
   */
  result: SimulationResult | undefined
}

/** Short month labels, index 0 = January, matching `MonthlySimulation.month` (1-12). */
const MONTH_LABELS = [
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

interface MonthlyChartPoint {
  month: number
  label: string
  kWh: number
}

/**
 * Builds a fixed 12-point series (January through December), filling in 0
 * for any month `result.months` doesn't include. `SimulationResult.months`
 * only contains entries NASA POWER had usable data for (1-12 entries, see
 * the type's doc) — a high-latitude location can drop a polar-night month
 * entirely, or (per `runTmySimulation`'s degenerate-day fallback) include
 * it with a near-zero total. Always rendering all 12 x-axis slots keeps
 * the chart's month spacing consistent regardless of which case applies,
 * rather than compressing the bars to however many months came back.
 */
function buildMonthlySeries(result: SimulationResult): MonthlyChartPoint[] {
  const byMonth = new Map(result.months.map((m) => [m.month, m]))
  return MONTH_LABELS.map((label, index) => {
    const month = index + 1
    return {
      month,
      label,
      kWh: byMonth.get(month)?.monthlyTotalKWh ?? 0,
    }
  })
}

function formatKWh(value: number): string {
  // Fixed 'en-US' locale (rather than the runtime default) for
  // deterministic thousands-grouping regardless of the viewer's/test
  // environment's locale.
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 0 })} kWh`
}

function ChartTooltip({
  active,
  payload,
}: TooltipContentProps): ReactElement | null {
  if (!active || !payload || payload.length === 0) {
    return null
  }
  const point = payload[0].payload as MonthlyChartPoint
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipMonth}>{point.label}</p>
      <p className={styles.tooltipValue}>{formatKWh(point.kWh)}</p>
    </div>
  )
}

/**
 * Monthly chart tab (issue #15): a bar chart of estimated total generation
 * per calendar month, plus the annual total displayed prominently above
 * it. Renders from `SimulationResult` (TMY mode only — this tab isn't
 * shown in Live mode, see `TABS_BY_MODE`).
 */
export function MonthlyChartTab({ result }: MonthlyChartTabProps) {
  if (!result || result.months.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No monthly data available yet.</p>
      </div>
    )
  }

  const series = buildMonthlySeries(result)

  return (
    <div className={styles.container}>
      <div className={styles.summary}>
        <span className={styles.summaryLabel}>Estimated annual total</span>
        <span className={styles.summaryValue}>
          {formatKWh(result.annualTotalKWh)}
        </span>
      </div>
      <div className={styles.chartWrapper}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={series}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--shell-border)"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--shell-muted)', fontSize: 12 }}
              axisLine={{ stroke: 'var(--shell-border)' }}
              tickLine={false}
              interval={0}
            />
            <YAxis
              tick={{ fill: 'var(--shell-muted)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={48}
              label={{
                value: 'kWh',
                angle: -90,
                position: 'insideLeft',
                fill: 'var(--shell-muted)',
                fontSize: 12,
              }}
            />
            <Tooltip
              content={(props) => <ChartTooltip {...props} />}
              cursor={{ fill: 'var(--shell-hover)' }}
            />
            <Bar
              dataKey="kWh"
              name="Monthly total"
              fill="var(--shell-accent)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
