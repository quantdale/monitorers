import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useMediaQuery } from './hooks/useMediaQuery';
import { SIDEBAR_OVERLAY_MEDIA } from './sidebarLayout';
import { PanelLeft } from 'lucide-react';
import {
  accent,
  border,
  controlShell,
  danger,
  dangerBorder,
  dangerText,
  dangerTint,
  fontSans,
  ok,
  okBorder,
  okText,
  okTint,
  pageBg,
  radius,
  surfaceSunken,
  textMuted,
  textPrimary,
  textSecondary,
  type,
  warn,
  warnBorder,
  warnText,
  warnTint,
} from './design/tokens';

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

// Stable identity for "no saved order yet": `settings.cardOrder ?? []` built a
// fresh array every render while the value was null, which changed the
// visibleCardOrder memo's dependency every render and rebuilt the whole card
// (Recharts) tree on every scalar tick — exactly the churn that memo exists to
// prevent. Module-level so the fallback has one identity forever.
const EMPTY_CARD_ORDER: string[] = [];

// Collector-state → status pill presentation (the glance-layer counterpart to
// the banners below; the banners keep their testids and live-region semantics).
const STATUS_DOT: Record<string, string> = {
  starting: accent,
  healthy: ok,
  recovering: warn,
  failed: danger,
  stopping: textMuted,
};
const STATUS_TEXT: Record<string, string> = {
  starting: textSecondary,
  healthy: okText,
  recovering: warnText,
  failed: dangerText,
  stopping: textMuted,
};
const STATUS_TINT: Record<string, string> = {
  starting: surfaceSunken,
  healthy: okTint,
  recovering: warnTint,
  failed: dangerTint,
  stopping: surfaceSunken,
};
const STATUS_BORDER: Record<string, string> = {
  starting: border,
  healthy: okBorder,
  recovering: warnBorder,
  failed: dangerBorder,
  stopping: border,
};
const STATUS_LABEL: Record<string, string> = {
  starting: 'Starting',
  healthy: 'Healthy',
  recovering: 'Recovering',
  failed: 'Failed',
  stopping: 'Stopping',
};

