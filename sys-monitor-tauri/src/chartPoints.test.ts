import { describe, it, expect } from 'vitest';
import { computeChartPoints } from './chartPoints';

describe('computeChartPoints', () => {
  it('returns [] for empty history', () => {
    expect(computeChartPoints({ history: [], maxPoints: 300 })).toEqual([]);
  });

  it('single point — t comes from timestamps when provided', () => {
    expect(computeChartPoints({ history: [5], timestamps: [1000], maxPoints: 300 })).toEqual([
      { t: 1000, v: 5, v2: undefined },
    ]);
  });

  it('single point — t falls back to the index', () => {
    expect(computeChartPoints({ history: [5], maxPoints: 300 })).toEqual([{ t: 0, v: 5, v2: undefined }]);
  });

  it('at or under maxPoints — passes through unchanged', () => {
    expect(computeChartPoints({ history: [1, 2, 3], maxPoints: 3 })).toEqual([
      { t: 0, v: 1, v2: undefined },
      { t: 1, v: 2, v2: undefined },
      { t: 2, v: 3, v2: undefined },
    ]);
  });

  it('over limit — stride sampling, ends with the last point (600 → 301)', () => {
    const src = Array.from({ length: 600 }, (_, i) => i);
    const pts = computeChartPoints({ history: src, maxPoints: 300 });
    expect(pts.length).toBe(301);
    expect(pts[0]).toEqual({ t: 0, v: 0, v2: undefined });
    expect(pts[1]).toEqual({ t: 2, v: 2, v2: undefined });
    expect(pts[pts.length - 1]).toEqual({ t: 599, v: 599, v2: undefined });
  });

  it('does not duplicate the last point when the stride already covers it (301 → 151)', () => {
    const src = Array.from({ length: 301 }, (_, i) => i);
    const pts = computeChartPoints({ history: src, maxPoints: 300 });
    expect(pts.length).toBe(151);
    expect(pts[pts.length - 1]).toEqual({ t: 300, v: 300, v2: undefined });
  });

  it('stride correctness — 6 items, max 3 → [0, 2, 4, 5]', () => {
    const pts = computeChartPoints({ history: [0, 1, 2, 3, 4, 5], maxPoints: 3 });
    expect(pts.map((p) => p.v)).toEqual([0, 2, 4, 5]);
  });

  it('always includes the last element', () => {
    const pts = computeChartPoints({ history: [1, 2, 3, 4, 5], maxPoints: 2 });
    expect(pts.map((p) => p.v)).toEqual([1, 4, 5]);
  });

  it('NaN becomes 0', () => {
    const pts = computeChartPoints({ history: [NaN, 5], maxPoints: 300 });
    expect(pts[0].v).toBe(0);
  });

  it('negative values clamp to 0', () => {
    const pts = computeChartPoints({ history: [-10, 5], maxPoints: 300 });
    expect(pts[0].v).toBe(0);
  });

  it('null/undefined values become 0', () => {
    const pts = computeChartPoints({ history: [null, 5] as unknown as number[], maxPoints: 300 });
    expect(pts[0].v).toBe(0);
  });

  it('secondary history populates v2, clamped and NaN-safe', () => {
    const pts = computeChartPoints({ history: [1, 2], secondaryHistory: [10, NaN], maxPoints: 300 });
    expect(pts[0].v2).toBe(10);
    expect(pts[1].v2).toBe(0);
  });

  it('no secondary history — v2 stays undefined', () => {
    expect(computeChartPoints({ history: [1, 2], maxPoints: 300 })[0].v2).toBeUndefined();
  });

  it('missing timestamps — t falls back to the index', () => {
    const pts = computeChartPoints({ history: [1, 2, 3], maxPoints: 300 });
    expect(pts.map((p) => p.t)).toEqual([0, 1, 2]);
  });
});
