import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { MetricsSnapshot, HistoryPayload, DiskHistory, GpuHistory } from '../types/metrics';
import { isTauri } from '../utils';
import { getSimBackend } from '../sim/mockBackend';

// Keep in sync with `HISTORY_CAPACITY` in src-tauri/src/state.rs (no shared-constant
// mechanism crosses the IPC boundary between Rust and TypeScript).
const MAX_HISTORY = 3600;

/**
 * How long (ms) a disk/GPU card is retained on the frontend after its last
 * appearance in a live snapshot. Mirrors the backend's PRUNE_MISS_THRESHOLD
 * (4 consecutive missing full ticks ≈ 4s); slightly longer absorbs clock skew.
 */
const PRUNE_GRACE_MS = 5000;

export const EXPECTED_SCHEMA_VERSION = 3;

export function assertSchemaVersion(actual: number, payloadName: string): void {
  if (actual !== EXPECTED_SCHEMA_VERSION) {
    console.error(
      `[IPC] ${payloadName} schema version mismatch: ` +
      `expected ${EXPECTED_SCHEMA_VERSION}, got ${actual}. ` +
      `Rebuild both frontend and backend.`
    );
  }
}

export function appendToHistory(arr: number[], value: number, maxLen: number): number[] {
  if (arr.length < maxLen) {
    return [...arr, value];
  }
  const next = arr.slice(-(maxLen - 1));
  next.push(value);
  return next;
}

/** Pad a values array with NaN up to `timestampsLength - 1` so the next
 *  appended point lands on the same index as the newest global timestamp.
 *  New/mid-session cards then render at their true x-position instead of the
 *  left edge of the window. NOTE: computeChartPoints (chartPoints.ts) clamps
 *  NaN to 0, so this pre-discovery gap actually renders as a flat 0% line, not
 *  empty space — keep the two in sync if either changes. */
function padToTimestamps(
  values: number[],
  timestampsLength: number,
  maxLen: number
): number[] {
  const pad = Math.min(maxLen - 1, Math.max(0, timestampsLength - 1 - values.length));
  if (pad === 0) return values;
  return [...values, ...Array(pad).fill(NaN)];
}

export function mergeDiskHistory(
  prev: DiskHistory[],
  snapshotDisks: MetricsSnapshot['disks'],
  timestampsLength: number
): DiskHistory[] {
  const now = Date.now();
  const updated: DiskHistory[] = [];

  // Existing disks: append when present; keep (frozen) while a ghost within the
  // grace window; drop once a ghost has been absent past PRUNE_GRACE_MS.
  for (const d of prev) {
    const update = snapshotDisks.find((x) => x.key === d.key);
    if (update) {
      updated.push({
        key: d.key,
        values: appendToHistory(padToTimestamps(d.values, timestampsLength, MAX_HISTORY), update.active, MAX_HISTORY),
        read_mb_s: update.read_mb_s,
        write_mb_s: update.write_mb_s,
        avg_response_ms: update.avg_response_ms,
        temp_c: update.temp_c ?? null,
        last_seen_ts: now,
      });
    } else if ((now - (d.last_seen_ts ?? now)) <= PRUNE_GRACE_MS) {
      // Ghost within grace window: keep frozen (values unchanged).
      updated.push(d);
    }
    // Otherwise the ghost is pruned (card removed).
  }

  // Newly discovered disks: NaN-pad to align with the global timestamps array,
  // then append the first value.
  for (const snap of snapshotDisks) {
    if (!updated.find((d) => d.key === snap.key)) {
      updated.push({
        key: snap.key,
        values: appendToHistory(Array(Math.max(0, timestampsLength - 1)).fill(NaN), snap.active, MAX_HISTORY),
        read_mb_s: snap.read_mb_s,
        write_mb_s: snap.write_mb_s,
        avg_response_ms: snap.avg_response_ms,
        temp_c: snap.temp_c ?? null,
        last_seen_ts: now,
      });
    }
  }

  return updated;
}

/** History arrays only advance on history-committing (on_tick) events. */
export function shouldCommitHistory(onTick: boolean): boolean {
  return onTick;
}

/** Merge fresh per-GPU util% into the latest-value map, updated on every event. */
export function mergeLatestGpu(
  prev: Record<string, number>,
  gpus: { name: string; util: number }[]
): Record<string, number> {
  const next = { ...prev };
  for (const g of gpus) {
    next[g.name] = g.util;
  }
  return next;
}

