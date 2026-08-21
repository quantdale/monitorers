import { lazy, Suspense } from 'react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import type { ViewMode } from '../utils';
import { historyMinMax } from '../utils';
import { computeChartPoints } from '../chartPoints';
import type { MetricValue } from '../types/metrics';

const MAX_CHART_POINTS = 300;

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
  yDomain = [0, 100],
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
  const data = hasChart
    ? computeChartPoints({
        history: history!,
        timestamps,
        secondaryHistory: hasSecondary ? secondaryHistory : undefined,
        maxPoints: MAX_CHART_POINTS,
      })
    : [];
  const chartMetadata = {
    'data-chart-point-count': data.length,
    'data-chart-gap-count': data.filter((point) => point.v == null).length,
    'data-chart-start-ts': data[0]?.t ?? '',
    'data-chart-latest-ts': data[data.length - 1]?.t ?? '',
    'data-chart-span-ms': data.length > 1 ? data[data.length - 1].t - data[0].t : 0,
  };

  const borderStyle = { border: '1px solid #444', padding: '4px 8px', borderRadius: 4 };

  const dragHandle = (
    <button
      type="button"
      className="drag-handle"
      data-testid={`drag-handle-${id}`}
      {...(dragHandleProps?.attributes ?? {})}
      {...(dragHandleProps?.listeners ?? {})}
      aria-label="Drag to reorder"
      style={{ padding: '0 8px', display: 'flex', alignItems: 'center', fontSize: 16, color: '#666', userSelect: 'none', background: 'transparent', border: 0 }}
      title="Drag to reorder"
    >
      <span aria-hidden="true">⠿</span>
    </button>
  );

  if (viewMode === 'list') {
    const { min, max } = historyMinMax(history ?? []);
    const displayValue = listViewValue ?? value;
    const displayMinMax = listViewMinMax ?? `Min: ${min.toFixed(1)}%  Max: ${max.toFixed(1)}%`;

    return (
      <div
        className="metric-card"
        style={{
          background: '#1e1e1e',
          borderRadius: 8,
          height: 50,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'stretch',
          overflow: 'hidden',
          opacity: isDragging ? 0.5 : 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'center' }}>
          {dragHandle}
        </div>

        {/* Left panel (30%) — title + value on line 1, min/max on line 2 */}
        <div
          style={{
            width: '30%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 10px',
            gap: 2,
            minWidth: 0,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontFamily: 'monospace', color: '#fff', gap: 8 }}>
            <span
              data-testid={`metric-title-${id}`}
              style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >{title}</span>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{displayValue}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {typeof displayMinMax === 'string' ? (
              <span style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>{displayMinMax}</span>
            ) : (
              displayMinMax
            )}
          </div>
        </div>

        {/* Right panel (70%) — graph with left border and distinct background */}
        <div
          style={{
            width: '70%',
            borderLeft: '1px solid #333',
            background: '#1a1a1a',
            padding: '4px 0',
            minWidth: 0,
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
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                flexShrink: 0,
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
          />
        </Suspense>
        </div>
      )}
    </div>
  );
}
