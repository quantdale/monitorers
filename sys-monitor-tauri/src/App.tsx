import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  rectSortingStrategy,
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
import { useCardSensors } from './hooks/useCardSensors';
import { cardDropTarget } from './cardDropTarget';
import { useMediaQuery } from './hooks/useMediaQuery';
import { SIDEBAR_OVERLAY_MEDIA } from './sidebarLayout';
import { PanelLeft, Activity, EyeOff, RotateCcw } from 'lucide-react';
import {
  accent,
  border,
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
  surface,
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
import { Button } from './components/Controls';
import {
  staggerDelay,
  fadeSwap,
  riseItem,
  springPop,
  staggerParent,
  tapScale,
} from './design/motion';

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

/** States where a heartbeat animation is meaningful ("still alive"). */
function isLive(state: string | null): boolean {
  return state === 'healthy' || state === 'starting';
}

/**
 * The "all metrics hidden" empty state. Deliberately not a bare sentence: the
 * dimmed ghost cards behind it show what is missing, and the primary action is
 * the only lime surface on the screen — which is exactly what we want the eye
 * to land on.
 */
function EmptyDashboard({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <motion.div
      variants={fadeSwap}
      initial="hidden"
      animate="visible"
      exit="exit"
      role="status"
      aria-live="polite"
      style={{
        position: 'relative',
        padding: '48px 24px 40px',
        textAlign: 'center',
        maxWidth: 460,
        margin: '32px auto',
        overflow: 'hidden',
      }}
    >
      {/* Ghost cards: three dimmed outlines suggesting the dashboard that is
          waiting to come back. Purely decorative. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          justifyContent: 'center',
          opacity: 0.28,
          pointerEvents: 'none',
        }}
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            variants={riseItem}
            initial="hidden"
            animate="visible"
            transition={{ delay: staggerDelay(i, 0.06) }}
            style={{
              height: 46,
              margin: '0 auto',
              width: `${88 - i * 14}%`,
              border: '1px dashed rgba(255, 255, 255, 0.14)',
              borderRadius: radius.card,
            }}
          />
        ))}
      </div>

      <motion.div
        variants={riseItem}
        initial="hidden"
        animate="visible"
        transition={{ delay: 0.1 }}
        style={{ position: 'relative' }}
      >
        <motion.div
          whileHover={{ y: -2 }}
          transition={springPop}
          style={{
            width: 52,
            height: 52,
            margin: '0 auto 14px',
            borderRadius: radius.card,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(200, 247, 81, 0.12)',
            border: `1px solid ${accent}`,
          }}
        >
          <EyeOff size={24} aria-hidden="true" color={accent} />
        </motion.div>
        <div
          style={{
            color: textPrimary,
            fontSize: 17,
            fontWeight: 700,
            marginBottom: 16,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </div>
        <Button variant="primary" data-testid="empty-metrics-action" onClick={onAction}>
          {actionLabel}
        </Button>
      </motion.div>
    </motion.div>
  );
}

/** Skeleton card shown while the first real sample lands. */
function SkeletonCard({ delay, height }: { delay: number; height: number }) {
  return (
    <motion.div
      variants={riseItem}
      initial="hidden"
      animate="visible"
      transition={{ delay }}
      style={{
        background: surface,
        border: '1px solid rgba(255, 255, 255, 0.07)',
        borderRadius: radius.card,
        height,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div className="skeleton" style={{ height: 11, width: '38%', borderRadius: radius.pill }} />
      <div className="skeleton" style={{ height: 28, width: '58%', borderRadius: radius.pill }} />
      <div className="skeleton" style={{ flex: 1, borderRadius: radius.control }} />
    </motion.div>
  );
}

export default function App() {
  const { settings, save, loaded, error: settingsError, saveError } = useSettings();
  const cardOrder = settings.cardOrder ?? EMPTY_CARD_ORDER;
  const hiddenCardIds = useMemo(() => new Set(settings.hiddenCardIds), [settings.hiddenCardIds]);
  const viewMode = settings.viewMode;
  const windowSecs = settings.windowSecs;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarOverlay = useMediaQuery(SIDEBAR_OVERLAY_MEDIA);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const metricsTriggerRef = useRef<HTMLButtonElement>(null);
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
  const sensors = useCardSensors();

  const hasNvidiaData = computeHasNvidiaData(metrics);
  const diskNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const disk of hardwareProfileState.profile?.disks ?? []) {
      if (disk.name) names.set(disk.key, disk.name);
    }
    return names;
  }, [hardwareProfileState.profile]);
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
      visibleCardOrder.map((id, index) => (
        <ErrorBoundary key={id + '_boundary'}>
          {metrics
            ? renderCardContent({ id, metrics, viewMode, hasNvidiaData, diskNames, index })
            : null}
        </ErrorBoundary>
      )),
    [visibleCardOrder, metrics, viewMode, hasNvidiaData, diskNames],
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
        <motion.div
          variants={riseItem}
          initial="hidden"
          animate="visible"
          role="alert"
          aria-live="assertive"
          style={{
            background: dangerTint,
            border: dangerBorder,
            borderRadius: radius.card,
            color: dangerText,
            padding: '18px 22px',
            fontSize: type.body,
            maxWidth: 480,
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          Couldn't load settings — {settingsError}. Try restarting the app.
        </motion.div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <motion.div
        variants={fadeSwap}
        initial="hidden"
        animate="visible"
        role="status"
        aria-live="polite"
        style={{ background: pageBg, color: textMuted, minHeight: '100vh', padding: 24, fontFamily: fontSans }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 20,
          }}
        >
          <motion.span
            className="playful-spin"
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              border: `2px solid ${accent}`,
              borderTopColor: 'transparent',
              display: 'inline-block',
            }}
            aria-hidden="true"
          />
          <span style={{ fontSize: type.body }}>Loading settings…</span>
        </div>
      </motion.div>
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
    const { active } = event;
    const target = cardDropTarget(event);
    if (target == null || active.id === target || !visibleCardOrder.includes(String(target))) return;
    // moveCardId returns null when either id is missing from cardOrder (e.g.
    // the drop target's hardware vanished mid-drag): skip the write instead
    // of letting arrayMove's negative-index wrap-around silently corrupt the
    // persisted order.
    const next = moveCardId(cardOrder, String(active.id), String(target));
    if (next) save({ cardOrder: next });
  }

  const containerStyle =
    viewMode === 'tile'
      ? // auto-fit + minmax keeps the two Tile tracks EQUAL: a bare `1fr 1fr`
        // resolves to minmax(auto, 1fr), so one card's min-content width widened
        // its own track (measured 406px/180px inside a 358px container at the
        // product's 400px minimum window). Below the track minimum the grid
        // collapses to a single column instead of overflowing.
        { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 14 } as React.CSSProperties
      : { display: 'flex', flexDirection: 'column' as const, gap: 14 };

  const strategy = viewMode === 'tile' ? rectSortingStrategy : verticalListSortingStrategy;

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: fontSans, position: 'relative', zIndex: 1 }}>
      <HardwareSidebar
        open={sidebarOpen}
        overlay={sidebarOverlay}
        onClose={closeSidebar}
        profileState={hardwareProfileState}
        memTotalGb={metrics?.mem_total_gb ?? null}
      />
      {sidebarOverlay && sidebarOpen && (
        <motion.button
          type="button"
          data-testid="hardware-sidebar-scrim"
          aria-hidden="true"
          tabIndex={-1}
          onClick={closeSidebar}
          variants={fadeSwap}
          initial="hidden"
          animate="visible"
          exit="exit"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 30,
            border: 0,
            padding: 0,
            background: 'rgba(6, 8, 11, 0.62)',
            backdropFilter: 'blur(3px)',
            WebkitBackdropFilter: 'blur(3px)',
          }}
        />
      )}
      {/* Scroll container: a header landmark, then the main landmark that holds
          the dashboard. A <header> nested inside <main> maps to no landmark, so
          the two must be siblings here. Inert while the narrow-window drawer is
          open so keyboard focus stays in the dialog instead of the covered page. */}
      <div
        data-testid="dashboard-scroll-area"
        inert={sidebarOverlay && sidebarOpen ? true : undefined}
        style={{
          flex: 1,
          overflow: 'auto',
          minWidth: 0,
        }}
      >
        <div
          style={{
            minHeight: '100vh',
            padding: '0 20px 24px',
            color: textPrimary,
          }}
        >
      <header
        style={{
          // Sticky toolbar in frosted glass: the controls stay reachable no
          // matter how far the dashboard is scrolled.
          position: 'sticky',
          top: 0,
          zIndex: 20,
          margin: '0 -20px 16px',
          padding: '14px 20px',
          background: 'rgba(8, 9, 12, 0.82)',
          backdropFilter: 'blur(16px) saturate(150%)',
          WebkitBackdropFilter: 'blur(16px) saturate(150%)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
        }}
      >
      {/* ── Row 1: identity + live status ─────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <Activity size={19} aria-hidden="true" color={accent} style={{ flexShrink: 0 }} />
        <h1 style={{ fontSize: type.pageTitle, fontWeight: 700, color: textPrimary, margin: 0, letterSpacing: '-0.025em' }}>
          System Monitor
        </h1>
        {collectorState && (
          <motion.span
            data-testid="collector-status-pill"
            title={`Metrics collection is ${STATUS_LABEL[collectorState] ?? collectorState}`}
            variants={riseItem}
            initial="hidden"
            animate="visible"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '3px 11px',
              borderRadius: radius.pill,
              border: STATUS_BORDER[collectorState] ?? border,
              background: STATUS_TINT[collectorState] ?? surfaceSunken,
              fontSize: type.micro,
              fontWeight: 700,
              color: STATUS_TEXT[collectorState] ?? textMuted,
            }}
          >
            {/* Heartbeat only while the collector is actually streaming — a
                pulsing dot on a failed collector would lie. */}
            <span style={{ position: 'relative', display: 'inline-flex', width: 7, height: 7, flexShrink: 0 }}>
              {isLive(collectorState) && (
                <span
                  aria-hidden="true"
                  className="live-halo"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    background: STATUS_DOT[collectorState] ?? textMuted,
                  }}
                />
              )}
              <span
                aria-hidden="true"
                className={isLive(collectorState) ? 'live-pulse' : undefined}
                style={{
                  position: 'relative',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: STATUS_DOT[collectorState] ?? textMuted,
                }}
              />
            </span>
            {STATUS_LABEL[collectorState] ?? collectorState}
          </motion.span>
        )}
      </div>

      {/* ── Row 2: the toolbar ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <motion.div
          variants={staggerParent(0.04)}
          initial="hidden"
          animate="visible"
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
        >
          <motion.div variants={riseItem}>
            <Button
              ref={sidebarToggleRef}
              onClick={() => setSidebarOpen((prev) => !prev)}
              title={sidebarOpen ? 'Hide hardware info' : 'Show hardware info'}
              aria-label={sidebarOpen ? 'Hide hardware info' : 'Show hardware info'}
              aria-expanded={sidebarOpen}
              aria-controls="hardware-sidebar"
              variant={sidebarOpen ? 'primary' : 'default'}
            >
              <PanelLeft size={15} aria-hidden="true" />
              <span>Hardware</span>
            </Button>
          </motion.div>
          <motion.div variants={riseItem}>
            <TimeRangeSelector
              options={TIME_OPTIONS}
              value={windowSecs}
              onChange={(value) => save({ windowSecs: value })}
            />
          </motion.div>
          {metrics && cardOrder.length > 0 && (
            <motion.div variants={riseItem}>
              <MetricCardSelector
                triggerRef={metricsTriggerRef}
                items={cardOrder.filter(id => isCardPresent(id, metrics)).map(id => ({ id, label: getCardLabel(id) }))}
                hiddenIds={hiddenCardIds}
                onToggle={handleMetricToggle}
              />
            </motion.div>
          )}
        </motion.div>
        <motion.div variants={riseItem} initial="hidden" animate="visible">
          <ViewModeSelector value={viewMode} onChange={(mode) => save({ viewMode: mode })} />
        </motion.div>
      </div>
      </header>

      {/* ── Banners ───────────────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {collectorState === 'recovering' && (
          <motion.div
            key="recovering"
            data-testid="collector-recovering-banner"
            role="status"
            aria-live="polite"
            variants={riseItem}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{
              background: warnTint,
              border: warnBorder,
              borderRadius: radius.control,
              color: warnText,
              padding: '9px 13px',
              marginBottom: 12,
              fontSize: type.body,
              display: 'flex',
              alignItems: 'center',
              gap: 9,
            }}
          >
            <motion.span
              className="playful-spin"
              aria-hidden="true"
              style={{
                width: 13,
                height: 13,
                borderRadius: '50%',
                border: `2px solid ${warnText}`,
                borderTopColor: 'transparent',
                flexShrink: 0,
                display: 'inline-block',
              }}
            />
            Metrics collection interrupted. Recovering…
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {(collectorState === 'failed' || metrics?.collectorError) && collectorState !== 'recovering' && (
          <motion.div
            key="failed"
            data-testid="collector-error-banner"
            role="alert"
            aria-live="assertive"
            variants={riseItem}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{
              background: dangerTint,
              border: dangerBorder,
              borderRadius: radius.control,
              color: dangerText,
              padding: '9px 13px',
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
              <motion.button
                type="button"
                data-testid="retry-metrics-button"
                onClick={handleRetryMetrics}
                disabled={retryPending}
                aria-label={retryPending ? 'Retrying metrics collection' : 'Retry metrics collection'}
                whileTap={retryPending ? undefined : tapScale}
                transition={springPop}
                style={{
                  padding: '5px 13px',
                  borderRadius: radius.pill,
                  border: dangerBorder,
                  background: dangerTint,
                  color: dangerText,
                  cursor: retryPending ? 'wait' : 'pointer',
                  fontWeight: 700,
                  fontSize: type.label,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  opacity: retryPending ? 0.6 : 1,
                }}
              >
                <RotateCcw
                  size={13}
                  aria-hidden="true"
                  className={retryPending ? 'playful-spin' : undefined}
                />
                Retry metrics
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {saveError && (
          <motion.div
            key="save-error"
            data-testid="save-error-banner"
            role="alert"
            aria-live="polite"
            variants={riseItem}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{
              background: warnTint,
              border: warnBorder,
              borderRadius: radius.control,
              color: warnText,
              padding: '9px 13px',
              marginBottom: 12,
              fontSize: type.body,
            }}
          >
            Settings couldn't be saved — {saveError}. Changes are kept in memory for this session.
          </motion.div>
        )}
      </AnimatePresence>

      <main
        style={{
          flex: 1,
          minWidth: 0,
        }}
      >
      <AnimatePresence initial={false}>
        {historyLoadError && metrics && (
          <motion.div
            key="history-error"
            role="alert"
            aria-live="polite"
            variants={riseItem}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{
              color: dangerText,
              padding: '9px 13px',
              marginBottom: 12,
              fontSize: type.body,
              background: dangerTint,
              border: dangerBorder,
              borderRadius: radius.control,
            }}
          >
            Couldn't refresh metrics history — {historyLoadError}. Showing previous data.
          </motion.div>
        )}
      </AnimatePresence>

      {historyLoadError && !metrics ? (
        <motion.div
          variants={riseItem}
          initial="hidden"
          animate="visible"
          role="alert"
          aria-live="assertive"
          style={{
            color: dangerText,
            padding: '40px 0',
            textAlign: 'center',
            fontSize: type.body,
            lineHeight: 1.6,
          }}
        >
          Couldn't load metrics history — {historyLoadError}. Try restarting the app.
        </motion.div>
      ) : hasMetricsButNoVisibleCards(metrics, visibleCardOrder) ? (
        <EmptyDashboard
          title="All metrics hidden"
          actionLabel="Choose metrics"
          onAction={() => metricsTriggerRef.current?.click()}
        />
      ) : shouldShowLoadingState(metrics, visibleCardOrder) ? (
        <div role="status" aria-live="polite" style={{ color: textMuted, fontSize: type.body }}>
          <motion.div
            variants={staggerParent(0.06)}
            initial="hidden"
            animate="visible"
            style={{ padding: '4px 0 12px' }}
          >
            <motion.div
              variants={riseItem}
              style={{
                color: textPrimary,
                fontWeight: 650,
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <motion.span
                className="playful-spin"
                aria-hidden="true"
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: '50%',
                  border: `2px solid ${accent}`,
                  borderTopColor: 'transparent',
                  display: 'inline-block',
                }}
              />
              Collecting metrics…
            </motion.div>
            <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <SkeletonCard delay={0.1} height={150} />
              <SkeletonCard delay={0.18} height={110} />
            </div>
          </motion.div>
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
