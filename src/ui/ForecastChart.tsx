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
import type { LiveSimulationResult } from '../simulation'
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
  result: LiveSimulationResult | undefined
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
 * Formats an epoch-ms tick/tooltip timestamp in the *panel's local time*
 * when it's known, falling back to the *viewer's own browser timezone*
 * otherwise.
 *
 * Choice/tradeoff (see issue #17 and ADR 0016's live-mode gap note):
 * `SimulationResult` doesn't carry a real IANA timezone for the panel's
 * location, only (as of PR #43's review finding #5) the picker's
 * longitude-derived, whole-hour `utcOffsetHours` approximation. When
 * that's present, timestamps are shifted by that offset and formatted with
 * `timeZone: 'UTC'` — `Intl.DateTimeFormat` has no way to format "UTC+N"
 * directly for an arbitrary N, so shifting the instant and formatting in
 * UTC is the simplest way to get whole-hour-offset-correct wall-clock
 * labels. When it's not present (e.g. a caller that doesn't have a
 * `ResolvedLocation`), this falls back to the viewer's own browser
 * timezone — for the common case (someone checking a forecast for their
 * own roof) that usually *is* the panel's timezone anyway. Either way this
 * is an approximation, not a real IANA lookup; revisit if `SimulationResult`
 * ever carries the location's actual timezone.
 */
function buildFormatters(utcOffsetHours: number | undefined) {
  const hasFixedOffset = typeof utcOffsetHours === 'number'
  const timeZone = hasFixedOffset ? 'UTC' : undefined
  const shift = hasFixedOffset ? utcOffsetHours * 3_600_000 : 0

  const tick = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    timeZone,
  })
  const tooltip = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  })

  return {
    formatTick: (epochMs: number) => tick.format(epochMs + shift),
    formatTooltip: (epochMs: number) => tooltip.format(epochMs + shift),
  }
}

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
  const { formatTick, formatTooltip } = useMemo(
    () => buildFormatters(result?.location.utcOffsetHours),
    [result],
  )

  if (!result || data.length === 0) {
    // Distinct from the shared `EmptyState` ("no location selected")
    // deliberately: this component's actual empty condition is "no
    // Live-mode simulation has been run yet for the current inputs" —
    // reachable on every TMY -> Live mode switch even with a location
    // already set (see PR #43 review finding #2). Matches the TMY charts'
    // pattern of describing their own empty condition (e.g. `DailyChart`'s
    // "No simulation data available for this location yet.").
    return (
      <div className={styles.empty}>
        Click Update to fetch a forecast for this location.
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
            tickFormatter={(value: number) => formatTick(value)}
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
              typeof label === 'number' ? formatTooltip(label) : label
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
