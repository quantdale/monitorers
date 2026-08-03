import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useMetrics } from './hooks/useMetrics';
import { useSettings } from './hooks/useSettings';
import { TimeRangeSelector } from './components/TimeRangeSelector';
import { ViewModeSelector } from './components/ViewModeSelector';
import { MetricCardSelector } from './components/MetricCardSelector';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HardwareSidebar } from './components/HardwareSidebar';
import { useHardwareProfile } from './hooks/useHardwareProfile';
import { gpuId } from './utils';
import { renderCardContent } from './cards/renderCardContent';
import { fallbackCardLabel } from './cards/formatters';
import {
  computeDefaultCardIds,
  computeHasNvidiaData,
  computeVisibleCardOrder,
  isCardPresent,
  mergeNewCardIds,
  shouldShowLoadingState,
} from './cardIdentity';
import { PanelLeft } from 'lucide-react';

const TIME_OPTIONS = [
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
  { label: '10m', value: 600 },
  { label: '30m', value: 1800 },
  { label: '1h', value: 3600 },
];

export default function App() {
  const { settings, save, loaded, error: settingsError } = useSettings();
  const cardOrder = settings.cardOrder ?? [];
  const hiddenCardIds = useMemo(() => new Set(settings.hiddenCardIds), [settings.hiddenCardIds]);
  const viewMode = settings.viewMode;
  const windowSecs = settings.windowSecs;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hardwareProfile = useHardwareProfile();
  const { metrics, historyLoadError } = useMetrics(windowSecs);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // First launch: compute default card order. When saved order exists, merge in new disks/GPUs that appeared.
  useEffect(() => {
    if (!metrics) return;
    const defaultIds = computeDefaultCardIds(metrics);
    if (settings.cardOrder === null) {
      save({ cardOrder: defaultIds });
      return;
    }
    const merged = mergeNewCardIds(settings.cardOrder, defaultIds);
    if (merged === null) return;
    save({ cardOrder: merged });
  }, [metrics, settings.cardOrder, save]);

  if (settingsError) {
    return (
      <div
        style={{
          background: '#141414',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div
          style={{
            background: 'rgba(231, 76, 60, 0.15)',
            border: '1px solid rgba(231, 76, 60, 0.7)',
            borderRadius: 4,
            color: '#ffd6d3',
            padding: '12px 16px',
            fontSize: 14,
            maxWidth: 480,
            textAlign: 'center',
          }}
        >
          Couldn't load settings — {settingsError}. Try restarting the app.
        </div>
      </div>
    );
  }

  if (!loaded) return null;

  function handleMetricToggle(id: string, visible: boolean) {
    const next = new Set(hiddenCardIds);
    if (visible) next.delete(id);
    else next.add(id);
    save({ hiddenCardIds: [...next] });
  }

  function getCardLabel(id: string): string {
    if (!metrics) {
      return fallbackCardLabel(id);
    }
    if (id === 'cpu') return metrics.cpu_name || 'CPU';
    if (id === 'memory') return 'Memory';
    if (id === 'network') return 'Network';
    if (id.startsWith('disk_')) return `Disk ${id.slice('disk_'.length)}`;
    if (id.startsWith('gpu_')) {
      const gpuName = metrics.gpus.find(g => gpuId(g.name) === id)?.name;
      if (gpuName) return gpuName;
    }
    return fallbackCardLabel(id);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = cardOrder.indexOf(active.id as string);
      const newIndex = cardOrder.indexOf(over.id as string);
      save({ cardOrder: arrayMove(cardOrder, oldIndex, newIndex) });
    }
  }

  const hasNvidiaData = computeHasNvidiaData(metrics);

  const visibleCardOrder = computeVisibleCardOrder(cardOrder, hiddenCardIds, metrics);

  const containerStyle =
    viewMode === 'tile'
      ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } as React.CSSProperties
      : { display: 'flex', flexDirection: 'column' as const, gap: 8 };

  const strategy = viewMode === 'tile' ? rectSortingStrategy : verticalListSortingStrategy;

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <HardwareSidebar open={sidebarOpen} profile={hardwareProfile} metrics={metrics} />
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          minWidth: 0,
        }}
      >
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
      {metrics?.collectorError && (
        <div
          data-testid="collector-error-banner"
          style={{
            background: 'rgba(231, 76, 60, 0.15)',
            border: '1px solid rgba(231, 76, 60, 0.7)',
            borderRadius: 4,
            color: '#ffd6d3',
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {metrics.collectorError}
        </div>
      )}
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0' }}>
          System Monitor
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => setSidebarOpen((prev) => !prev)}
            title={sidebarOpen ? 'Hide hardware info' : 'Show hardware info'}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid #444',
              background: '#1e1e1e',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PanelLeft size={16} />
          </button>
          <TimeRangeSelector
            options={TIME_OPTIONS}
            value={windowSecs}
            onChange={(value) => save({ windowSecs: value })}
          />
          {metrics && cardOrder.length > 0 && (
            <MetricCardSelector
              items={cardOrder.filter(id => isCardPresent(id, metrics)).map(id => ({ id, label: getCardLabel(id) }))}
              hiddenIds={hiddenCardIds}
              onToggle={handleMetricToggle}
            />
          )}
        </div>
        <ViewModeSelector value={viewMode} onChange={(mode) => save({ viewMode: mode })} />
      </div>

      {historyLoadError && !metrics ? (
        <div
          style={{
            color: '#ffd6d3',
            padding: '32px 0',
            textAlign: 'center',
            fontSize: 14,
          }}
        >
          Couldn't load metrics history — {historyLoadError}. Try restarting the app.
        </div>
      ) : shouldShowLoadingState(metrics, visibleCardOrder) ? (
        <div
          style={{
            color: '#888',
            padding: '32px 0',
            textAlign: 'center',
            fontSize: 14,
          }}
        >
          Collecting metrics…
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleCardOrder} strategy={strategy}>
            <div style={containerStyle}>
              {visibleCardOrder.map(id => (
                <ErrorBoundary key={id + '_boundary'}>
                  {metrics ? renderCardContent({ id, metrics, viewMode, hasNvidiaData }) : null}
                </ErrorBoundary>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
        </div>
      </div>
    </div>
  );
}
