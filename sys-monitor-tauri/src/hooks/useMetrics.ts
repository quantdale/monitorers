import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import type { MetricsSnapshot, HistoryPayload, DiskHistory } from '../types/metrics';

const MAX_HISTORY = 3600;

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
    };
  });

  // Add newly discovered disks.
  for (const snap of snapshotDisks) {
    if (!updated.find((d) => d.key === snap.key)) {
      updated.push({ key: snap.key, values: [snap.active] });
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
  mem: number[];
  mem_used_gb: number;
  mem_total_gb: number;
  disks: DiskHistory[];
  net_recv: number[];
  net_sent: number[];
  igpu: number[];
  dgpu: number[];
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
    invoke<HistoryPayload>('get_history').then((h) => {
      setHistory(h);
    });
  }, []);

  // Listen for live metric updates and append to history.
  useEffect(() => {
    const unlistenPromise = listen<MetricsSnapshot>('metrics-update', (event) => {
      const snap = event.payload;

      setMemGb({ used: snap.mem_used_gb, total: snap.mem_total_gb });

      setHistory((prev) => {
        if (!prev) return prev;
        return {
          cpu: appendToHistory(prev.cpu, snap.cpu),
          mem: appendToHistory(prev.mem, snap.mem),
          disks: mergeDiskHistory(prev.disks, snap.disks),
          net_recv: appendToHistory(prev.net_recv, snap.net_recv_kb),
          net_sent: appendToHistory(prev.net_sent, snap.net_sent_kb),
          igpu: appendToHistory(prev.igpu, snap.igpu),
          dgpu: appendToHistory(prev.dgpu, snap.dgpu),
        };
      });
    });

    return () => {
      unlistenPromise.then((f) => f());
    };
  }, []);

  if (!history) return null;

  const w = Math.min(windowSeconds, MAX_HISTORY);

  return {
    cpu: sliceWindow(history.cpu, w),
    mem: sliceWindow(history.mem, w),
    mem_used_gb: memGb.used,
    mem_total_gb: memGb.total,
    disks: history.disks.map((d) => ({
      key: d.key,
      values: sliceWindow(d.values, w),
    })),
    net_recv: sliceWindow(history.net_recv, w),
    net_sent: sliceWindow(history.net_sent, w),
    igpu: sliceWindow(history.igpu, w),
    dgpu: sliceWindow(history.dgpu, w),
  };
}
