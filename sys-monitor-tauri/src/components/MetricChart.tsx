import { memo, useId } from 'react';
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import type { ChartPoint } from '../chartPoints';
import { formatAxisTick } from '../cards/chartLabels';
import { chartAxisStroke, chartGrid, chartTickFill } from '../design/tokens';

/** The widest label (`HH:MM:SS` at 10px) fits in ~55px; 80 keeps adjacent
 *  labels apart once Recharts thins ticks to honor minTickGap. */
const TICK_MIN_GAP = 80;
/** Room for the 10px label baseline inside the fixed 140px chart box. */
const TIME_AXIS_BOTTOM_MARGIN = 16;
/** Gradient fade: the area under the line dissolves into the card instead of
 *  ending in a hard edge. */
const FILL_TOP_OPACITY = 0.22;

interface Props {
  data: ChartPoint[];
  yDomain: [number, number | 'auto'];
  color: string;
  secondaryColor?: string;
  hasSecondary: boolean;
  /** Default/tile views show the time axis; list view hides it. */
  showTimeAxis: boolean;
  /** Accessible name for the chart graphic. The chart is a picture of the
   *  window, not a control: Recharts 3 defaults `accessibilityLayer` on, which
   *  otherwise leaves every chart as `<svg role="application" tabindex="0">`
   *  with an empty <title> — an unnamed tab stop per card. */
  label: string;
}

/**
 * The live area chart body of a MetricCard, split into its own module so the
 * recharts bundle can be loaded through React.lazy off the critical path.
 * The surrounding card keeps title/value/badges and its data-chart-*
 * metadata attributes synchronous. Live 1 Hz data must not animate.
 *
 * Memoized: the card tree rebuilds on every ~250ms scalar tick (live CPU/GPU
 * values change), but every prop here is either primitive or an identity-
 * stable object — `data` comes from MetricCard's history-keyed memo, and all
 * yDomain literals are hoisted module constants (a fresh `[0, 'auto']` array
 * per render would defeat the memo). Measured on the mock harness: this skips
 * roughly 3/4 of chart-body renders (686 → ~170 per 7 charts over a 12s
 * window), and the Recharts subtree dominates this app's long tasks.
 */
export const MetricChart = memo(function MetricChart({ data, yDomain, color, secondaryColor, hasSecondary, showTimeAxis, label }: Props) {
  // Gradient ids must be unique per chart instance or sibling cards cross-wire
  // each other's fills; useId is stable across renders, so the memoized subtree
  // keeps a constant id (no fan-out).
  const gradientId = useId();
  const primaryFill = `url(#${gradientId})`;
  // Span of the points already passed in — a 250 ms scalar tick is not a prop
  // here, so this recomputes only when the committed data does (~1 Hz) and
  // keeps the axis format out of the memo-defeating render path.
  const spanMs = data.length > 1 ? data[data.length - 1].t - data[0].t : 0;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
        role="img"
        aria-label={label}
        tabIndex={-1}
        margin={showTimeAxis ? { top: 2, right: 0, bottom: TIME_AXIS_BOTTOM_MARGIN, left: 0 } : { top: 2, right: 4, bottom: 2, left: 0 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={FILL_TOP_OPACITY} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* Faint dotted horizontal grid: enough to read heights against, far
            too quiet to compete with the series (chargetrip/Polar pattern). */}
        <CartesianGrid horizontal vertical={false} stroke={chartGrid} strokeDasharray="2 4" />
        <YAxis domain={yDomain} hide />
        {showTimeAxis ? (
          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(ms: number) => formatAxisTick(ms, spanMs)}
            tick={{ fontSize: 10, fill: chartTickFill }}
            stroke={chartAxisStroke}
            minTickGap={TICK_MIN_GAP}
            interval="preserveStartEnd"
          />
        ) : (
          <XAxis dataKey="t" hide />
        )}
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          fill={hasSecondary ? 'none' : primaryFill}
          fillOpacity={hasSecondary ? 0 : 1}
          strokeWidth={2}
          isAnimationActive={false}
          dot={false}
          connectNulls={false}
        />
        {hasSecondary && (
          <Area
            type="monotone"
            dataKey="v2"
            stroke={secondaryColor!}
            fill={secondaryColor!}
            fillOpacity={0}
            strokeWidth={2}
            isAnimationActive={false}
            dot={false}
            connectNulls={false}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
});
