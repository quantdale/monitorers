// Pure card-identity logic extracted from App.tsx so the dashboard's
// content-keyed id scheme (as opposed to the hardware sidebar's positional
// scheme — see HardwareSidebar.tsx) is unit-testable without a full render.
import { gpuId } from './utils';
import type { SlicedHistory } from './hooks/useMetrics';

/** Minimal shape these helpers need — a subset of SlicedHistory. */
export type CardMetricsShape = Pick<SlicedHistory, 'disks' | 'gpus' | 'net_recv' | 'net_sent'>;

/** The default card order derived from currently-detected hardware. */
export function computeDefaultCardIds(metrics: CardMetricsShape): string[] {
  return [
    'cpu',
    'memory',
    ...metrics.disks.map((d) => `disk_${d.key}`),
    'network',
    ...metrics.gpus.map((g) => gpuId(g.name)),
  ];
}

/**
 * Merge newly-detected default ids into a saved card order, appending only
 * ids not already present. Returns null when nothing changed, signalling the
 * caller should skip the settings write (no-op merge).
 */
export function mergeNewCardIds(current: string[], defaultIds: string[]): string[] | null {
  const currentSet = new Set(current);
  const hasNew = defaultIds.some((id) => !currentSet.has(id));
  if (!hasNew) return null;
  const merged = [...current];
  for (const id of defaultIds) {
    if (!currentSet.has(id)) {
      merged.push(id);
      currentSet.add(id);
    }
  }
  return merged;
}

/**
 * Whether a card id corresponds to hardware present in the current snapshot.
 * Per-key, not per-metric: a `disk_C:` id is only present when a disk with
 * key `C:` is in the snapshot, and a `gpu_<id>` id only when a GPU with the
 * matching slug is — so an unplugged disk or hot-unplugged GPU hides exactly
 * its own ghost card while the others stay visible.
 */
export function isCardPresent(id: string, metrics: CardMetricsShape | null): boolean {
  if (!metrics) return false;
  if (id === 'cpu') return true;
  if (id === 'memory') return true;
  if (id === 'network') return metrics.net_recv.length > 0 || metrics.net_sent.length > 0;
  if (id.startsWith('disk_')) {
    const key = id.slice('disk_'.length);
    return metrics.disks.some((d) => d.key === key);
  }
  if (id.startsWith('gpu_')) {
    // gpuId() already returns the full `gpu_<slug>` id — card ids ARE gpuIds.
    return metrics.gpus.some((g) => gpuId(g.name) === id);
  }
  return false;
}

/**
 * The subset of cardOrder to actually render: hidden ids and ids whose
 * underlying hardware is currently absent are excluded. cardOrder itself is
 * left untouched by the caller — a disk/GPU id absent from the current
 * snapshot is a "ghost" entry that stays in cardOrder but drops out of view.
 */
export function computeVisibleCardOrder(
  cardOrder: string[],
  hiddenCardIds: Set<string>,
  metrics: CardMetricsShape | null
): string[] {
  return cardOrder.filter((id) => !hiddenCardIds.has(id) && isCardPresent(id, metrics));
}

export type NvidiaStatsShape = Pick<
  SlicedHistory,
  'nvidia_power_w' | 'nvidia_mem_used_mb' | 'nvidia_mem_total_mb' | 'nvidia_fan_speed_pct' | 'nvidia_clock_mhz'
> & { gpus: { vendor: string }[] };

/** Whether any NVML-sourced stat is available for an Nvidia GPU in the snapshot. */
export function computeHasNvidiaData(metrics: NvidiaStatsShape | null): boolean {
  return (
    !!metrics &&
    metrics.gpus.some((g) => g.vendor === 'nvidia') &&
    (metrics.nvidia_power_w != null ||
      metrics.nvidia_mem_used_mb != null ||
      metrics.nvidia_mem_total_mb != null ||
      metrics.nvidia_fan_speed_pct != null ||
      metrics.nvidia_clock_mhz != null)
  );
}

/**
 * True once metrics have arrived but every card is hidden/absent — distinct
 * from still-collecting, so the UI can show "all hidden" instead of leaving the
 * user staring at the loading message with unknown cards.
 */
export function hasMetricsButNoVisibleCards(metrics: unknown | null, visibleCardOrder: string[]): boolean {
  return !!metrics && visibleCardOrder.length === 0;
}

/**
 * True before the first metrics snapshot/history has arrived — render the
 * "Collecting metrics…" state instead of an empty canvas. The all-cards-hidden
 * case (metrics present, nothing visible) is a different state, handled by
 * hasMetricsButNoVisibleCards so hiding every card isn't mistaken for loading.
 */
export function shouldShowLoadingState(metrics: unknown | null, visibleCardOrder: string[]): boolean {
  return !metrics || visibleCardOrder.length === 0;
}