export function mergeGpuHistory(
  prev: GpuHistory[],
  snapshotGpus: MetricsSnapshot['gpus'],
  timestampsLength: number
): GpuHistory[] {
  const now = Date.now();
  const updated: GpuHistory[] = [];

  for (const g of prev) {
    const update = snapshotGpus.find((x) => x.name === g.name);
    if (update) {
      updated.push({
        name: g.name,
        values: appendToHistory(padToTimestamps(g.values, timestampsLength, MAX_HISTORY), update.util, MAX_HISTORY),
        temp_c: update.temp_c ?? g.temp_c ?? null,
        last_seen_ts: now,
      });
    } else if ((now - (g.last_seen_ts ?? now)) <= PRUNE_GRACE_MS) {
      updated.push(g);
    }
  }

  for (const snap of snapshotGpus) {
    if (!updated.find((g) => g.name === snap.name)) {
      updated.push({
        name: snap.name,
        values: appendToHistory(Array(Math.max(0, timestampsLength - 1)).fill(NaN), snap.util, MAX_HISTORY),
        temp_c: snap.temp_c ?? null,
        last_seen_ts: now,
      });
    }
  }

  return updated;
}

/** Slice the rightmost `windowSeconds` points from a history array. */
export function sliceWindow(arr: number[], windowSeconds: number): number[] {
  if (arr.length <= windowSeconds) return arr;
  return arr.slice(arr.length - windowSeconds);
}

interface NvidiaStats {
  power_w: number | null;
  mem_used_mb: number | null;
  mem_total_mb: number | null;
  fan_speed_pct: number | null;
  clock_mhz: number | null;
}

interface GpuMeta {
  name: string;
  vendor: string;
}

export interface SlicedGpuHistory extends GpuHistory {
  vendor: string;
  /** Latest util%, refreshed on every event (~250ms) independent of history commits. */
  latest: number;
}

export interface SlicedHistory {
  timestamps: number[];
  cpu: number[];
  /** Latest CPU%, refreshed on every event (~250ms) independent of history commits. */
  latestCpu: number;
  cpu_name: string;
  cpu_temp_c: number | null;
  mem: number[];
  mem_used_gb: number;
  mem_total_gb: number;
  disks: DiskHistory[];
  net_recv: number[];
  net_sent: number[];
  gpus: SlicedGpuHistory[];
  nvidia_power_w: number | null;
  nvidia_mem_used_mb: number | null;
  nvidia_mem_total_mb: number | null;
  nvidia_fan_speed_pct: number | null;
  nvidia_clock_mhz: number | null;
  collectorError: string | null;
}

interface SnapshotSetters {
  setMemGb: Dispatch<SetStateAction<{ used: number; total: number }>>;
  setNvidiaStats: Dispatch<SetStateAction<NvidiaStats>>;
  setGpuMeta: Dispatch<SetStateAction<GpuMeta[]>>;
  setLatestCpu: Dispatch<SetStateAction<number>>;
  setLatestGpu: Dispatch<SetStateAction<Record<string, number>>>;
  setHistory: Dispatch<SetStateAction<HistoryPayload | null>>;
}

/**
 * Applies one MetricsSnapshot to React state — shared by the real `metrics-update`
 * listener and the browser-mock `setInterval` path so the two can't drift apart.
 */
function applySnapshot(snap: MetricsSnapshot, setters: SnapshotSetters): void {
  setters.setMemGb({ used: snap.mem_used_gb, total: snap.mem_total_gb });
  setters.setNvidiaStats({
    power_w: snap.nvidia_power_w ?? null,
    mem_used_mb: snap.nvidia_mem_used_mb ?? null,
    mem_total_mb: snap.nvidia_mem_total_mb ?? null,
    fan_speed_pct: snap.nvidia_fan_speed_pct ?? null,
    clock_mhz: snap.nvidia_clock_mhz ?? null,
  });
  setters.setGpuMeta((prev) => {
    const map = new Map<string, string>(prev.map((m) => [m.name, m.vendor]));
    for (const g of snap.gpus) {
      map.set(g.name, g.vendor ?? 'unknown');
    }
    return Array.from(map.entries()).map(([name, vendor]) => ({ name, vendor }));
  });
  // Latest scalars refresh on every event, independent of on_tick.
  setters.setLatestCpu(snap.cpu);
  setters.setLatestGpu((prev) => mergeLatestGpu(prev, snap.gpus));
  // History arrays only advance on history-committing (on_tick) events —
  // otherwise every ~250ms event would grow them 4x faster than real time.
  if (!shouldCommitHistory(snap.on_tick)) return;
  setters.setHistory((prev) => {
    // No history yet (initial `get_history` failed or was slow): seed a
    // one-point history from this snapshot so charts start immediately
    // instead of hanging on the load error (METRICS-001).
    if (!prev) return seedHistoryFromSnapshot(snap);
    const now = Date.now();
    const newTsLen = Math.min(MAX_HISTORY, prev.timestamps.length + 1);
    return {
      schema_version: prev.schema_version,
      timestamps: appendToHistory(prev.timestamps, now, MAX_HISTORY),
      cpu: appendToHistory(prev.cpu, snap.cpu, MAX_HISTORY),
      cpu_name: snap.cpu_name ?? prev.cpu_name,
      cpu_temp_c: snap.cpu_temp_c ?? prev.cpu_temp_c ?? null,
      mem: appendToHistory(prev.mem, snap.mem, MAX_HISTORY),
      disks: mergeDiskHistory(prev.disks, snap.disks, newTsLen),
      net_recv: appendToHistory(prev.net_recv, snap.net_recv_kb, MAX_HISTORY),
      net_sent: appendToHistory(prev.net_sent, snap.net_sent_kb, MAX_HISTORY),
      gpus: mergeGpuHistory(prev.gpus, snap.gpus, newTsLen),
    };
  });
}