export default function App() {
  const { settings, save, loaded, error: settingsError, saveError } = useSettings();
  const cardOrder = settings.cardOrder ?? EMPTY_CARD_ORDER;
  const hiddenCardIds = useMemo(() => new Set(settings.hiddenCardIds), [settings.hiddenCardIds]);
  const viewMode = settings.viewMode;
  const windowSecs = settings.windowSecs;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarOverlay = useMediaQuery(SIDEBAR_OVERLAY_MEDIA);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const restoreSidebarFocus = useRef(false);

  const closeSidebar = useCallback(() => {
    restoreSidebarFocus.current = true;
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (!sidebarOpen && restoreSidebarFocus.current) {
      restoreSidebarFocus.current = false;
      sidebarToggleRef.current?.focus();
    }
  }, [sidebarOpen]);

  // Crossing back to the push rail unmounts the drawer's Close button. Put
  // focus on the toggle, which is visible again beside the in-flow rail.
  const overlayWhileOpen = useRef(false);
  useEffect(() => {
    if (sidebarOpen && sidebarOverlay) overlayWhileOpen.current = true;
    if (sidebarOpen && !sidebarOverlay && overlayWhileOpen.current) {
      overlayWhileOpen.current = false;
      sidebarToggleRef.current?.focus();
    }
    if (!sidebarOpen) overlayWhileOpen.current = false;
  }, [sidebarOpen, sidebarOverlay]);

  // Drawer dismissal. Deferred so a keyboard-drag Escape (dnd-kit preventDefault
  // on the same document keydown, registered after this listener) cancels the
  // drag instead of also closing the panel.
  useEffect(() => {
    if (!sidebarOverlay || !sidebarOpen) return;
    let cancelled = false;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      window.setTimeout(() => {
        if (cancelled || event.defaultPrevented) return;
        restoreSidebarFocus.current = true;
        setSidebarOpen(false);
      }, 0);
    }
    document.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      document.removeEventListener('keydown', onKey);
    };
  }, [sidebarOverlay, sidebarOpen]);
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
          background: pageBg,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fontSans,
        }}
      >
        <div
          role="alert"
          aria-live="assertive"
          style={{
            background: dangerTint,
            border: dangerBorder,
            borderRadius: radius.card,
            color: dangerText,
            padding: '14px 18px',
            fontSize: type.body,
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
    return (
      <div
        role="status"
        aria-live="polite"
        style={{ background: pageBg, color: textMuted, minHeight: '100vh', padding: 24, fontFamily: fontSans }}
      >
        Loading settings…
      </div>
    );
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
      ? // auto-fit + minmax keeps the two Tile tracks EQUAL: a bare `1fr 1fr`
        // resolves to minmax(auto, 1fr), so one card's min-content width widened
        // its own track (measured 406px/180px inside a 358px container at the
        // product's 400px minimum window). Below the track minimum the grid
        // collapses to a single column instead of overflowing.
        { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 } as React.CSSProperties
      : { display: 'flex', flexDirection: 'column' as const, gap: 12 };

  const strategy = viewMode === 'tile' ? rectSortingStrategy : verticalListSortingStrategy;

  return (
    <div style={{ display: 'flex', height: '100vh', background: pageBg, fontFamily: fontSans }}>
      <HardwareSidebar
        open={sidebarOpen}
        overlay={sidebarOverlay}
        onClose={closeSidebar}
        profileState={hardwareProfileState}
        memTotalGb={metrics?.mem_total_gb ?? null}
      />
      {sidebarOverlay && sidebarOpen && (
        <button
          type="button"
          data-testid="hardware-sidebar-scrim"
          aria-label="Dismiss hardware info"
          onClick={closeSidebar}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 30,
            border: 0,
            padding: 0,
            background: 'rgba(10, 12, 16, 0.55)',
          }}
        />
      )}
      {/* Scroll container: a header landmark, then the main landmark that holds
          the dashboard. A <header> nested inside <main> maps to no landmark, so
          the two must be siblings here. Inert while the narrow-window drawer is
          open so keyboard focus stays in the dialog instead of the covered page. */}
      <div
        inert={sidebarOverlay && sidebarOpen ? true : undefined}
        style={{
          flex: 1,
          overflow: 'auto',
          minWidth: 0,
        }}
      >
        <div
          style={{
            background: pageBg,
            minHeight: '100vh',
            padding: '16px 20px',
            overflowY: 'auto',
            color: textPrimary,
          }}
        >
      {collectorState === 'recovering' && (
        <div
          data-testid="collector-recovering-banner"
          role="status"
          aria-live="polite"
          style={{
            background: warnTint,
            border: warnBorder,
            borderRadius: radius.control,
            color: warnText,
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: type.body,
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
            background: dangerTint,
            border: dangerBorder,
            borderRadius: radius.control,
            color: dangerText,
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: type.body,
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
                padding: '5px 12px',
                borderRadius: radius.control,
                border: dangerBorder,
                background: dangerTint,
                color: dangerText,
                cursor: retryPending ? 'wait' : 'pointer',
                fontWeight: 600,
                fontSize: type.label,
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
            background: warnTint,
            border: warnBorder,
            borderRadius: radius.control,
            color: warnText,
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: type.body,
          }}
        >
          Settings couldn't be saved — {saveError}. Changes are kept in memory for this session.
        </div>
      )}
      <header>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: type.pageTitle, fontWeight: 650, color: textPrimary, margin: 0, letterSpacing: '-0.01em' }}>
          System Monitor
        </h1>
        {collectorState && (
          <span
            data-testid="collector-status-pill"
            title={`Metrics collection is ${STATUS_LABEL[collectorState] ?? collectorState}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 10px',
              borderRadius: radius.pill,
              border: STATUS_BORDER[collectorState] ?? border,
              background: STATUS_TINT[collectorState] ?? surfaceSunken,
              fontSize: type.micro,
              fontWeight: 600,
              color: STATUS_TEXT[collectorState] ?? textMuted,
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: 6, height: 6, borderRadius: 3, background: STATUS_DOT[collectorState] ?? textMuted }}
            />
            {STATUS_LABEL[collectorState] ?? collectorState}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            ref={sidebarToggleRef}
            onClick={() => setSidebarOpen((prev) => !prev)}
            title={sidebarOpen ? 'Hide hardware info' : 'Show hardware info'}
            aria-label={sidebarOpen ? 'Hide hardware info' : 'Show hardware info'}
            aria-expanded={sidebarOpen}
            aria-controls="hardware-sidebar"
            style={{
              ...controlShell,
              padding: '6px 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: sidebarOpen ? accent : textSecondary,
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
      </header>

      <main
        style={{
          flex: 1,
          minWidth: 0,
        }}
      >
      {historyLoadError && metrics && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            color: dangerText,
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: type.body,
            background: dangerTint,
            border: dangerBorder,
            borderRadius: radius.control,
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
            color: dangerText,
            padding: '32px 0',
            textAlign: 'center',
            fontSize: type.body,
          }}
        >
          Couldn't load metrics history — {historyLoadError}. Try restarting the app.
        </div>
      ) : hasMetricsButNoVisibleCards(metrics, visibleCardOrder) ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            color: textMuted,
            padding: '32px 0',
            textAlign: 'center',
            fontSize: type.body,
          }}
        >
          All metrics hidden — use the Metrics selector to show cards
        </div>
      ) : shouldShowLoadingState(metrics, visibleCardOrder) ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            color: textMuted,
            padding: '32px 0',
            textAlign: 'center',
            fontSize: type.body,
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
      </main>
        </div>
      </div>
    </div>
  );
}
