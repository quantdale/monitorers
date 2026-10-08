import { describe, expect, it } from 'vitest';
import {
  clampPercent,
  formatCompactTempC,
  formatFanPercent,
  formatGigabytes,
  formatMegabytes,
  formatMegabytesPerSecond,
  formatMegahertz,
  formatPercent,
  formatPercentRange,
  formatResponseMs,
  formatThroughput,
  formatWatts,
} from './formatters';

describe('finite-safe metric formatters', () => {
  it('rejects non-finite and negative throughput/capacity values', () => {
    expect(formatThroughput(Number.NaN)).toBe('—');
    expect(formatThroughput(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatThroughput(-1)).toBe('—');
    expect(formatGigabytes(-1)).toBe('—');
    expect(formatMegabytes(-1)).toBe('—');
    expect(formatMegabytesPerSecond(Number.NEGATIVE_INFINITY)).toBe('—');
  });

  it('clamps bounded percentages and preserves legitimate zero', () => {
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(150)).toBe('100.0%');
    expect(formatPercent(-2)).toBe('0.0%');
    expect(formatFanPercent(120)).toBe('100%');
    expect(formatFanPercent(Number.NaN)).toBe('—');
  });

  it('handles metric-specific finite policies', () => {
    expect(formatCompactTempC(-4.25)).toBe('-4.3°C');
    expect(formatCompactTempC(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatWatts(250)).toBe('250.0 W');
    expect(formatWatts(-0.1)).toBe('—');
    expect(formatMegabytes(2048)).toBe('2048');
    expect(formatMegahertz(1600.4)).toBe('1600 MHz');
    expect(formatMegahertz(Number.NaN)).toBe('—');
    expect(formatResponseMs(0)).toBe('Avg: —');
  });
});

// The List view's window statistics scan the RAW windowed slice, so a single
// out-of-range sample would otherwise advertise a percentage the collector
// cannot produce (observed on the mock lane: `Min: -9.9%`).
describe('percentage range formatting', () => {
  it('formats a normal range', () => {
    expect(formatPercentRange(0, 69.94)).toBe('Min: 0.0%  Max: 69.9%');
  });

  it('clamps both bounds into 0-100', () => {
    expect(formatPercentRange(-9.9, 69.9)).toBe('Min: 0.0%  Max: 69.9%');
    expect(formatPercentRange(-50, 180)).toBe('Min: 0.0%  Max: 100.0%');
  });

  it('preserves legitimate zero bounds', () => {
    expect(formatPercentRange(0, 0)).toBe('Min: 0.0%  Max: 0.0%');
  });

  it('reports non-finite bounds instead of rendering NaN', () => {
    expect(formatPercentRange(Number.NaN, 10)).toBe('Min: —%  Max: —%');
    expect(formatPercentRange(0, Number.POSITIVE_INFINITY)).toBe('Min: —%  Max: —%');
  });

  it('clampPercent is the single clamping rule shared with formatPercent', () => {
    expect(clampPercent(-0.4)).toBe(0);
    expect(clampPercent(100.6)).toBe(100);
    expect(formatPercent(clampPercent(-0.4))).toBe('0.0%');
    expect(formatPercentRange(clampPercent(-0.4), clampPercent(100.6))).toBe(
      'Min: 0.0%  Max: 100.0%'
    );
  });
});
