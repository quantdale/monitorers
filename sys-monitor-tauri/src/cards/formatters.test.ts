import { describe, expect, it } from 'vitest';
import {
  formatCompactTempC,
  formatFanPercent,
  formatGigabytes,
  formatMegabytes,
  formatMegabytesPerSecond,
  formatMegahertz,
  formatPercent,
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
