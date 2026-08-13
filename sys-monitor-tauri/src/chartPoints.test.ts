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

  it('over limit — never exceeds the point budget and ends with the last point', () => {
    const src = Array.from({ length: 600 }, (_, i) => i);
    const pts = computeChartPoints({ history: src, maxPoints: 300 });
    expect(pts.length).toBe(300);
    expect(pts[0]).toEqual({ t: 0, v: 0, v2: undefined });
    expect(pts[pts.length - 1]).toEqual({ t: 599, v: 599, v2: undefined });
  });

  it('never exceeds arbitrary positive integer budgets', () => {
    for (const length of [1, 2, 3, 4, 5, 17, 301, 600, 3600]) {
      const history = Array.from({ length }, (_, index) => index);
      for (const budget of [1, 2, 3, 4, 7, 31, 300]) {
        const points = computeChartPoints({ history, maxPoints: budget });
        expect(points.length).toBeLessThanOrEqual(Math.min(length, budget));
        if (length > budget && budget > 1) {
          expect(points[0].t).toBe(0);
          expect(points.at(-1)?.t).toBe(length - 1);
        }
      }
    }
  });

  it('preserves a narrow interior spike after downsampling', () => {
    const history = Array.from({ length: 100 }, () => 10);
    history[37] = 99;
    const points = computeChartPoints({ history, maxPoints: 10 });
    expect(points.some((point) => point.t === 37 && point.v === 99)).toBe(true);
  });

  it('handles non-integer and non-finite budgets safely', () => {
    expect(computeChartPoints({ history: [1, 2, 3], maxPoints: 2.9 }).length).toBe(2);
    expect(computeChartPoints({ history: [1, 2, 3], maxPoints: Number.NaN })).toEqual([]);
    expect(computeChartPoints({ history: [1, 2, 3], maxPoints: 0 })).toEqual([]);
    expect(computeChartPoints({ history: [1, 2, 3], maxPoints: -1 })).toEqual([]);
  });

  it('keeps the newest point within budget (301 → 300)', () => {
    const src = Array.from({ length: 301 }, (_, i) => i);
    const pts = computeChartPoints({ history: src, maxPoints: 300 });
    expect(pts.length).toBe(300);
    expect(pts[pts.length - 1]).toEqual({ t: 300, v: 300, v2: undefined });
  });

  it('evenly samples 6 items within a budget of 3', () => {
    const pts = computeChartPoints({ history: [0, 1, 2, 3, 4, 5], maxPoints: 3 });
    expect(pts.map((p) => p.v)).toEqual([0, 3, 5]);
  });

  it('always includes the last element', () => {
    const pts = computeChartPoints({ history: [1, 2, 3, 4, 5], maxPoints: 2 });
    expect(pts.map((p) => p.v)).toEqual([1, 5]);
  });

  it('NaN becomes a chart gap', () => {
    const pts = computeChartPoints({ history: [NaN, 5], maxPoints: 300 });
    expect(pts[0].v).toBeNull();
  });

  it('negative values clamp to 0', () => {
    const pts = computeChartPoints({ history: [-10, 5], maxPoints: 300 });
    expect(pts[0].v).toBe(0);
  });

  it('null values become a chart gap while zero stays zero', () => {
    const pts = computeChartPoints({ history: [null, 0, 5], maxPoints: 300 });
    expect(pts[0].v).toBeNull();
    expect(pts[1].v).toBe(0);
  });

  it('secondary history populates v2, clamped and NaN-safe', () => {
    const pts = computeChartPoints({ history: [1, 2], secondaryHistory: [10, NaN], maxPoints: 300 });
    expect(pts[0].v2).toBe(10);
    expect(pts[1].v2).toBeNull();
  });

  it('keeps a missing-data gap visible when downsampling', () => {
    const pts = computeChartPoints({ history: [10, 20, null, 30, 40, 50, 60], maxPoints: 4 });
    expect(pts.some((point) => point.v === null)).toBe(true);
    expect(pts[0]?.t).toBe(0);
    expect(pts.at(-1)?.t).toBe(6);
  });

  it('no secondary history — v2 stays undefined', () => {
    expect(computeChartPoints({ history: [1, 2], maxPoints: 300 })[0].v2).toBeUndefined();
  });

  it('missing timestamps — t falls back to the index', () => {
    const pts = computeChartPoints({ history: [1, 2, 3], maxPoints: 300 });
    expect(pts.map((p) => p.t)).toEqual([0, 1, 2]);
  });
});