/**
 * Seeds a one-point HistoryPayload from a live MetricsSnapshot. Used when the
 * initial `get_history` call failed (e.g. it raced backend startup): live
 * `metrics-update` events keep arriving, and once the first on_tick snapshot
 * lands the charts can start from that point instead of hanging forever on the
 * "Couldn't load metrics history" dead end (METRICS-001).
 */
export function seedHistoryFromSnapshot(snap: MetricsSnapshot): HistoryPayload {
  return {
    schema_version: snap.schema_version,
    timestamps: [Date.now()],
    cpu: [snap.cpu],
    cpu_name: snap.cpu_name ?? 'CPU',
    cpu_temp_c: snap.cpu_temp_c ?? null,
    mem: [snap.mem],
    disks: mergeDiskHistory([], snap.disks, 1),
    net_recv: [snap.net_recv_kb],
    net_sent: [snap.net_sent_kb],
    gpus: mergeGpuHistory([], snap.gpus, 1),
  };
}

export interface UseMetricsResult {
  metrics: SlicedHistory | null;
  /** Set when the initial `get_history` IPC call rejects; cleared by the first live `metrics-update` event, which also seeds the charts from the snapshot (METRICS-001). */
  historyLoadError: string | null;
}

export function useMetrics(windowSeconds: number): UseMetricsResult {
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  // Track the latest mem GB values separately (not historised).
  const [memGb, setMemGb] = useState<{ used: number; total: number }>({
    used: 0,
    total: 0,
  });
  const [nvidiaStats, setNvidiaStats] = useState<NvidiaStats>({
    power_w: null,
    mem_used_mb: null,
    mem_total_mb: null,
    fan_speed_pct: null,
    clock_mhz: null,
  });
  const [gpuMeta, setGpuMeta] = useState<GpuMeta[]>([]);
  const [collectorError, setCollectorError] = useState<string | null>(null);
  // Latest CPU/GPU scalar values, updated on every event regardless of on_tick —
  // mirrors the memGb/nvidiaStats latest-vs-history split, so card readouts keep
  // their ~250ms refresh rate even though history[] only appends on_tick.
  const [latestCpu, setLatestCpu] = useState<number>(0);
  const [latestGpu, setLatestGpu] = useState<Record<string, number>>({});

  // Load history on mount and when the time window changes.
  useEffect(() => {
    if (isTauri()) {
      invoke<HistoryPayload>('get_history', { windowSecs: windowSeconds })
        .then((payload) => {
          assertSchemaVersion(payload.schema_version, 'HistoryPayload');
          const now = Date.now();
          // A successful (re)load clears any prior refetch/initial error so a
          // retry that eventually succeeds doesn't leave a stale banner up.
          setHistoryLoadError(null);
          setHistory({
            ...payload,
            timestamps: payload.timestamps ?? [],
            // Backend payloads carry no last_seen_ts; seed it so ghost pruning
            // has a baseline (cards are "present" at load time).
            disks: (payload.disks ?? []).map((d) => ({ ...d, last_seen_ts: now })),
            gpus: (payload.gpus ?? []).map((g) => ({ ...g, last_seen_ts: now })),
          });
        })
        .catch((err) => {
          console.warn('[useMetrics] get_history failed:', err);
          setHistoryLoadError(err instanceof Error ? err.message : String(err));
        });
      return;
    }
    // Browser mock mode: seed history from the scriptable sim backend. The
    // promise may fault (simulated slow/failing load) — rejection surfaces the
    // same historyLoadError inline-warning path as a real IPC failure, and the
    // first live snapshot seeds the charts (METRICS-001).
    getSimBackend()
      .getHistory()
      .then((payload) => {
        setHistory(payload);
        setHistoryLoadError(null);
      })
      .catch((err) => {
        console.warn('[useMetrics] mock get_history failed:', err);
        setHistoryLoadError(err instanceof Error ? err.message : String(err));
      });
    setMemGb({ used: 8, total: 16 });
  }, [windowSeconds]);

  // Listen for live metric updates and append to history.
  useEffect(() => {
    if (isTauri()) {
      const unlistenMetricsPromise = listen<MetricsSnapshot>('metrics-update', (event) => {
        const snap = event.payload;
        assertSchemaVersion(snap.schema_version, 'MetricsSnapshot');
        // Any live event proves the collector pipeline is running, so a
        // historyLoadError from a failed initial `get_history` is moot.
        setHistoryLoadError(null);
        applySnapshot(snap, {
          setMemGb,
          setNvidiaStats,
          setGpuMeta,
          setLatestCpu,
          setLatestGpu,
          setHistory,
        });
      });
      const unlistenErrorPromise = listen<string>('collector-error', (event) => {
        setCollectorError(event.payload);
      });
      return () => {
        unlistenMetricsPromise.then((f) => f());
        unlistenErrorPromise.then((f) => f());
      };
    }
    // Browser mock mode runs the same 250 ms period and 4:1 on_tick ratio as
    // the real backend's tick loop, so the history-gating logic below is
    // exercised the same way in dev mode as it is against live Tauri events.
    // The sim backend drives the loop (and any scripted faults) and forwards
    // snapshots + collector errors to the same applySnapshot path.
    const backend = getSimBackend();
    const onSnapshot = (snap: MetricsSnapshot) => {
      // Any live event proves the pipeline is running, so a historyLoadError
      // from a simulated failed initial load is moot (mirrors the Tauri path).
      setHistoryLoadError(null);
      applySnapshot(snap, {
        setMemGb,
        setNvidiaStats,
        setGpuMeta,
        setLatestCpu,
        setLatestGpu,
        setHistory,
      });
    };
    const onCollectorError = (message: string) => setCollectorError(message);
    backend.onSnapshot(onSnapshot);
    backend.onCollectorError(onCollectorError);
    backend.start();
    return () => {
      backend.stop();
      backend.offSnapshot(onSnapshot);
      backend.offCollectorError(onCollectorError);
    };
  }, []);

  if (!history) return { metrics: null, historyLoadError };

  const w = Math.min(windowSeconds, MAX_HISTORY);

  return {
    metrics: {
      timestamps: sliceWindow(history.timestamps, w),
      cpu: sliceWindow(history.cpu, w),
      latestCpu,
      cpu_name: history.cpu_name,
      cpu_temp_c: history.cpu_temp_c ?? null,
      mem: sliceWindow(history.mem, w),
      mem_used_gb: memGb.used,
      mem_total_gb: memGb.total,
      disks: history.disks.map((d) => ({
        key: d.key,
        values: sliceWindow(d.values, w),
        read_mb_s: d.read_mb_s,
        write_mb_s: d.write_mb_s,
        avg_response_ms: d.avg_response_ms,
        temp_c: d.temp_c ?? null,
      })),
      net_recv: sliceWindow(history.net_recv, w),
      net_sent: sliceWindow(history.net_sent, w),
      gpus: history.gpus.map((g) => {
        const meta = gpuMeta.find((m) => m.name === g.name);
        return {
          name: g.name,
          values: sliceWindow(g.values, w),
          temp_c: g.temp_c ?? null,
          vendor: meta?.vendor ?? 'unknown',
          latest: latestGpu[g.name] ?? g.values.at(-1) ?? 0,
        };
      }),
      nvidia_power_w: nvidiaStats.power_w,
      nvidia_mem_used_mb: nvidiaStats.mem_used_mb,
      nvidia_mem_total_mb: nvidiaStats.mem_total_mb,
      nvidia_fan_speed_pct: nvidiaStats.fan_speed_pct,
      nvidia_clock_mhz: nvidiaStats.clock_mhz,
      collectorError,
    },
    historyLoadError,
  };
}
