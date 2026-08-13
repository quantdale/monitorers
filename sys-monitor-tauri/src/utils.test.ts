import { describe, it, expect } from 'vitest';
import { historyMinMax, gpuId } from './utils';

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

  it('ignores NaN and infinities while preserving zero', () => {
    expect(historyMinMax([NaN, Infinity, -Infinity, 0, 4])).toEqual({ min: 0, max: 4 });
  });

  it('returns a finite empty fallback for all gaps', () => {
    expect(historyMinMax([NaN, Infinity, -Infinity])).toEqual({ min: 0, max: 0 });
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
