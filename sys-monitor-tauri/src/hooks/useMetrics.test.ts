import { describe, it, expect } from 'vitest';
import {
  appendToHistory,
  sliceWindow,
  mergeDiskHistory,
  mergeGpuHistory,
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
  const existing: DiskHistory[] = [
    { key: 'C:', values: [10, 20], read_mb_s: 5, write_mb_s: 3, avg_response_ms: 1.5, temp_c: 40 },
  ];

  it('appends new active value to existing disk', () => {
    const snapshot = [{ key: 'C:', active: 30, read_mb_s: 6, write_mb_s: 4, avg_response_ms: 2.0, temp_c: 41 }];
    const result = mergeDiskHistory(existing, snapshot);
    expect(result.length).toBe(1);
    expect(result[0].values).toEqual([10, 20, 30]);
    expect(result[0].read_mb_s).toBe(6);
  });

  it('adds a newly discovered disk', () => {
    const snapshot = [
      { key: 'C:', active: 30, read_mb_s: 6, write_mb_s: 4, avg_response_ms: 2.0, temp_c: 41 },
      { key: 'D:', active: 5, read_mb_s: 1, write_mb_s: 0.5, avg_response_ms: 0.8, temp_c: 35 },
    ];
    const result = mergeDiskHistory(existing, snapshot);
    expect(result.length).toBe(2);
    expect(result[1].key).toBe('D:');
    expect(result[1].values).toEqual([5]);
  });

  it('preserves existing disk when snapshot has no update', () => {
    const result = mergeDiskHistory(existing, []);
    expect(result).toEqual(existing);
  });
});

// --- mergeGpuHistory ---

describe('mergeGpuHistory', () => {
  const existing: GpuHistory[] = [
    { name: 'RTX 4050', values: [20, 40], temp_c: 55 },
  ];

  it('appends new util value to existing GPU', () => {
    const snapshot = [{ name: 'RTX 4050', util: 60, temp_c: 58 }];
    const result = mergeGpuHistory(existing, snapshot);
    expect(result.length).toBe(1);
    expect(result[0].values).toEqual([20, 40, 60]);
    expect(result[0].temp_c).toBe(58);
  });

  it('adds a newly discovered GPU', () => {
    const snapshot = [
      { name: 'RTX 4050', util: 60, temp_c: 58 },
      { name: 'UHD Graphics', util: 10, temp_c: 45 },
    ];
    const result = mergeGpuHistory(existing, snapshot);
    expect(result.length).toBe(2);
    expect(result[1].name).toBe('UHD Graphics');
    expect(result[1].values).toEqual([10]);
  });

  it('preserves temp_c from previous when snapshot has null', () => {
    const snapshot = [{ name: 'RTX 4050', util: 70, temp_c: null }];
    const result = mergeGpuHistory(existing, snapshot);
    expect(result[0].temp_c).toBe(55);
  });
});
