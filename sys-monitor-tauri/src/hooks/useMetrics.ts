import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { MetricsSnapshot, HistoryPayload, DiskHistory, GpuHistory } from '../types/metrics';

const MAX_HISTORY = 3600;

const EXPECTED_SCHEMA_VERSION = 1;

function assertSchemaVersion(actual: number, payloadName: string): void {
  if (actual !== EXPECTED_SCHEMA_VERSION) {
    console.error(
      `[IPC] ${payloadName} schema version mismatch: ` +
      `expected ${EXPECTED_SCHEMA_VERSION}, got ${actual}. ` +
      `Rebuild both frontend and backend.`
    );
  }
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
}

/** Plausible fake history for browser dev (no Tauri backend). */
function mockHistoryPayload(): HistoryPayload {
  const n = 300;
  const t = (i: number) => (i / n) * Math.PI * 4;
  return {
    schema_version: 1,
    cpu: Array.from({ length: n }, (_, i) => 30 + 40 * Math.sin(t(i))),
    cpu_name: 'CPU',
    cpu_temp_c: 52,
    mem: Array.from({ length: n }, (_, i) => 50 + 35 * Math.sin(t(i) + 0.5)),
    disks: [
      { key: 'C:', values: Array.from({ length: n }, (_, i) => Math.max(0, 10 + 30 * Math.sin(t(i) + 1))), read_mb_s: 12.5, write_mb_s: 8.2, avg_response_ms: 3.2, temp_c: 42 },
      { key: 'D:', values: Array.from({ length: n }, (_, i) => Math.max(0, 5 + 15 * Math.sin(t(i) + 2))), read_mb_s: 3.1, write_mb_s: 1.8, avg_response_ms: 1.7, temp_c: 38 },
    ],
    net_recv: Array.from({ length: n }, (_, i) => 100 + 200 * Math.sin(t(i) + 2.5)),
    net_sent: Array.from({ length: n }, (_, i) => 50 + 150 * Math.sin(t(i) + 3)),
    gpus: [
      { name: 'UHD Graphics', values: Array.from({ length: n }, (_, i) => 15 + 25 * Math.sin(t(i) + 0.8)), temp_c: 48 },
      { name: 'RTX 4050', values: Array.from({ length: n }, (_, i) => 20 + 40 * Math.sin(t(i) + 1.2)), temp_c: 55 },
    ],
  };
}

/** Plausible fake snapshot that varies over time for browser dev. */
function mockMetricsSnapshot(): MetricsSnapshot {
  const t = Date.now() / 1000;
  return {
    schema_version: 1,
    cpu: 30 + 40 * Math.sin(t * 0.3),
    cpu_name: 'CPU',
    mem: 50 + 35 * Math.sin(t * 0.3 + 0.5),
    mem_used_gb: 6 + 2 * Math.sin(t * 0.1),
    mem_total_gb: 16,
    disks: [
      { key: 'C:', active: Math.max(0, 10 + 30 * Math.sin(t * 0.2 + 1)), read_mb_s: 12.5, write_mb_s: 8.2, avg_response_ms: 3.2, temp_c: 42 },
      { key: 'D:', active: Math.max(0, 5 + 15 * Math.sin(t * 0.2 + 2)), read_mb_s: 3.1, write_mb_s: 1.8, avg_response_ms: 1.7, temp_c: 38 },
    ],
    net_recv_kb: Math.max(0, 100 + 200 * Math.sin(t * 0.4 + 2.5)),
    net_sent_kb: Math.max(0, 50 + 150 * Math.sin(t * 0.4 + 3)),
    gpus: [
      { name: 'UHD Graphics', util: 15 + 25 * Math.sin(t * 0.3 + 0.8), temp_c: 48 },
      { name: 'RTX 4050', util: 20 + 40 * Math.sin(t * 0.3 + 1.2), temp_c: 55 },
    ],
    cpu_temp_c: 52,
  };
}

export function appendToHistory(arr: number[], value: number, maxLen: number): number[] {
  if (arr.length < maxLen) {
    return [...arr, value];
  }
  const next = arr.slice(-(maxLen - 1));
  next.push(value);
  return next;
}

export function mergeDiskHistory(
  prev: DiskHistory[],
  snapshotDisks: MetricsSnapshot['disks']
): DiskHistory[] {
  // Append new values to existing disk histories.
  // If a disk key appears in snapshot but not in history, add it.
  const updated = prev.map((d) => {
    const update = snapshotDisks.find((x) => x.key === d.key);
    if (!update) return d;
    return {
      key: d.key,
      values: appendToHistory(d.values, update.active, MAX_HISTORY),
      read_mb_s: update.read_mb_s,
      write_mb_s: update.write_mb_s,
      avg_response_ms: update.avg_response_ms,
      temp_c: update.temp_c ?? null,
    };
  });

  // Add newly discovered disks.
  for (const snap of snapshotDisks) {
    if (!updated.find((d) => d.key === snap.key)) {
      updated.push({ key: snap.key, values: [snap.active], read_mb_s: snap.read_mb_s, write_mb_s: snap.write_mb_s, avg_response_ms: snap.avg_response_ms, temp_c: snap.temp_c ?? null });
    }
  }

  return updated;
}

