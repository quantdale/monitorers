import { describe, expect, it } from 'vitest';
import { MAX_SIM_SPEED, parseSimulationConfig, resolveSimulationIds } from './simConfig';

describe('simulation configuration', () => {
  it('uses the documented mock default and parses fixed values', () => {
    expect(parseSimulationConfig({ SIM_SEED: '42' })).toMatchObject({ lane: 'mock', seed: 42, speed: 8 });
    expect(parseSimulationConfig({ SIM_LANE: 'real', SIM_SEED: '7', SIM_SPEED: '1' })).toMatchObject({
      lane: 'real',
      seed: 7,
      speed: 1,
    });
  });

  it.each(['wat', ''])('rejects invalid lanes: %s', (lane) => {
    expect(() => parseSimulationConfig({ SIM_LANE: lane })).toThrow(/SIM_LANE/);
  });

  it.each(['NaN', 'Infinity', '0', '-1', String(MAX_SIM_SPEED + 1)])('rejects invalid speeds: %s', (speed) => {
    expect(() => parseSimulationConfig({ SIM_SPEED: speed })).toThrow(/SIM_SPEED/);
  });

  it('rejects malformed seeds', () => {
    expect(() => parseSimulationConfig({ SIM_SEED: 'not-a-number' })).toThrow(/SIM_SEED/);
    expect(() => parseSimulationConfig({ SIM_SEED: '-1' })).toThrow(/SIM_SEED/);
  });

  it('resolves selectors and lists unknown values', () => {
    expect(resolveSimulationIds('*', ['a', 'b'], 'journey')).toEqual(['a', 'b']);
    expect(resolveSimulationIds('b,a,b', ['a', 'b'], 'journey')).toEqual(['b', 'a']);
    expect(() => resolveSimulationIds('missing', ['a', 'b'], 'journey')).toThrow(/valid values: a, b/);
  });
});
