import { describe, it, expect } from 'vitest';
import { historyMinMax } from './utils';

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

  it('handles identical values', () => {
    expect(historyMinMax([7.5, 7.5, 7.5])).toEqual({ min: 7.5, max: 7.5 });
  });

  it('handles negative values', () => {
    expect(historyMinMax([-10, 0, 10])).toEqual({ min: -10, max: 10 });
  });
});