export function mergeGpuHistory(
  prev: GpuHistory[],
  snapshotGpus: MetricsSnapshot['gpus']
): GpuHistory[] {
  const updated = prev.map((g) => {
    const update = snapshotGpus.find((x) => x.name === g.name);
    if (!update) return g;
    return {
      name: g.name,
      values: appendToHistory(g.values, update.util, MAX_HISTORY),
      temp_c: update.temp_c ?? g.temp_c ?? null,
    };
  });
  for (const snap of snapshotGpus) {
    if (!updated.find((g) => g.name === snap.name)) {
      updated.push({ name: snap.name, values: [snap.util], temp_c: snap.temp_c ?? null });
    }
  }
  return updated;
}

/** Slice the rightmost `windowSeconds` points from a history array. */
export function sliceWindow(arr: number[], windowSeconds: number): number[] {
  if (arr.length <= windowSeconds) return arr;
  return arr.slice(arr.length - windowSeconds);
}

export interface SlicedHistory {
  cpu: number[];
  cpu_name: string;
  cpu_temp_c: number | null;
  mem: number[];
  mem_used_gb: number;
  mem_total_gb: number;
  disks: DiskHistory[];
  net_recv: number[];
  net_sent: number[];
  gpus: GpuHistory[];
}

export function useMetrics(windowSeconds: number): SlicedHistory | null {
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  // Track the latest mem GB values separately (not historised).
  const [memGb, setMemGb] = useState<{ used: number; total: number }>({
    used: 0,
    total: 0,
  });

  // Load history on mount and when the time window changes.
  useEffect(() => {
    if (isTauri()) {
      invoke<HistoryPayload>('get_history', { windowSecs: windowSeconds })
        .then((payload) => {
          assertSchemaVersion(payload.schema_version, 'HistoryPayload');
          setHistory(payload);
        })
        .catch((err) => console.warn('[useMetrics] get_history failed:', err));
      return;
    }
    setHistory(mockHistoryPayload());
    setMemGb({ used: 8, total: 16 });
  }, [windowSeconds]);

  // Listen for live metric updates and append to history.
  useEffect(() => {
    if (isTauri()) {
      const unlistenPromise = listen<MetricsSnapshot>('metrics-update', (event) => {
        const snap = event.payload;
        assertSchemaVersion(snap.schema_version, 'MetricsSnapshot');
        setMemGb({ used: snap.mem_used_gb, total: snap.mem_total_gb });
        setHistory((prev) => {
          if (!prev) return prev;
          return {
            schema_version: prev.schema_version,
            cpu: appendToHistory(prev.cpu, snap.cpu, MAX_HISTORY),
            cpu_name: snap.cpu_name ?? prev.cpu_name,
            cpu_temp_c: snap.cpu_temp_c ?? prev.cpu_temp_c ?? null,
            mem: appendToHistory(prev.mem, snap.mem, MAX_HISTORY),
            disks: mergeDiskHistory(prev.disks, snap.disks),
            net_recv: appendToHistory(prev.net_recv, snap.net_recv_kb, MAX_HISTORY),
            net_sent: appendToHistory(prev.net_sent, snap.net_sent_kb, MAX_HISTORY),
            gpus: mergeGpuHistory(prev.gpus, snap.gpus),
          };
        });
      });
      return () => {
        unlistenPromise.then((f) => f());
      };
    }
    const id = setInterval(() => {
      const snap = mockMetricsSnapshot();
      setMemGb({ used: snap.mem_used_gb, total: snap.mem_total_gb });
      setHistory((prev) => {
        if (!prev) return prev;
        return {
          schema_version: prev.schema_version,
          cpu: appendToHistory(prev.cpu, snap.cpu, MAX_HISTORY),
          cpu_name: snap.cpu_name ?? prev.cpu_name,
          cpu_temp_c: snap.cpu_temp_c ?? prev.cpu_temp_c ?? null,
          mem: appendToHistory(prev.mem, snap.mem, MAX_HISTORY),
          disks: mergeDiskHistory(prev.disks, snap.disks),
          net_recv: appendToHistory(prev.net_recv, snap.net_recv_kb, MAX_HISTORY),
          net_sent: appendToHistory(prev.net_sent, snap.net_sent_kb, MAX_HISTORY),
          gpus: mergeGpuHistory(prev.gpus, snap.gpus),
        };
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  if (!history) return null;

  const w = Math.min(windowSeconds, MAX_HISTORY);

  return {
    cpu: sliceWindow(history.cpu, w),
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
    gpus: history.gpus.map((g) => ({
      name: g.name,
      values: sliceWindow(g.values, w),
      temp_c: g.temp_c ?? null,
    })),
  };
}
