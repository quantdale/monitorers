import { useState, useEffect } from 'react';
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
import { SortableCard } from './components/SortableCard';
import { TimeRangeSelector } from './components/TimeRangeSelector';
import { ViewModeSelector } from './components/ViewModeSelector';
import type { ViewMode } from './utils';

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
  const [windowSecs, setWindowSecs] = useState(60);
  const [viewMode, setViewMode] = useState<ViewMode>('default');
  const [cardOrder, setCardOrder] = useState<string[]>([]);

  const metrics = useMetrics(windowSecs);

  // Initialize and sync card order when metrics load. Disk/GPU keys are dynamic and may
  // arrive late (backend populates them after first refresh). Update cardOrder whenever
  // the default set of IDs changes so disks/GPUs that appear after initial load are shown.
  // Order resets to default on launch — no persistence.
  useEffect(() => {
    if (!metrics) return;
    const defaultIds = [
      'cpu',
      'memory',
      ...metrics.disks.map(d => `disk_${d.key}`),
      'network',
      ...metrics.gpus.map((_, i) => `gpu_${i}`),
    ];
    setCardOrder(prev => {
      const prevSet = new Set(prev);
      const hasNew = defaultIds.some(id => !prevSet.has(id));
      const hasRemoved = prev.some(id => !defaultIds.includes(id));
      if (!hasNew && !hasRemoved) return prev;
      return defaultIds;
    });
  }, [metrics]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setCardOrder(prev => {
        const oldIndex = prev.indexOf(active.id as string);
        const newIndex = prev.indexOf(over.id as string);
        return arrayMove(prev, oldIndex, newIndex);
      });
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
      return (
        <SortableCard
          key={id}
          id={id}
          title={`Disk ${disk.key} — Active Time`}
          value={formatPercent(disk.values.at(-1))}
          history={disk.values}
          color={DISK_COLORS[diskIdx % DISK_COLORS.length]}
          badge={
            <>
              <span style={badgeStyle}>
                R: {disk.read_mb_s.toFixed(1)} MB/s · W: {disk.write_mb_s.toFixed(1)} MB/s
              </span>
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
      const { min: minR, max: maxR } = (() => {
        const h = metrics.net_recv;
        if (h.length === 0) return { min: 0, max: 0 };
        const rawMin = Math.min(...h);
        const rawMax = Math.max(...h);
        return { min: Math.max(0, rawMin), max: Math.max(0, rawMax) };
      })();
      const { min: minS, max: maxS } = (() => {
        const h = metrics.net_sent;
        if (h.length === 0) return { min: 0, max: 0 };
        const rawMin = Math.min(...h);
        const rawMax = Math.max(...h);
        return { min: Math.max(0, rawMin), max: Math.max(0, rawMax) };
      })();
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
            <span style={badgeStyle}>
              ↓ {formatThroughput(recv)} · ↑ {formatThroughput(sent)}
            </span>
          }
          listViewValue={`↓ ${formatThroughput(recv)} · ↑ ${formatThroughput(sent)}`}
          listViewMinMax={`↓ ${formatThroughput(minR)}–${formatThroughput(maxR)}  ↑ ${formatThroughput(minS)}–${formatThroughput(maxS)}`}
          viewMode={viewMode}
        />
      );
    }

    if (id.startsWith('gpu_')) {
      const gpuIdx = parseInt(id.slice('gpu_'.length), 10);
      if (isNaN(gpuIdx) || gpuIdx >= metrics.gpus.length) return null;
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <TimeRangeSelector
          options={TIME_OPTIONS}
          value={windowSecs}
          onChange={setWindowSecs}
        />
        <ViewModeSelector value={viewMode} onChange={setViewMode} />
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
          <SortableContext items={cardOrder} strategy={strategy}>
            <div style={containerStyle}>
              {cardOrder.map(id => renderCard(id))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
