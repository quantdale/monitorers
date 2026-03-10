import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import type { DraggableAttributes } from '@dnd-kit/core';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from 'recharts';
import type { ViewMode } from '../utils';
import { historyMinMax, downsample } from '../utils';

const MAX_CHART_POINTS = 300;

interface DragHandleProps {
  attributes: DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
}

interface Props {
  id: string;
  title: string;
  value: string;
  history?: number[];
  color: string;
  yDomain?: [number, number | 'auto'];
  badge?: React.ReactNode;
  viewMode: ViewMode;
  isDragging?: boolean;
  dragHandleProps?: DragHandleProps;
  /** Second series for dual-line charts (e.g. network upload/download). No fill, line only. */
  secondaryHistory?: number[];
  secondaryColor?: string;
  /** Custom list view value and min/max when default formatting doesn't apply (e.g. network KB/s). */
  listViewValue?: string | React.ReactNode;
  listViewMinMax?: string | React.ReactNode;
}

export function MetricCard({
  title,
  value,
  history,
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
  const primaryRaw = hasChart ? downsample(history!, MAX_CHART_POINTS) : [];
  const primary = primaryRaw.map((v) =>
    v == null || Number.isNaN(v) ? 0 : v
  );
  const secondaryRaw = hasSecondary ? downsample(secondaryHistory!, MAX_CHART_POINTS) : null;
  const secondary = secondaryRaw
    ? secondaryRaw.map((v) => (v == null || Number.isNaN(v) ? 0 : v))
    : null;
  const data = hasChart
    ? primary.map((v, i) => ({
        i,
        v: Math.max(0, v),
        v2: secondary !== null ? Math.max(0, secondary[i] ?? 0) : undefined,
      }))
    : [];

  const borderStyle = { border: '1px solid #444', padding: '4px 8px', borderRadius: 4 };

  const dragHandle = (
    <div
      className="drag-handle"
      {...(dragHandleProps?.attributes ?? {})}
      {...(dragHandleProps?.listeners ?? {})}
      style={{ padding: '0 8px', display: 'flex', alignItems: 'center', fontSize: 16, color: '#666', userSelect: 'none' }}
      title="Drag to reorder"
    >
      ⠿
    </div>
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
            <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
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
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 2, right: 4, bottom: 2, left: 0 }}>
                <YAxis domain={yDomain} hide />
                <XAxis dataKey="i" hide />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={color}
                  fill={color}
                  fillOpacity={hasSecondary ? 0 : 0.2}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                  dot={false}
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
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
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
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <YAxis domain={yDomain} hide />
            <XAxis dataKey="i" hide />
            <Area
              type="monotone"
              dataKey="v"
              stroke={color}
              fill={color}
              fillOpacity={hasSecondary ? 0 : 0.15}
              strokeWidth={1.5}
              isAnimationActive={false}
              dot={false}
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
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
