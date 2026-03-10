import { describe, it, expect } from 'vitest';
import { downsample, historyMinMax, gpuId } from './utils';

// --- downsample ---

describe('downsample', () => {
  it('returns same array when empty', () => {
    expect(downsample([], 300)).toEqual([]);
  });

  it('returns same array when at or under limit', () => {
    expect(downsample([1, 2, 3], 300)).toEqual([1, 2, 3]);
    expect(downsample([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  it('over limit — result length at most maxPoints+1 and ends with last value', () => {
    const result = downsample(Array.from({ length: 600 }, (_, i) => i), 300);
    expect(result.length).toBeLessThanOrEqual(301);
    expect(result[result.length - 1]).toBe(599);
  });

  it('always includes last element', () => {
    const arr = [1, 2, 3, 4, 5];
    const r = downsample(arr, 2);
    expect(r[r.length - 1]).toBe(5);
  });

  it('stride correctness — 6 items, max 3 → [0, 2, 4, 5]', () => {
    expect(downsample([0, 1, 2, 3, 4, 5], 3)).toEqual([0, 2, 4, 5]);
  });
});

// --- historyMinMax ---

describe('historyMinMax', () => {
  it('returns min and max from a typical slice', () => {
    expect(historyMinMax([10, 50, 30, 90, 5])).toEqual({ min: 5, max: 90 });
  });

  it('returns zeros for an empty array', () => {
    expect(historyMinMax([])).toEqual({ min: 0, max: 0 });
  });

  it('handles a single element', () => {
    expect(historyMinMax([42])).toEqual({ min: 42, max: 42 });
  });

  it('handles single element [5] from spec', () => {
    expect(historyMinMax([5])).toEqual({ min: 5, max: 5 });
  });

  it('handles identical values', () => {
    expect(historyMinMax([7.5, 7.5, 7.5])).toEqual({ min: 7.5, max: 7.5 });
  });

  it('handles [3, 1, 4, 1, 5, 9, 2, 6] → min 1, max 9', () => {
    expect(historyMinMax([3, 1, 4, 1, 5, 9, 2, 6])).toEqual({ min: 1, max: 9 });
  });

  it('handles [0, 0, 0] → min 0, max 0', () => {
    expect(historyMinMax([0, 0, 0])).toEqual({ min: 0, max: 0 });
  });

  it('handles negative values', () => {
    expect(historyMinMax([-10, 0, 10])).toEqual({ min: -10, max: 10 });
  });

  it('handles all negative [-5, -1, -3]', () => {
    expect(historyMinMax([-5, -1, -3])).toEqual({ min: -5, max: -1 });
  });
});

// --- gpuId ---

describe('gpuId', () => {
  it('GeForce RTX 4050 → gpu_geforce_rtx_4050', () => {
    expect(gpuId('GeForce RTX 4050')).toBe('gpu_geforce_rtx_4050');
  });

  it('Intel(R) Iris Xe Graphics → gpu_intel_r_iris_xe_graphics', () => {
    expect(gpuId('Intel(R) Iris Xe Graphics')).toBe('gpu_intel_r_iris_xe_graphics');
  });

  it('AMD Radeon RX 7600 → gpu_amd_radeon_rx_7600', () => {
    expect(gpuId('AMD Radeon RX 7600')).toBe('gpu_amd_radeon_rx_7600');
  });

  it('empty string → gpu_', () => {
    expect(gpuId('')).toBe('gpu_');
  });

  it('spaces trimmed by regex → gpu_spaces', () => {
    expect(gpuId('  spaces  ')).toBe('gpu_spaces');
  });
});
