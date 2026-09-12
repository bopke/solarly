import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TmySimulationResult } from '../simulation'
import styles from './DailyChart.module.css'

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export interface DailyChartProps {
  /**
   * TMY simulation result to render the Daily tab from, or `undefined`
   * before a run has completed. `AppShell`'s empty/loading states already
   * cover "no location yet" / "run in flight" (see `MainArea`'s panel
   * priority order — `tabContent` isn't consulted for either case), so
   * this component only needs to handle the defensive case of a genuinely
   * empty `months` array (e.g. a location with no usable NASA POWER
   * coverage) on its own.
   */
  result?: TmySimulationResult
}

/**
 * Daily chart tab: an hourly power curve (W) for one month's representative
 * day, with a slider to pick which month's day is shown. See the M1 design
 * spec's "Daily (with a date/day-of-year slider ...)" tab description and
 * issue #14.
 */
export function DailyChart({ result }: DailyChartProps) {
  const months = result?.months ?? []
  const [selectedIndex, setSelectedIndex] = useState(0)

  // `months` can shrink between renders (e.g. a re-run with a different
  // location); clamp rather than let `selectedIndex` point past the end.
  const clampedIndex =
    months.length === 0 ? 0 : Math.min(selectedIndex, months.length - 1)
  const monthData = months[clampedIndex]

  const chartData = useMemo(
    () =>
      monthData?.representativeDayHourly.map((point) => ({
        hour: point.hour,
        powerW: point.powerW,
      })) ?? [],
    [monthData],
  )

  if (months.length === 0) {
    return (
      <div className={styles.empty}>
        No simulation data available for this location yet.
      </div>
    )
  }

  const monthName =
    MONTH_NAMES[monthData.month - 1] ?? `Month ${monthData.month}`

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <label
          className={styles.sliderLabel}
          htmlFor="daily-chart-month-slider"
        >
          Representative day:{' '}
          <span className={styles.monthName}>{monthName}</span>
        </label>
        <input
          id="daily-chart-month-slider"
          className={styles.slider}
          type="range"
          min={0}
          max={Math.max(months.length - 1, 0)}
          step={1}
          value={clampedIndex}
          disabled={months.length <= 1}
          onChange={(event) => setSelectedIndex(Number(event.target.value))}
          aria-valuetext={monthName}
        />
      </div>
      <div className={styles.summary}>
        {monthData.representativeDayTotalKWh.toFixed(1)} kWh on this day
        &middot; {monthData.monthlyTotalKWh.toFixed(0)} kWh estimated for{' '}
        {monthName}
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
        >
          <CartesianGrid stroke="var(--shell-border)" vertical={false} />
          <XAxis
            dataKey="hour"
            tickFormatter={(hour: number) => `${hour}:00`}
            stroke="var(--shell-muted)"
            tick={{ fill: 'var(--shell-muted)', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--shell-border)' }}
            interval={2}
          />
          <YAxis
            stroke="var(--shell-muted)"
            tick={{ fill: 'var(--shell-muted)', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--shell-border)' }}
            width={56}
            label={{
              value: 'Power (W)',
              angle: -90,
              position: 'insideLeft',
              fill: 'var(--shell-muted)',
              fontSize: 12,
            }}
          />
          <Tooltip
            formatter={(value) => [`${Math.round(Number(value))} W`, 'Power']}
            labelFormatter={(hour) => `${hour}:00`}
            contentStyle={{
              background: 'var(--shell-surface)',
              border: '1px solid var(--shell-border)',
              borderRadius: 4,
              color: 'var(--shell-text)',
            }}
          />
          <Line
            type="monotone"
            dataKey="powerW"
            name="Power"
            stroke="var(--shell-accent)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
