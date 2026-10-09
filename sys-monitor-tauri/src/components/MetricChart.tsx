import { memo } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import type { ChartPoint } from '../chartPoints';
import { formatAxisTick } from '../cards/chartLabels';

/** Tick text on the card surface (#1e1e1e): 4.7:1, above the 4.5:1 floor.
 *  The chart library's default gray (#666) measures ~2.90:1 — unreadable. */
const TICK_FILL = '#888';
/** Axis stroke as a graphical object: 3.9:1, above the 3:1 floor. */
const AXIS_STROKE = '#7a7a7a';
/** The widest label (`HH:MM:SS` at 10px) fits in ~55px; 80 keeps adjacent
 *  labels apart once Recharts thins ticks to honor minTickGap. */
const TICK_MIN_GAP = 80;
/** Room for the 10px label baseline inside the fixed 140px chart box. */
const TIME_AXIS_BOTTOM_MARGIN = 16;

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
  const primaryFillOpacity = hasSecondary ? 0 : showTimeAxis ? 0.15 : 0.2;
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
        <YAxis domain={yDomain} hide />
        {showTimeAxis ? (
          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(ms: number) => formatAxisTick(ms, spanMs)}
            tick={{ fontSize: 10, fill: TICK_FILL }}
            stroke={AXIS_STROKE}
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
          fill={color}
          fillOpacity={primaryFillOpacity}
          strokeWidth={1.5}
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
            strokeWidth={1.5}
            isAnimationActive={false}
            dot={false}
            connectNulls={false}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
});
