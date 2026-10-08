import { lazy, Suspense, useMemo } from 'react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import type { ViewMode } from '../utils';
import { historyMinMax } from '../utils';
import { computeChartPoints, type ChartPoint } from '../chartPoints';
import { formatPercentRange } from '../cards/formatters';
import { buildDualSeriesChartLabel, buildSingleSeriesChartLabel } from '../cards/chartLabels';
import type { MetricValue } from '../types/metrics';

const MAX_CHART_POINTS = 300;

/** Shared identity for the default y-domain — a fresh `[0, 100]` literal per
 * render would defeat MetricChart's prop-level memo. */
const DEFAULT_Y_DOMAIN: [number, number | 'auto'] = [0, 100];

// Recharts (with its d3 tree) is the heaviest dependency: load the chart
// body off the critical path. Titles, values, badges and the data-chart-*
// metadata attributes stay synchronous so tests and E2E never wait on this
// chunk to assert card state.
const MetricChart = lazy(() => import('./MetricChart').then((m) => ({ default: m.MetricChart })));

/** Accessible placeholder while the chart chunk loads; reserves the exact
 * chart box so nothing shifts when the real chart mounts. #888 on #1a1a1a
 * keeps the status text above the WCAG AA 4.5:1 bar. */
function ChartLoading({ height }: { height: number | '100%' }) {
  return (
    <div
      role="status"
      aria-label="Rendering chart"
      style={{ width: '100%', height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <span style={{ color: '#888', fontSize: 11, fontFamily: 'monospace' }}>Rendering chart…</span>
    </div>
  );
}

interface DragHandleProps {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
}

interface Props {
  id: string;
  title: string;
  value: string;
  history?: MetricValue[];
  timestamps?: number[];
  color: string;
  yDomain?: [number, number | 'auto'];
  badge?: React.ReactNode;
  viewMode: ViewMode;
  isDragging?: boolean;
  dragHandleProps?: DragHandleProps;
  /** Second series for dual-line charts (e.g. network upload/download). No fill, line only. */
  secondaryHistory?: MetricValue[];
  secondaryColor?: string;
  /** Custom list view value and min/max when default formatting doesn't apply (e.g. network KB/s). */
  listViewValue?: string | React.ReactNode;
  listViewMinMax?: string | React.ReactNode;
}

export function MetricCard({
  id,
  title,
  value,
  history,
  timestamps,
  color,
  yDomain = DEFAULT_Y_DOMAIN,
  badge,
  viewMode,
  isDragging,
  dragHandleProps,
  secondaryHistory,
  secondaryColor,
  listViewValue,
  listViewMinMax,
}: Props) {
  const hasChart = history != null && history.length > 0;
  const hasSecondary = secondaryHistory != null && secondaryHistory.length > 0 && secondaryColor != null;

  // Resampling a full ring (up to MAX_HISTORY=3600 samples) down to chart
  // points runs per card on every render. The channel arrays keep stable
  // identities across scalar-only live ticks (see useMetrics' windowed
  // memo), so keying this memo on them skips the extrema resample for the
  // three non-full ticks between history commits and after unrelated
  // re-renders (drag, sidebar toggles) — it only recomputes when that
  // series' data or alignment actually changed.
  const chart = useMemo(() => {
    if (!hasChart) {
      return {
        data: [] as ChartPoint[],
        metadata: {
          'data-chart-point-count': 0,
          'data-chart-gap-count': 0,
          'data-chart-start-ts': '' as string | number,
          'data-chart-latest-ts': '' as string | number,
          'data-chart-span-ms': 0,
        },
      };
    }
    const data = computeChartPoints({
      history: history!,
      timestamps,
      secondaryHistory: hasSecondary ? secondaryHistory : undefined,
      maxPoints: MAX_CHART_POINTS,
    });
    return {
      data,
      metadata: {
        'data-chart-point-count': data.length,
        'data-chart-gap-count': data.filter((point) => point.v == null).length,
        'data-chart-start-ts': data[0]?.t ?? '',
        'data-chart-latest-ts': data[data.length - 1]?.t ?? '',
        'data-chart-span-ms': data.length > 1 ? data[data.length - 1].t - data[0].t : 0,
      },
    };
    // The dependency array is intentionally partial. `secondaryHistory` only
    // participates when `hasSecondary` is true, so it is expressed as
    // `hasSecondary ? secondaryHistory : undefined`: when hasSecondary is
    // false the secondary channel is not read at all, and depending on the
    // raw object would recompute identical data. There is no linter in this
    // project enforcing exhaustive-deps, so this note is the record of intent —
    // do not read a missing eslint-disable here as an oversight.
  }, [history, hasSecondary ? secondaryHistory : undefined, timestamps]);
  const { data, metadata: chartMetadata } = chart;

  // List-view min/max scans the whole window per render; same identity-based skip.
  const listMinMax = useMemo(() => historyMinMax(history ?? []), [history]);

  // The chart is a graphic, not a control: it gets an accessible name that
  // carries what a sighted user reads off the shape (current value plus the
  // visible min/max) instead of being an unnamed, focusable `application`
  // widget with an empty <title>.
  //
  // The "now" figure is read from the chart data's own latest point, NOT from
  // the live `value` prop: live scalars merge on every ~250 ms tick, and a
  // label derived from them would change 4x per second and defeat
  // MetricChart's memo — re-mounting the Recharts subtree on every tick is the
  // single largest main-thread cost this app has (see the fan-out guard in
  // MetricChart.test.tsx). Keyed on `data`, the label changes only when the
  // window's committed samples do (~1 Hz).
  const resolvedChartLabel = useMemo(() => {
    const latest = data[data.length - 1];
    return hasSecondary
      ? buildDualSeriesChartLabel(title, latest?.v ?? null, latest?.v2 ?? null)
      : buildSingleSeriesChartLabel(title, latest?.v ?? null, listMinMax.min, listMinMax.max);
  }, [data, hasSecondary, title, listMinMax.min, listMinMax.max]);

  const borderStyle = { border: '1px solid #444', padding: '4px 8px', borderRadius: 4 };

  const dragHandle = (
    <button
      type="button"
      className="drag-handle"
      data-testid={`drag-handle-${id}`}
      {...(dragHandleProps?.attributes ?? {})}
      {...(dragHandleProps?.listeners ?? {})}
      aria-label={`Reorder ${title} card`}
      style={{ padding: '0 8px', display: 'flex', alignItems: 'center', fontSize: 16, color: '#7a7a7a', userSelect: 'none', background: 'transparent', border: 0 }}
      title={`Reorder ${title} card`}
    >
      <span aria-hidden="true">⠿</span>
    </button>
  );

  if (viewMode === 'list') {
    const { min, max } = listMinMax;
    const displayValue = listViewValue ?? value;
    const displayMinMax = listViewMinMax ?? formatPercentRange(min, max);

    return (
      <div
        className="metric-card"
        data-testid={`metric-card-${id}`}
        style={{
          background: '#1e1e1e',
          borderRadius: 8,
          // Grows instead of clipping: a fixed 50px height with overflow:hidden
          // cut the network card's wrapped range pills off entirely (measured
          // scrollHeight 72 > clientHeight 50 at a 390px viewport).
          minHeight: 50,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'stretch',
          opacity: isDragging ? 0.5 : 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'center' }}>
          {dragHandle}
        </div>

        {/* Left panel — title + value on line 1, min/max on line 2. A flexible
            basis with a minimum keeps long hardware names and value pills from
            squeezing the title into an ellipsis. */}
        <div
          style={{
            flex: '1 1 55%',
            maxWidth: '65%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 10px',
            gap: 2,
            minWidth: 0,
            // Nothing may paint outside the panel: a value group wider than the
            // panel (disk cards carry "Active Time n%" + "Avg: n ms") used to
            // overflow onto the chart column instead of wrapping.
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13, fontFamily: 'monospace', color: '#fff', gap: 8 }}>
            <span
              data-testid={`metric-title-${id}`}
              title={title}
              style={{ fontWeight: 600, minWidth: 0, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >{title}</span>
            {/* Not a flex row: inline content reflows (wrapping at spaces) when
                the panel is narrow, so the value shrinks instead of overflowing
                the panel or pushing the title into an ellipsis. */}
            <div style={{ minWidth: 0, flexShrink: 1, textAlign: 'right' }}>{displayValue}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {typeof displayMinMax === 'string' ? (
              <span style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>{displayMinMax}</span>
            ) : (
              displayMinMax
            )}
          </div>
        </div>

        {/* Right panel — chart with left border and distinct background */}
        <div
          style={{
            flex: '1 1 45%',
            minWidth: 120,
            borderLeft: '1px solid #333',
            background: '#1a1a1a',
            padding: '4px 0',
          }}
        >
          {hasChart && (
            <div data-testid={`metric-chart-${id}`} {...chartMetadata} style={{ width: '100%', height: '100%' }}>
            <Suspense fallback={<ChartLoading height="100%" />}>
              <MetricChart
                data={data}
                yDomain={yDomain}
                color={color}
                secondaryColor={secondaryColor}
                hasSecondary={hasSecondary}
                showTimeAxis={false}
                label={resolvedChartLabel}
              />
            </Suspense>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Default and tile views share the same markup.
  // Tile width is controlled by the parent CSS grid (2-column), not the card itself.
  return (
    <div
      className="metric-card"
      data-testid={`metric-card-${id}`}
      style={{
        background: '#1e1e1e',
        borderRadius: 8,
        padding: '12px 16px',
        opacity: isDragging ? 0.5 : 1,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {dragHandle}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            marginBottom: hasChart ? 6 : 0,
            flex: 1,
          }}
        >
          <span
            data-testid={`metric-title-${id}`}
            style={{
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: 'monospace',
              ...borderStyle,
            }}
          >
            {title}
          </span>
          {value !== '' && (
            <span
              style={{
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'monospace',
                border: '1px solid #444',
                padding: '4px 8px',
                borderRadius: 4,
              }}
            >
              {value}
            </span>
          )}
          {badge && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                minWidth: 0,
              }}
            >
              {badge}
            </div>
          )}
        </div>
      </div>
      {hasChart && (
        <div data-testid={`metric-chart-${id}`} {...chartMetadata} style={{ width: '100%', height: 140 }}>
        <Suspense fallback={<ChartLoading height={140} />}>
          <MetricChart
            data={data}
            yDomain={yDomain}
            color={color}
            secondaryColor={secondaryColor}
            hasSecondary={hasSecondary}
            showTimeAxis
            label={resolvedChartLabel}
          />
        </Suspense>
        </div>
      )}
    </div>
  );
}
