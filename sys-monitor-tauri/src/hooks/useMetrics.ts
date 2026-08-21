import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type {
  DiskHistory,
  GpuHistory,
  HistoryPayload,
  MetricValue,
  MetricsSnapshot,
} from '../types/metrics';
import { isTauri } from '../utils';
import { getSimBackend } from '../sim/mockBackend';

// Keep in sync with `HISTORY_CAPACITY` in src-tauri/src/state.rs.
export const MAX_HISTORY = 3600;

/**
 * How long a dynamic card is retained after it disappears from a live
 * snapshot. The backend uses the same four-full-tick grace period; this small
 * wall-clock cushion prevents a late browser event from dropping a card.
 */
const PRUNE_GRACE_MS = 5000;

export const EXPECTED_SCHEMA_VERSION = 5;

export const SCHEMA_MISMATCH_MESSAGE =
  'Frontend/backend metrics schema mismatch. Rebuild the application so both sides use the same version.';

export class SchemaMismatchError extends Error {
  readonly code = 'IPC_SCHEMA_MISMATCH';
  readonly expected: number;
  readonly actual: unknown;
  readonly payloadName: string;

  constructor(actual: unknown, payloadName: string) {
    super(
      `${SCHEMA_MISMATCH_MESSAGE} Expected ${payloadName} schema ${EXPECTED_SCHEMA_VERSION}, received ${String(actual)}.`
    );
    this.name = 'SchemaMismatchError';
    this.expected = EXPECTED_SCHEMA_VERSION;
    this.actual = actual;
    this.payloadName = payloadName;
  }
}

/** Validate and reject incompatible IPC payloads before any state is touched. */
export function assertSchemaVersion(actual: unknown, payloadName: string): void {
  if (actual !== EXPECTED_SCHEMA_VERSION) {
    const error = new SchemaMismatchError(actual, payloadName);
    console.error(`[IPC] ${error.message}`);
    throw error;
  }
}

export function appendToHistory<T>(arr: T[], value: T, maxLen: number): T[] {
  if (maxLen <= 0) return [];
  if (arr.length < maxLen) return [...arr, value];
  return [...arr.slice(-(maxLen - 1)), value];
}

function alignedValuesBeforeAppend(values: MetricValue[], timestampsLength: number): MetricValue[] {
  const targetLength = Math.min(MAX_HISTORY, Math.max(0, timestampsLength - 1));
  const tail = values.slice(-targetLength);
  if (tail.length >= targetLength) return tail;
  return [...Array<null>(targetLength - tail.length).fill(null), ...tail];
}

