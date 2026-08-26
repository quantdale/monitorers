import { useMemo, useState } from 'react';
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
  verticalListSortingStrategy,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useMetrics } from './hooks/useMetrics';
import { useSettings, WINDOW_SECS_OPTIONS } from './hooks/useSettings';
import { TimeRangeSelector } from './components/TimeRangeSelector';
import { ViewModeSelector } from './components/ViewModeSelector';
import { MetricCardSelector } from './components/MetricCardSelector';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HardwareSidebar } from './components/HardwareSidebar';
import { useHardwareProfile } from './hooks/useHardwareProfile';
import { renderCardContent } from './cards/renderCardContent';
import { fallbackCardLabel } from './cards/formatters';
import {
  computeHasNvidiaData,
  computeVisibleCardOrder,
  hasMetricsButNoVisibleCards,
  isCardPresent,
  moveCardId,
  shouldShowLoadingState,
} from './cardIdentity';
import { useCardOrderInitialization } from './hooks/useCardOrderInitialization';
import { PanelLeft } from 'lucide-react';

// Labels for the legal history-window sizes (values come from WINDOW_SECS_OPTIONS
// in useSettings.ts, the single source of truth for what windowSecs is valid).
const TIME_OPTION_LABELS: Record<(typeof WINDOW_SECS_OPTIONS)[number], string> = {
  30: '30s',
  60: '1m',
  300: '5m',
  600: '10m',
  1800: '30m',
  3600: '1h',
};

const TIME_OPTIONS = WINDOW_SECS_OPTIONS.map((value) => ({
  value,
  label: TIME_OPTION_LABELS[value],
}));

