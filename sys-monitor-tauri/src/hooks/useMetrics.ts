import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import type { MetricsSnapshot, HistoryPayload, DiskHistory, GpuHistory } from '../types/metrics';

const MAX_HISTORY = 3600;

function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== 'undefined';
}

/** Plausible fake history for browser dev (no Tauri backend). */
function mockHistoryPayload(): HistoryPayload {
  const n = 300;
  const t = (i: number) => (i / n) * Math.PI * 4;
  return {
    cpu: Array.from({ length: n }, (_, i) => 30 + 40 * Math.sin(t(i))),
    cpu_name: 'CPU',
    cpu_temp_c: 52,
    mem: Array.from({ length: n }, (_, i) => 50 + 35 * Math.sin(t(i) + 0.5)),
    disks: [
      { key: 'C:', values: Array.from({ length: n }, (_, i) => Math.max(0, 10 + 30 * Math.sin(t(i) + 1))), read_mb_s: 12.5, write_mb_s: 8.2, temp_c: 42 },
      { key: 'D:', values: Array.from({ length: n }, (_, i) => Math.max(0, 5 + 15 * Math.sin(t(i) + 2))), read_mb_s: 3.1, write_mb_s: 1.8, temp_c: 38 },
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
    cpu: 30 + 40 * Math.sin(t * 0.3),
    cpu_name: 'CPU',
    mem: 50 + 35 * Math.sin(t * 0.3 + 0.5),
    mem_used_gb: 6 + 2 * Math.sin(t * 0.1),
    mem_total_gb: 16,
    disks: [
      { key: 'C:', active: Math.max(0, 10 + 30 * Math.sin(t * 0.2 + 1)), read_mb_s: 12.5, write_mb_s: 8.2, temp_c: 42 },
      { key: 'D:', active: Math.max(0, 5 + 15 * Math.sin(t * 0.2 + 2)), read_mb_s: 3.1, write_mb_s: 1.8, temp_c: 38 },
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

function appendToHistory(arr: number[], value: number): number[] {
  const next = [...arr, value];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

function mergeDiskHistory(
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
      values: appendToHistory(d.values, update.active),
      read_mb_s: update.read_mb_s,
      write_mb_s: update.write_mb_s,
      temp_c: update.temp_c ?? null,
    };
  });

  // Add newly discovered disks.
  for (const snap of snapshotDisks) {
    if (!updated.find((d) => d.key === snap.key)) {
      updated.push({ key: snap.key, values: [snap.active], read_mb_s: snap.read_mb_s, write_mb_s: snap.write_mb_s, temp_c: snap.temp_c ?? null });
    }
  }

  return updated;
}

function mergeGpuHistory(
  prev: GpuHistory[],
  snapshotGpus: MetricsSnapshot['gpus']
): GpuHistory[] {
  const updated = prev.map((g) => {
    const update = snapshotGpus.find((x) => x.name === g.name);
    if (!update) return g;
    return {
      name: g.name,
      values: appendToHistory(g.values, update.util),
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
function sliceWindow(arr: number[], windowSeconds: number): number[] {
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

  // Load the full history once on mount.
  useEffect(() => {
    if (isTauri()) {
      invoke<HistoryPayload>('get_history')
        .then(setHistory)
        .catch((err) => console.warn('[useMetrics] get_history failed:', err));
      return;
    }
    setHistory(mockHistoryPayload());
    setMemGb({ used: 8, total: 16 });
  }, []);

  // Listen for live metric updates and append to history.
  useEffect(() => {
    if (isTauri()) {
      const unlistenPromise = listen<MetricsSnapshot>('metrics-update', (event) => {
        const snap = event.payload;
        setMemGb({ used: snap.mem_used_gb, total: snap.mem_total_gb });
        setHistory((prev) => {
          if (!prev) return prev;
          return {
            cpu: appendToHistory(prev.cpu, snap.cpu),
            cpu_name: snap.cpu_name ?? prev.cpu_name,
            cpu_temp_c: snap.cpu_temp_c ?? prev.cpu_temp_c ?? null,
            mem: appendToHistory(prev.mem, snap.mem),
            disks: mergeDiskHistory(prev.disks, snap.disks),
            net_recv: appendToHistory(prev.net_recv, snap.net_recv_kb),
            net_sent: appendToHistory(prev.net_sent, snap.net_sent_kb),
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
          cpu: appendToHistory(prev.cpu, snap.cpu),
          cpu_name: snap.cpu_name ?? prev.cpu_name,
          cpu_temp_c: snap.cpu_temp_c ?? prev.cpu_temp_c ?? null,
          mem: appendToHistory(prev.mem, snap.mem),
          disks: mergeDiskHistory(prev.disks, snap.disks),
          net_recv: appendToHistory(prev.net_recv, snap.net_recv_kb),
          net_sent: appendToHistory(prev.net_sent, snap.net_sent_kb),
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