function normalizeMetricValue(value: MetricValue): MetricValue {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function mergeDiskHistory(
  prev: DiskHistory[],
  snapshotDisks: MetricsSnapshot['disks'],
  timestampsLength: number
): DiskHistory[] {
  const now = Date.now();
  const updated: DiskHistory[] = [];

  for (const disk of prev) {
    const update = snapshotDisks.find((candidate) => candidate.key === disk.key);
    const aligned = alignedValuesBeforeAppend(disk.values, timestampsLength);
    if (update) {
      updated.push({
        key: disk.key,
        values: appendToHistory(aligned, normalizeMetricValue(update.active), MAX_HISTORY),
        read_mb_s: update.read_mb_s,
        write_mb_s: update.write_mb_s,
        avg_response_ms: update.avg_response_ms,
        last_seen_ts: now,
      });
    } else if (now - (disk.last_seen_ts ?? now) <= PRUNE_GRACE_MS) {
      // Keep the card identity during the grace period, but add a real gap so
      // the missing sample cannot be mistaken for a frozen or zero reading.
      updated.push({
        ...disk,
        values: appendToHistory(aligned, null, MAX_HISTORY),
      });
    }
  }

  for (const snapshot of snapshotDisks) {
    if (updated.some((disk) => disk.key === snapshot.key)) continue;
    updated.push({
      key: snapshot.key,
      values: appendToHistory(
        Array<null>(Math.max(0, timestampsLength - 1)).fill(null),
        normalizeMetricValue(snapshot.active),
        MAX_HISTORY
      ),
      read_mb_s: snapshot.read_mb_s,
      write_mb_s: snapshot.write_mb_s,
      avg_response_ms: snapshot.avg_response_ms,
      last_seen_ts: now,
    });
  }

  return updated;
}

/** History arrays advance only on history-committing snapshots. */
export function shouldCommitHistory(onTick: boolean): boolean {
  return onTick;
}

/** Merge live GPU scalars by stable key, never by display name. */
export function mergeLatestGpu(
  prev: Record<string, number>,
  gpus: Pick<MetricsSnapshot['gpus'][number], 'key' | 'util'>[]
): Record<string, number> {
  const next = { ...prev };
  for (const gpu of gpus) next[gpu.key] = gpu.util;
  return next;
}

export function mergeGpuHistory(
  prev: GpuHistory[],
  snapshotGpus: MetricsSnapshot['gpus'],
  timestampsLength: number
): GpuHistory[] {
  const now = Date.now();
  const updated: GpuHistory[] = [];

  for (const gpu of prev) {
    const update = snapshotGpus.find((candidate) => candidate.key === gpu.key);
    const aligned = alignedValuesBeforeAppend(gpu.values, timestampsLength);
    if (update) {
      updated.push({
        key: gpu.key,
        name: update.name,
        vendor: update.vendor ?? gpu.vendor ?? 'unknown',
        values: appendToHistory(aligned, normalizeMetricValue(update.util), MAX_HISTORY),
        temp_c: update.temp_c ?? gpu.temp_c ?? null,
        nvidia: update.nvidia ?? null,
        last_seen_ts: now,
      });
    } else if (now - (gpu.last_seen_ts ?? now) <= PRUNE_GRACE_MS) {
      updated.push({
        ...gpu,
        values: appendToHistory(aligned, null, MAX_HISTORY),
      });
    }
  }

  for (const snapshot of snapshotGpus) {
    if (updated.some((gpu) => gpu.key === snapshot.key)) continue;
    updated.push({
      key: snapshot.key,
      name: snapshot.name,
      vendor: snapshot.vendor ?? 'unknown',
      values: appendToHistory(
        Array<null>(Math.max(0, timestampsLength - 1)).fill(null),
        normalizeMetricValue(snapshot.util),
        MAX_HISTORY
      ),
      temp_c: snapshot.temp_c ?? null,
      nvidia: snapshot.nvidia ?? null,
      last_seen_ts: now,
    });
  }

  return updated;
}

/** Return the global timestamp range for a real elapsed-time window. */
export function timestampWindowRange(timestamps: number[], windowSeconds: number): [number, number] {
  if (timestamps.length === 0 || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return [0, timestamps.length];
  }
  const newest = timestamps[timestamps.length - 1];
  const cutoff = newest - windowSeconds * 1000;
  const start = timestamps.findIndex((timestamp) => timestamp >= cutoff);
  return [start < 0 ? Math.max(0, timestamps.length - 1) : start, timestamps.length];
}

/**
 * Slice a channel using the timestamps shared by the whole history payload.
 * The optional tail alignment handles a channel whose backend history is
 * shorter than the global ring without turning a 60-second request into 60
 * arbitrary samples.
 */
export function sliceWindow<T>(arr: T[], timestamps: number[], windowSeconds: number): T[] {
  if (arr.length === 0) return [];
  const [globalStart, globalEnd] = timestampWindowRange(timestamps, windowSeconds);
  if (timestamps.length === 0) return arr;
  const offset = timestamps.length - arr.length;
  const localStart = Math.max(0, globalStart - offset);
  const localEnd = Math.min(arr.length, globalEnd - offset);
  return localStart < localEnd ? arr.slice(localStart, localEnd) : [];
}

export interface SlicedGpuHistory extends GpuHistory {
  /** Latest util%, refreshed on every event (~250ms), independent of history. */
  latest: number;
}

export interface SlicedHistory {
  timestamps: number[];
  cpu: number[];
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
  collectorError: string | null;
}

/** Append a validated full-tick snapshot to a history payload. */
export function appendSnapshotToHistory(
  previous: HistoryPayload | null,
  snapshot: MetricsSnapshot,
  timestamp = Date.now()
): HistoryPayload | null {
  if (!shouldCommitHistory(snapshot.on_tick)) return previous;
  if (!previous) return seedHistoryFromSnapshot(snapshot, timestamp);

  const timestamps = appendToHistory(previous.timestamps, timestamp, MAX_HISTORY);
  const timestampLength = timestamps.length;
  return {
    schema_version: EXPECTED_SCHEMA_VERSION,
    timestamps,
    cpu: appendToHistory(previous.cpu, snapshot.cpu, MAX_HISTORY),
    cpu_name: snapshot.cpu_name ?? previous.cpu_name,
    cpu_temp_c: snapshot.cpu_temp_c ?? previous.cpu_temp_c ?? null,
    mem: appendToHistory(previous.mem, snapshot.mem, MAX_HISTORY),
    disks: mergeDiskHistory(previous.disks, snapshot.disks, timestampLength),
    net_recv: appendToHistory(previous.net_recv, snapshot.net_recv_kib_s, MAX_HISTORY),
    net_sent: appendToHistory(previous.net_sent, snapshot.net_sent_kib_s, MAX_HISTORY),
    gpus: mergeGpuHistory(previous.gpus, snapshot.gpus, timestampLength),
  };
}

/**
 * Replays live full-tick events that arrived while a history request was in
 * flight. This is intentionally pure so stale-response and no-rollback
 * behavior can be tested without React or a Tauri runtime.
 */
export function reconcileHistoryWithLiveEvents(
  payload: HistoryPayload,
  events: readonly { snapshot: MetricsSnapshot; timestamp: number }[]
): HistoryPayload {
  return events.reduce(
    (current, event) => {
      // get_history can race an emitted event. If the backend already
      // included that event in its response, replaying it would duplicate a
      // point. A monotonic timestamp is the shared identity available at this
      // boundary; events at or before the response tail are already covered.
      const newest = current.timestamps.at(-1);
      if (newest !== undefined && event.timestamp <= newest) return current;
      return appendSnapshotToHistory(current, event.snapshot, event.timestamp) ?? current;
    },
    payload
  );
}

export function seedHistoryFromSnapshot(snapshot: MetricsSnapshot, timestamp = Date.now()): HistoryPayload {
  return {
    schema_version: EXPECTED_SCHEMA_VERSION,
    timestamps: [timestamp],
    cpu: [snapshot.cpu],
    cpu_name: snapshot.cpu_name ?? 'CPU',
    cpu_temp_c: snapshot.cpu_temp_c ?? null,
    mem: [snapshot.mem],
    disks: mergeDiskHistory([], snapshot.disks, 1),
    net_recv: [snapshot.net_recv_kib_s],
    net_sent: [snapshot.net_sent_kib_s],
    gpus: mergeGpuHistory([], snapshot.gpus, 1),
  };
}

function normalizeHistoryPayload(payload: HistoryPayload): HistoryPayload {
  const now = Date.now();
  return {
    ...payload,
    timestamps: payload.timestamps ?? [],
    cpu: payload.cpu ?? [],
    mem: payload.mem ?? [],
    net_recv: payload.net_recv ?? [],
    net_sent: payload.net_sent ?? [],
    disks: (payload.disks ?? []).map((disk) => ({
      ...disk,
      values: (disk.values ?? []).map(normalizeMetricValue),
      last_seen_ts: now,
    })),
    gpus: (payload.gpus ?? []).map((gpu) => ({
      ...gpu,
      vendor: gpu.vendor ?? 'unknown',
      values: (gpu.values ?? []).map(normalizeMetricValue),
      temp_c: gpu.temp_c ?? null,
      nvidia: gpu.nvidia ?? null,
      last_seen_ts: now,
    })),
  };
}

interface LiveEvent {
  sequence: number;
  snapshot: MetricsSnapshot;
  timestamp: number;
}

export interface UseMetricsResult {
  metrics: SlicedHistory | null;
  /** Includes actionable schema mismatch text when an incompatible payload is rejected. */
  historyLoadError: string | null;
}

export function useMetrics(windowSeconds: number): UseMetricsResult {
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const [memGb, setMemGb] = useState({ used: 0, total: 0 });
  const [collectorError, setCollectorError] = useState<string | null>(null);
  const [latestCpu, setLatestCpu] = useState(0);
  const [latestGpu, setLatestGpu] = useState<Record<string, number>>({});
  const historyRef = useRef<HistoryPayload | null>(null);
  const historyRequestError = useRef<string | null>(null);
  const liveSchemaError = useRef<string | null>(null);
  const requestGeneration = useRef(0);
  const liveSequence = useRef(0);
  const liveEvents = useRef<LiveEvent[]>([]);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    const startSequence = liveSequence.current;
    let cancelled = false;

    const acceptHistory = (payload: HistoryPayload) => {
      if (cancelled || generation !== requestGeneration.current) return;
      try {
        assertSchemaVersion(payload?.schema_version, 'HistoryPayload');
        let next = normalizeHistoryPayload(payload);
        const replay = liveEvents.current
          .filter((event) => event.sequence > startSequence)
          .map(({ snapshot, timestamp }) => ({ snapshot, timestamp }));
        if (replay.length > 0) next = reconcileHistoryWithLiveEvents(next, replay);
        historyRef.current = next;
        setHistory(next);
        historyRequestError.current = null;
        liveSchemaError.current = null;
        setHistoryLoadError(null);
        // The accepted payload now includes every event recorded so far.
        liveEvents.current = liveEvents.current.filter((event) => event.sequence > liveSequence.current);
      } catch (error) {
        historyRequestError.current = error instanceof SchemaMismatchError ? error.message : String(error);
        setHistoryLoadError(liveSchemaError.current ?? historyRequestError.current);
      }
    };

    const rejectHistory = (error: unknown) => {
      if (cancelled || generation !== requestGeneration.current) return;
      console.warn('[useMetrics] get_history failed:', error);
      historyRequestError.current = error instanceof Error ? error.message : String(error);
      setHistoryLoadError(liveSchemaError.current ?? historyRequestError.current);
    };

    if (isTauri()) {
      invoke<HistoryPayload>('get_history', { windowSecs: windowSeconds })
        .then(acceptHistory)
        .catch(rejectHistory);
    } else {
      getSimBackend().getHistory().then(acceptHistory).catch(rejectHistory);
      setMemGb({ used: 8, total: 16 });
    }

    return () => {
      cancelled = true;
    };
  }, [windowSeconds]);

  useEffect(() => {
    const handleSnapshot = (snap: MetricsSnapshot) => {
      try {
        assertSchemaVersion(snap?.schema_version, 'MetricsSnapshot');
      } catch (error) {
        // Fail closed: do not update any scalar or history state from this
        // payload. The listener remains attached so a compatible rebuild can
        // recover without restarting the hook.
        liveSchemaError.current = error instanceof SchemaMismatchError ? error.message : String(error);
        setHistoryLoadError(liveSchemaError.current ?? historyRequestError.current);
        return;
      }

      const timestamp = Date.now();
      // A compatible event proves the live IPC stream recovered from a live
      // schema fault. It does not, by itself, prove that a failed history
      // request for the selected window recovered, so keep that error until a
      // history response succeeds or a full tick seeds an empty history.
      liveSchemaError.current = null;
      if (snap.on_tick && historyRef.current === null) historyRequestError.current = null;
      setHistoryLoadError(liveSchemaError.current ?? historyRequestError.current);
      const sequence = ++liveSequence.current;
      liveEvents.current = [
        ...liveEvents.current.slice(-MAX_HISTORY),
        { sequence, snapshot: snap, timestamp },
      ];
      setMemGb({ used: snap.mem_used_gb, total: snap.mem_total_gb });
      setLatestCpu(snap.cpu);
      setLatestGpu((previous) => mergeLatestGpu(previous, snap.gpus));
      setHistory((previous) => {
        const base = historyRef.current ?? previous;
        const next = appendSnapshotToHistory(base, snap, timestamp);
        if (next === base) return previous;
        historyRef.current = next;
        return next;
      });
    };

    const handleCollectorError = (message: string) => setCollectorError(message);

    if (isTauri()) {
      const unlistenMetricsPromise = listen<MetricsSnapshot>('metrics-update', (event) => {
        handleSnapshot(event.payload);
      });
      const unlistenErrorPromise = listen<string>('collector-error', (event) => {
        handleCollectorError(event.payload);
      });
      return () => {
        unlistenMetricsPromise.then((unlisten) => unlisten()).catch(() => undefined);
        unlistenErrorPromise.then((unlisten) => unlisten()).catch(() => undefined);
      };
    }

    const backend = getSimBackend();
    backend.onSnapshot(handleSnapshot);
    backend.onCollectorError(handleCollectorError);
    backend.start();
    return () => {
      backend.stop();
      backend.offSnapshot(handleSnapshot);
      backend.offCollectorError(handleCollectorError);
    };
  }, []);

  // Derived windowed slice, memoized so the returned `metrics` object (and
  // every channel array inside it) keeps a stable identity across renders
  // that don't change the underlying data — drag start/stop, sidebar
  // toggles, selector open/close — so downstream chart cards only recompute
  // when a tick actually landed.
  const metrics = useMemo<SlicedHistory | null>(() => {
    if (!history) return null;
    const window = Math.max(1, Math.min(MAX_HISTORY, Math.floor(windowSeconds)));
    const timestamps = sliceWindow(history.timestamps, history.timestamps, window);
    return {
      timestamps,
      cpu: sliceWindow(history.cpu, history.timestamps, window),
      latestCpu,
      cpu_name: history.cpu_name,
      cpu_temp_c: history.cpu_temp_c ?? null,
      mem: sliceWindow(history.mem, history.timestamps, window),
      mem_used_gb: memGb.used,
      mem_total_gb: memGb.total,
      disks: history.disks.map((disk) => ({
        ...disk,
        values: sliceWindow(disk.values, history.timestamps, window),
      })),
      net_recv: sliceWindow(history.net_recv, history.timestamps, window),
      net_sent: sliceWindow(history.net_sent, history.timestamps, window),
      gpus: history.gpus.map((gpu) => ({
        ...gpu,
        values: sliceWindow(gpu.values, history.timestamps, window),
        latest: latestGpu[gpu.key] ?? [...gpu.values].reverse().find((value) => value != null) ?? 0,
      })),
      collectorError,
    };
  }, [history, memGb, latestCpu, latestGpu, collectorError, windowSeconds]);

  return { metrics, historyLoadError };
}
