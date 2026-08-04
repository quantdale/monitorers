import { describe, it, expect, vi } from 'vitest';
import {
  appendToHistory,
  sliceWindow,
  mergeDiskHistory,
  mergeGpuHistory,
  mergeLatestGpu,
  assertSchemaVersion,
  EXPECTED_SCHEMA_VERSION,
} from './useMetrics';
import type { DiskHistory, GpuHistory } from '../types/metrics';

// --- appendToHistory ---

const MAX_HISTORY = 3600;

describe('appendToHistory', () => {
  it('appends a value to the array', () => {
    expect(appendToHistory([1, 2, 3], 4, MAX_HISTORY)).toEqual([1, 2, 3, 4]);
  });

  it('trims to maxLen when exceeding capacity', () => {
    const big = Array.from({ length: 3600 }, (_, i) => i);
    const result = appendToHistory(big, 9999, MAX_HISTORY);
    expect(result.length).toBe(3600);
    expect(result[0]).toBe(1);
    expect(result[result.length - 1]).toBe(9999);
  });

  it('does not trim when under capacity', () => {
    const result = appendToHistory([10, 20], 30, MAX_HISTORY);
    expect(result).toEqual([10, 20, 30]);
  });

  it('works on an empty array', () => {
    expect(appendToHistory([], 42, MAX_HISTORY)).toEqual([42]);
  });
});

// --- sliceWindow ---

