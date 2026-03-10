import { useEffect, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { useMetrics } from './hooks/useMetrics';
import { useSettings } from './hooks/useSettings';
import { SortableCard } from './components/SortableCard';
import { TimeRangeSelector } from './components/TimeRangeSelector';
import { ViewModeSelector } from './components/ViewModeSelector';
import { MetricCardSelector } from './components/MetricCardSelector';
import { ErrorBoundary } from './components/ErrorBoundary';
import { gpuId, historyMinMax } from './utils';

const TIME_OPTIONS = [
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
  { label: '10m', value: 600 },
  { label: '30m', value: 1800 },
  { label: '1h', value: 3600 },
];

const DISK_COLORS = ['#e88246', '#c46be8', '#e8d446', '#46e8d4'];
const GPU_COLORS = ['#64b4ff', '#78c888', '#e8a050', '#c080e0'];

function formatThroughput(kb: number): string {
  if (kb >= 1000 * 1000) return `${(kb / 1e6).toFixed(1)} GB/s`;
  if (kb >= 1000) return `${(kb / 1000).toFixed(1)} MB/s`;
  return `${kb.toFixed(0)} KB/s`;
}

function formatPercent(v: number | undefined): string {
  const x = Math.max(0, v ?? 0);
  return `${x.toFixed(1)}%`;
}

function formatTempC(temp: number | null | undefined): string {
  if (temp == null || Number.isNaN(temp)) return '— °C';
  return `${Math.round(temp)} °C`;
}

function formatResponseMs(ms: number): string {
  if (!ms || ms <= 0 || !isFinite(ms)) return 'Avg: —';
  if (ms < 10) return `Avg: ${ms.toFixed(1)} ms`;
  return `Avg: ${Math.round(ms)} ms`;
}

const badgeStyle: React.CSSProperties = {
  border: '1px solid #444',
  padding: '4px 8px',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'monospace',
  color: '#fff',
  fontWeight: 600,
};

export default function App() {
  const { settings, save, loaded } = useSettings();
  const cardOrder = settings.cardOrder ?? [];
  const hiddenCardIds = useMemo(() => new Set(settings.hiddenCardIds), [settings.hiddenCardIds]);
  const viewMode = settings.viewMode;
  const windowSecs = settings.windowSecs;

  const metrics = useMetrics(windowSecs);

  // First launch: compute default card order. When saved order exists, merge in new disks/GPUs that appeared.
  useEffect(() => {
    if (!metrics) return;
    const defaultIds = [
      'cpu',
      'memory',
      ...metrics.disks.map((d) => `disk_${d.key}`),
      'network',
      ...metrics.gpus.map((g) => gpuId(g.name)),
    ];
    const current = settings.cardOrder ?? [];
    if (settings.cardOrder === null) {
      save({ cardOrder: defaultIds });
      return;
    }
    const currentSet = new Set(current);
    const hasNew = defaultIds.some((id) => !currentSet.has(id));
    if (!hasNew) return;
    const merged = [...current];
    for (const id of defaultIds) {
      if (!currentSet.has(id)) {
        merged.push(id);
        currentSet.add(id);
      }
    }
    save({ cardOrder: merged });
  }, [metrics, settings.cardOrder, save]);

  if (!loaded) return null;

  function handleMetricToggle(id: string, visible: boolean) {
    const next = new Set(hiddenCardIds);
    if (visible) next.delete(id);
    else next.add(id);
    save({ hiddenCardIds: [...next] });
  }

  function getCardLabel(id: string): string {
    if (!metrics) return id;
    if (id === 'cpu') return metrics.cpu_name || 'CPU';
    if (id === 'memory') return 'Memory';
    if (id === 'network') return 'Network';
    if (id.startsWith('disk_')) return `Disk ${id.slice('disk_'.length)}`;
    if (id.startsWith('gpu_')) {
      return metrics.gpus.find(g => gpuId(g.name) === id)?.name ?? id;
    }
    return id;
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = cardOrder.indexOf(active.id as string);
      const newIndex = cardOrder.indexOf(over.id as string);
      save({ cardOrder: arrayMove(cardOrder, oldIndex, newIndex) });
    }
  }

  // Maps a card ID back to the correct SortableCard with its props.
  function renderCard(id: string) {
    if (!metrics) return null;

    if (id === 'cpu') {
      return (
        <SortableCard
          key={id}
          id={id}
          title={metrics.cpu_name || 'CPU'}
          value={formatPercent(metrics.cpu.at(-1))}
          history={metrics.cpu}
          color="#4699e8"
          badge={<span style={badgeStyle}>{formatTempC(metrics.cpu_temp_c)}</span>}
          viewMode={viewMode}
        />
      );
    }

    if (id === 'memory') {
      return (
        <SortableCard
          key={id}
          id={id}
          title="Memory"
          value={formatPercent(metrics.mem.at(-1))}
          history={metrics.mem}
          color="#4ed87a"
          badge={
            <span style={badgeStyle}>
              {`${metrics.mem_used_gb.toFixed(1)} / ${metrics.mem_total_gb.toFixed(1)} GB`}
            </span>
          }
          viewMode={viewMode}
        />
      );
    }

    if (id.startsWith('disk_')) {
      const diskKey = id.slice('disk_'.length);
      const diskIdx = metrics.disks.findIndex(d => d.key === diskKey);
      if (diskIdx === -1) return null;
      const disk = metrics.disks[diskIdx];
      const avgStr = formatResponseMs(disk.avg_response_ms);
      return (
        <SortableCard
          key={id}
          id={id}
          title={`Disk ${disk.key}`}
          value={`Active Time ${formatPercent(disk.values.at(-1))}`}
          history={disk.values}
          color={DISK_COLORS[diskIdx % DISK_COLORS.length]}
          listViewValue={
            <>
              <span>Active Time {formatPercent(disk.values.at(-1))}</span>
              <span style={{ color: '#888', marginLeft: 4 }}>{avgStr}</span>
            </>
          }
          badge={
            <>
              <span style={badgeStyle}>
                R: {disk.read_mb_s.toFixed(1)} MB/s · W: {disk.write_mb_s.toFixed(1)} MB/s
              </span>
              <span style={badgeStyle}>{formatResponseMs(disk.avg_response_ms)}</span>
              <span style={badgeStyle}>{formatTempC(disk.temp_c)}</span>
            </>
          }
          viewMode={viewMode}
        />
      );
    }

    if (id === 'network') {
      const recv = metrics.net_recv.at(-1) ?? 0;
      const sent = metrics.net_sent.at(-1) ?? 0;
      const { min: rawMinR, max: rawMaxR } = historyMinMax(metrics.net_recv);
      const minR = Math.max(0, rawMinR);
      const maxR = Math.max(0, rawMaxR);
      const { min: rawMinS, max: rawMaxS } = historyMinMax(metrics.net_sent);
      const minS = Math.max(0, rawMinS);
      const maxS = Math.max(0, rawMaxS);
      return (
        <SortableCard
          key={id}
          id={id}
          title="Network"
          value=""
          history={metrics.net_recv}
          secondaryHistory={metrics.net_sent}
          color="#50d8f0"
          secondaryColor="#e88a50"
          yDomain={[0, 'auto']}
          badge={
            <>
              <span style={{ ...badgeStyle, border: '1px solid rgba(80, 216, 240, 0.55)' }}>↓ {formatThroughput(recv)}</span>
              <span style={{ ...badgeStyle, border: '1px solid rgba(232, 138, 80, 0.55)' }}>↑ {formatThroughput(sent)}</span>
            </>
          }
          listViewValue={
            <>
              <span style={{ border: '1px solid rgba(80, 216, 240, 0.55)', padding: '2px 6px', borderRadius: 4, fontSize: 13, fontFamily: 'monospace', color: '#fff', fontWeight: 600 }}>↓ {formatThroughput(recv)}</span>
              <span style={{ border: '1px solid rgba(232, 138, 80, 0.55)', padding: '2px 6px', borderRadius: 4, fontSize: 13, fontFamily: 'monospace', color: '#fff', fontWeight: 600 }}>↑ {formatThroughput(sent)}</span>
            </>
          }
          listViewMinMax={
            <>
              <span style={{ border: '1px solid rgba(80, 216, 240, 0.55)', padding: '2px 6px', borderRadius: 4, fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
                ↓ {formatThroughput(minR)} – {formatThroughput(maxR)}
              </span>
              <span style={{ border: '1px solid rgba(232, 138, 80, 0.55)', padding: '2px 6px', borderRadius: 4, fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
                ↑ {formatThroughput(minS)} – {formatThroughput(maxS)}
              </span>
            </>
          }
          viewMode={viewMode}
        />
      );
    }

    if (id.startsWith('gpu_')) {
      const gpuIdx = metrics.gpus.findIndex(g => gpuId(g.name) === id);
      if (gpuIdx === -1) return null;
      const gpu = metrics.gpus[gpuIdx];
      return (
        <SortableCard
          key={id}
          id={id}
          title={gpu.name}
          value={formatPercent(gpu.values.at(-1))}
          history={gpu.values}
          color={GPU_COLORS[gpuIdx % GPU_COLORS.length]}
          badge={<span style={badgeStyle}>{formatTempC(gpu.temp_c)}</span>}
          viewMode={viewMode}
        />
      );
    }

    return null;
  }

  const visibleCardOrder = cardOrder.filter(id => !hiddenCardIds.has(id));

  const containerStyle =
    viewMode === 'tile'
      ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } as React.CSSProperties
      : { display: 'flex', flexDirection: 'column' as const, gap: 8 };

  const strategy = viewMode === 'tile' ? rectSortingStrategy : verticalListSortingStrategy;

  return (
    <div
      style={{
        background: '#141414',
        minHeight: '100vh',
        padding: '12px 16px',
        overflowY: 'auto',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: '#fff',
      }}
    >
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0' }}>
          System Monitor
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TimeRangeSelector
            options={TIME_OPTIONS}
            value={windowSecs}
            onChange={(value) => save({ windowSecs: value })}
          />
          {metrics && cardOrder.length > 0 && (
            <MetricCardSelector
              items={cardOrder.map(id => ({ id, label: getCardLabel(id) }))}
              hiddenIds={hiddenCardIds}
              onToggle={handleMetricToggle}
            />
          )}
        </div>
        <ViewModeSelector value={viewMode} onChange={(mode) => save({ viewMode: mode })} />
      </div>

      {!metrics || cardOrder.length === 0 ? (
        <div
          style={{
            color: '#666',
            padding: '32px 0',
            textAlign: 'center',
            fontSize: 14,
          }}
        >
          Collecting metrics…
        </div>
      ) : (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleCardOrder} strategy={strategy}>
            <div style={containerStyle}>
              {visibleCardOrder.map(id => (
                <ErrorBoundary key={id + '_boundary'}>
                  {renderCard(id)}
                </ErrorBoundary>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
