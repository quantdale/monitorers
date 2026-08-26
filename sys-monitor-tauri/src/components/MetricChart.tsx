import { memo } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import type { ChartPoint } from '../chartPoints';

interface Props {
  data: ChartPoint[];
  yDomain: [number, number | 'auto'];
  color: string;
  secondaryColor?: string;
  hasSecondary: boolean;
  /** Default/tile views show the time axis; list view hides it. */
  showTimeAxis: boolean;
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
export const MetricChart = memo(function MetricChart({ data, yDomain, color, secondaryColor, hasSecondary, showTimeAxis }: Props) {
  const primaryFillOpacity = hasSecondary ? 0 : showTimeAxis ? 0.15 : 0.2;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
        margin={showTimeAxis ? { top: 2, right: 0, bottom: 0, left: 0 } : { top: 2, right: 4, bottom: 2, left: 0 }}
      >
        <YAxis domain={yDomain} hide />
        {showTimeAxis ? (
          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(ms: number) =>
              new Date(ms).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })
            }
            tick={{ fontSize: 10 }}
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