describe('sliceWindow', () => {
  it('returns last N points when array is longer than window', () => {
    expect(sliceWindow([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });

  it('returns entire array when shorter than window', () => {
    expect(sliceWindow([1, 2], 10)).toEqual([1, 2]);
  });

  it('returns entire array when equal to window', () => {
    expect(sliceWindow([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  it('returns last 1 element for window = 1', () => {
    expect(sliceWindow([7, 8, 9], 1)).toEqual([9]);
  });
});

// --- mergeDiskHistory ---

describe('mergeDiskHistory', () => {
  const now = Date.now();
  const existing: DiskHistory[] = [
    { key: 'C:', values: [10, 20], read_mb_s: 5, write_mb_s: 3, avg_response_ms: 1.5, temp_c: 40, last_seen_ts: now },
  ];

  it('appends new active value to existing disk', () => {
    const snapshot = [{ key: 'C:', active: 30, read_mb_s: 6, write_mb_s: 4, avg_response_ms: 2.0, temp_c: 41 }];
    const result = mergeDiskHistory(existing, snapshot, 3);
    expect(result.length).toBe(1);
    expect(result[0].values).toEqual([10, 20, 30]);
    expect(result[0].read_mb_s).toBe(6);
    expect(result[0].last_seen_ts).toBeGreaterThanOrEqual(now);
  });

  it('adds a newly discovered disk NaN-padded to align with timestamps', () => {
    const snapshot = [
      { key: 'C:', active: 30, read_mb_s: 6, write_mb_s: 4, avg_response_ms: 2.0, temp_c: 41 },
      { key: 'D:', active: 5, read_mb_s: 1, write_mb_s: 0.5, avg_response_ms: 0.8, temp_c: 35 },
    ];
    const result = mergeDiskHistory(existing, snapshot, 4);
    expect(result.length).toBe(2);
    expect(result[1].key).toBe('D:');
    // Padding to timestampsLength - 1 (3 NaN) then the real value at index 3.
    expect(result[1].values).toEqual([NaN, NaN, NaN, 5]);
    expect(result[1].last_seen_ts).toBeGreaterThanOrEqual(now);
  });

  it('preserves a ghost disk within the grace window (frozen)', () => {
    const ghost: DiskHistory[] = [
      { key: 'C:', values: [10, 20], read_mb_s: 5, write_mb_s: 3, avg_response_ms: 1.5, temp_c: 40, last_seen_ts: Date.now() },
    ];
    const result = mergeDiskHistory(ghost, [], 4);
    expect(result).toEqual(ghost);
  });

  it('prunes a ghost disk absent past the grace window', () => {
    const stale: DiskHistory[] = [
      { key: 'C:', values: [10, 20], read_mb_s: 5, write_mb_s: 3, avg_response_ms: 1.5, temp_c: 40, last_seen_ts: Date.now() - 6000 },
    ];
    const result = mergeDiskHistory(stale, [], 4);
    expect(result.length).toBe(0);
  });

  it('reappearing disk re-aligns its values to the current timestamp length', () => {
    const reappear: DiskHistory[] = [
      { key: 'C:', values: [10, 20], read_mb_s: 5, write_mb_s: 3, avg_response_ms: 1.5, temp_c: 40, last_seen_ts: Date.now() - 6000 },
    ];
    const snapshot = [{ key: 'C:', active: 30, read_mb_s: 6, write_mb_s: 4, avg_response_ms: 2.0, temp_c: 41 }];
    const result = mergeDiskHistory(reappear, snapshot, 5);
    // Pad to timestampsLength - 1 = 4, then append 30 => length 5.
    expect(result[0].values).toEqual([10, 20, NaN, NaN, 30]);
    expect(result[0].last_seen_ts).toBeGreaterThanOrEqual(Date.now() - 100);
  });
});

// --- mergeGpuHistory ---

describe('mergeGpuHistory', () => {
  const now = Date.now();
  const existing: GpuHistory[] = [
    { name: 'RTX 4050', values: [20, 40], temp_c: 55, last_seen_ts: now },
  ];

  it('appends new util value to existing GPU', () => {
    const snapshot = [{ name: 'RTX 4050', vendor: 'nvidia', util: 60, temp_c: 58 }];
    const result = mergeGpuHistory(existing, snapshot, 3);
    expect(result.length).toBe(1);
    expect(result[0].values).toEqual([20, 40, 60]);
    expect(result[0].temp_c).toBe(58);
    expect(result[0].last_seen_ts).toBeGreaterThanOrEqual(now);
  });

  it('adds a newly discovered GPU NaN-padded to align with timestamps', () => {
    const snapshot = [
      { name: 'RTX 4050', vendor: 'nvidia', util: 60, temp_c: 58 },
      { name: 'UHD Graphics', vendor: 'intel', util: 10, temp_c: 45 },
    ];
    const result = mergeGpuHistory(existing, snapshot, 4);
    expect(result.length).toBe(2);
    expect(result[1].name).toBe('UHD Graphics');
    expect(result[1].values).toEqual([NaN, NaN, NaN, 10]);
    expect(result[1].last_seen_ts).toBeGreaterThanOrEqual(now);
  });

  it('preserves temp_c from previous when snapshot has null', () => {
    const snapshot = [{ name: 'RTX 4050', vendor: 'nvidia', util: 70, temp_c: null }];
    const result = mergeGpuHistory(existing, snapshot, 3);
    expect(result[0].temp_c).toBe(55);
  });

  it('prunes a ghost GPU absent past the grace window', () => {
    const stale: GpuHistory[] = [
      { name: 'RTX 4050', values: [20, 40], temp_c: 55, last_seen_ts: Date.now() - 6000 },
    ];
    const result = mergeGpuHistory(stale, [], 3);
    expect(result.length).toBe(0);
  });

  it('preserves a ghost GPU within the grace window', () => {
    const ghost: GpuHistory[] = [
      { name: 'RTX 4050', values: [20, 40], temp_c: 55, last_seen_ts: Date.now() },
    ];
    const result = mergeGpuHistory(ghost, [], 3);
    expect(result).toEqual(ghost);
  });
});

// --- mergeLatestGpu (latest-value derivation, independent of history) ---
// NOTE: the on_tick history-commit gating that `shouldCommitHistory` provides
// is exercised end-to-end in useMetrics.hook.test.ts ("history array length
// matches the number of on_tick events"), so the identity behavior of the
// one-line function itself is not re-tested here.

describe('mergeLatestGpu', () => {
  it('sets latest util for a new GPU', () => {
    const result = mergeLatestGpu({}, [{ name: 'RTX 4050', util: 42 }]);
    expect(result).toEqual({ 'RTX 4050': 42 });
  });

  it('updates latest util for an existing GPU on every call, regardless of on_tick', () => {
    const prev = { 'RTX 4050': 10 };
    const result = mergeLatestGpu(prev, [{ name: 'RTX 4050', util: 55 }]);
    expect(result).toEqual({ 'RTX 4050': 55 });
  });

  it('preserves entries for GPUs not present in the current snapshot', () => {
    const prev = { 'RTX 4050': 10, 'UHD Graphics': 5 };
    const result = mergeLatestGpu(prev, [{ name: 'RTX 4050', util: 20 }]);
    expect(result).toEqual({ 'RTX 4050': 20, 'UHD Graphics': 5 });
  });
});

// --- assertSchemaVersion ---

describe('assertSchemaVersion', () => {
  it('does not log an error when versions match', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    assertSchemaVersion(EXPECTED_SCHEMA_VERSION, 'HistoryPayload');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('logs an error when schema_version is missing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    assertSchemaVersion(undefined as unknown as number, 'HistoryPayload');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('logs an error when schema_version is greater than expected', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    assertSchemaVersion(EXPECTED_SCHEMA_VERSION + 1, 'HistoryPayload');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('logs an error when schema_version is lower than expected', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    assertSchemaVersion(EXPECTED_SCHEMA_VERSION - 1, 'HistoryPayload');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

