import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SimulationResult } from '../simulation'
import { EmptyState } from './EmptyState'
import styles from './ForecastChart.module.css'

export interface ForecastChartProps {
  /**
   * The active simulation result to chart, or `undefined` before a run has
   * completed (e.g. no location chosen yet, or Update hasn't been clicked).
   * `MainArea` already gates on `hasLocation`/`isLoading`/`error` before
   * rendering tab content, so `undefined` here should be rare in practice,
   * but the component handles it (and an empty `hourlyWattsSeries`)
   * gracefully rather than assuming a caller always has data ready.
   */
  result: SimulationResult | undefined
}

/** One point fed to Recharts: `watts` is `null` for a synthetic gap marker (see {@link buildChartData}). */
interface ChartPoint {
  /** Epoch milliseconds — a numeric axis lets Recharts space points by real elapsed time, not just index. */
  time: number
  /** Power in watts, or `null` to force a visual break in the line at this point. */
  watts: number | null
}

/**
 * Turns a `HourlyPowerPoint[]` (which may have gaps — see `SimulationResult`'s
 * doc comment and issue #7/#10's notes on Open-Meteo dropping null-padded
 * hours) into Recharts data that visually breaks at those gaps instead of
 * drawing a misleading straight line across missing hours.
 *
 * Approach: sort defensively, then find the typical spacing between
 * consecutive points (the minimum positive gap — robust to the series not
 * being perfectly evenly spaced). Any gap noticeably larger than that
 * (>1.5x) gets a synthetic `watts: null` point inserted at its midpoint;
 * combined with `<Line connectNulls={false}>`, Recharts renders a break
 * there instead of interpolating.
 */
function buildChartData(
  points: { timestamp: string; watts: number }[],
): ChartPoint[] {
  const sorted = [...points]
    .map((p) => ({ time: new Date(p.timestamp).getTime(), watts: p.watts }))
    .filter((p) => Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time)

  if (sorted.length === 0) return []

  const gaps = sorted
    .slice(1)
    .map((p, i) => p.time - sorted[i].time)
    .filter((diff) => diff > 0)
  const typicalStep = gaps.length > 0 ? Math.min(...gaps) : 3600_000
  const gapThreshold = typicalStep * 1.5

  const data: ChartPoint[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const current = sorted[i]
    if (current.time - prev.time > gapThreshold) {
      data.push({ time: (prev.time + current.time) / 2, watts: null })
    }
    data.push(current)
  }
  return data
}

/**
 * Formats an epoch-ms tick/tooltip timestamp in the *viewer's own browser
 * timezone* rather than UTC.
 *
 * Choice/tradeoff (see issue #17 and ADR 0016's live-mode gap note):
 * `SimulationResult` doesn't currently carry the panel location's timezone,
 * so there's no way to bucket these hours into the *panel's* local days
 * exactly right. Two honest options: label everything in UTC, or format
 * using the viewer's own browser timezone via `Intl.DateTimeFormat`. This
 * picks the latter — for the common case (someone checking a forecast for
 * their own roof) the viewer's timezone usually *is* the panel's timezone,
 * so times read as "3pm" rather than an offset viewers must mentally
 * convert. It reads slightly wrong for the minority checking a forecast for
 * a distant location, but "your local time" is verifiably the more useful
 * default for most Solarly users. Revisit once `SimulationResult` carries
 * the location's IANA timezone (tracked as a gap from issue #10's review).
 */
const tickFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
})
const tooltipFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * Forecast tab content: an hourly power line chart across the fetched
 * forecast horizon (whatever `hourlyWattsSeries` contains — Open-Meteo's
 * forecast horizon is typically 3-7 days, per the M1 design doc, but this
 * doesn't assume a fixed length). Only shown/active when the app shell's
 * mode is `'live'` — see `MainArea`/`TABS_BY_MODE`.
 */
export function ForecastChart({ result }: ForecastChartProps) {
  const data = useMemo(
    () => buildChartData(result?.hourlyWattsSeries ?? []),
    [result],
  )

  if (!result || data.length === 0) {
    return (
      <div className={styles.emptyWrapper}>
        <EmptyState />
      </div>
    )
  }

  return (
    <div className={styles.chart} data-testid="forecast-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
        >
          <CartesianGrid stroke="var(--shell-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(value: number) => tickFormatter.format(value)}
            stroke="var(--shell-muted)"
            tick={{ fill: 'var(--shell-muted)', fontSize: 12 }}
            minTickGap={40}
          />
          <YAxis
            dataKey="watts"
            unit=" W"
            stroke="var(--shell-muted)"
            tick={{ fill: 'var(--shell-muted)', fontSize: 12 }}
            width={64}
          />
          <Tooltip
            labelFormatter={(label) =>
              typeof label === 'number' ? tooltipFormatter.format(label) : label
            }
            formatter={(value) => [
              typeof value === 'number' ? `${Math.round(value)} W` : 'No data',
              'Power',
            ]}
            contentStyle={{
              background: 'var(--shell-surface)',
              border: '1px solid var(--shell-border)',
              borderRadius: 6,
              color: 'var(--shell-text)',
            }}
          />
          <Line
            type="monotone"
            dataKey="watts"
            stroke="var(--shell-accent)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