export default function App() {
  const { settings, save, loaded, error: settingsError, saveError } = useSettings();
  const cardOrder = settings.cardOrder ?? [];
  const hiddenCardIds = useMemo(() => new Set(settings.hiddenCardIds), [settings.hiddenCardIds]);
  const viewMode = settings.viewMode;
  const windowSecs = settings.windowSecs;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const hardwareProfileState = useHardwareProfile();
  const { metrics, historyLoadError, lifecycle, retryMetrics } = useMetrics(windowSecs);
  const collectorState = lifecycle?.state ?? metrics?.collectorState ?? null;
  const [retryPending, setRetryPending] = useState(false);

  function handleRetryMetrics() {
    if (retryPending) return;
    setRetryPending(true);
    void retryMetrics().finally(() => setRetryPending(false));
  }
  useCardOrderInitialization(loaded, metrics, settings.cardOrder, save);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const hasNvidiaData = computeHasNvidiaData(metrics);
  // Memoized derived state: element identity changes only when metrics, view
  // mode, or visibility change, so unrelated re-renders (drag start/end,
  // sidebar toggle, selector open/close) reuse the exact card tree and React
  // skips every SortableCard/Recharts subtree.
  const visibleCardOrder = useMemo(
    () => computeVisibleCardOrder(cardOrder, hiddenCardIds, metrics),
    [cardOrder, hiddenCardIds, metrics],
  );
  const cards = useMemo(
    () =>
      visibleCardOrder.map((id) => (
        <ErrorBoundary key={id + '_boundary'}>
          {metrics ? renderCardContent({ id, metrics, viewMode, hasNvidiaData }) : null}
        </ErrorBoundary>
      )),
    [visibleCardOrder, metrics, viewMode, hasNvidiaData],
  );

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
          role="alert"
          aria-live="assertive"
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

  if (!loaded) {
    return <div role="status" aria-live="polite" style={{ background: '#141414', color: '#888', minHeight: '100vh', padding: 24 }}>Loading settings…</div>;
  }

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
      const gpuName = metrics.gpus.find(g => `gpu_${g.key}` === id)?.name;
      if (gpuName) return gpuName;
    }
    return fallbackCardLabel(id);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // moveCardId returns null when either id is missing from cardOrder (e.g.
    // the drop target's hardware vanished mid-drag): skip the write instead
    // of letting arrayMove's negative-index wrap-around silently corrupt the
    // persisted order.
    const next = moveCardId(cardOrder, active.id as string, over.id as string);
    if (next) save({ cardOrder: next });
  }

  const containerStyle =
    viewMode === 'tile'
      ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } as React.CSSProperties
      : { display: 'flex', flexDirection: 'column' as const, gap: 8 };

  const strategy = viewMode === 'tile' ? rectSortingStrategy : verticalListSortingStrategy;

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <HardwareSidebar open={sidebarOpen} profileState={hardwareProfileState} memTotalGb={metrics?.mem_total_gb ?? null} />
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
      {collectorState === 'recovering' && (
        <div
          data-testid="collector-recovering-banner"
          role="status"
          aria-live="polite"
          style={{
            background: 'rgba(243, 156, 18, 0.12)',
            border: '1px solid rgba(243, 156, 18, 0.7)',
            borderRadius: 4,
            color: '#ffeaa7',
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: 14,
          }}
        >
          Metrics collection interrupted. Recovering…
        </div>
      )}
      {(collectorState === 'failed' || metrics?.collectorError) && collectorState !== 'recovering' && (
        <div
          data-testid="collector-error-banner"
          role="alert"
          aria-live="assertive"
          style={{
            background: 'rgba(231, 76, 60, 0.15)',
            border: '1px solid rgba(231, 76, 60, 0.7)',
            borderRadius: 4,
            color: '#ffd6d3',
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: 14,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span>
            {metrics?.collectorError ??
              lifecycle?.reason ??
              'Metrics collection failed.'}
          </span>
          {collectorState === 'failed' && (
            <button
              type="button"
              data-testid="retry-metrics-button"
              onClick={handleRetryMetrics}
              disabled={retryPending}
              aria-label={retryPending ? 'Retrying metrics collection' : 'Retry metrics collection'}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                border: '1px solid rgba(231, 76, 60, 0.9)',
                background: '#1e1e1e',
                color: '#ffd6d3',
                cursor: retryPending ? 'wait' : 'pointer',
                fontWeight: 600,
              }}
            >
              Retry metrics
            </button>
          )}
        </div>
      )}
      {saveError && (
        <div
          data-testid="save-error-banner"
          role="alert"
          aria-live="polite"
          style={{
            background: 'rgba(243, 156, 18, 0.15)',
            border: '1px solid rgba(243, 156, 18, 0.7)',
            borderRadius: 4,
            color: '#ffeaa7',
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: 14,
          }}
        >
          Settings couldn't be saved — {saveError}. Changes are kept in memory for this session.
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
            aria-label={sidebarOpen ? 'Hide hardware info' : 'Show hardware info'}
            aria-expanded={sidebarOpen}
            aria-controls="hardware-sidebar"
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

      {historyLoadError && metrics && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            color: '#ffd6d3',
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: 14,
            background: 'rgba(231, 76, 60, 0.15)',
            border: '1px solid rgba(231, 76, 60, 0.7)',
            borderRadius: 4,
          }}
        >
          Couldn't refresh metrics history — {historyLoadError}. Showing previous data.
        </div>
      )}

      {historyLoadError && !metrics ? (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            color: '#ffd6d3',
            padding: '32px 0',
            textAlign: 'center',
            fontSize: 14,
          }}
        >
          Couldn't load metrics history — {historyLoadError}. Try restarting the app.
        </div>
      ) : hasMetricsButNoVisibleCards(metrics, visibleCardOrder) ? (
        <div
          style={{
            color: '#888',
            padding: '32px 0',
            textAlign: 'center',
            fontSize: 14,
          }}
        >
          All metrics hidden — use the Metrics selector to show cards
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={({ active }) => setDraggingCardId(String(active.id))}
          onDragCancel={() => setDraggingCardId(null)}
          onDragEnd={(event) => {
            handleDragEnd(event);
            setDraggingCardId(null);
          }}
        >
          <SortableContext items={visibleCardOrder} strategy={strategy}>
            <div
              data-testid="dashboard-card-list"
              data-card-order={visibleCardOrder.join('|')}
              data-dragging={draggingCardId !== null ? 'true' : 'false'}
              data-active-card-id={draggingCardId ?? ''}
              style={containerStyle}
            >
              {cards}
            </div>
          </SortableContext>
        </DndContext>
      )}
        </div>
      </div>
    </div>
  );
}
