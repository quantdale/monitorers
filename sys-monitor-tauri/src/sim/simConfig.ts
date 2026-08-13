import { MAX_SIM_SPEED, MIN_SIM_SPEED, validateSimSpeed } from './mockBackend';

export { MAX_SIM_SPEED, MIN_SIM_SPEED } from './mockBackend';

export type SimulationLane = 'mock' | 'real';

export interface SimulationConfig {
  lane: SimulationLane;
  journeySelector: string;
  personaSelector: string;
  seed: number;
  speed: number;
  out: string;
}

export function resolveSimulationIds(selector: string, validIds: readonly string[], label: string): string[] {
  if (selector === '*') return [...validIds];
  const requested = selector.split(',').map((id) => id.trim()).filter(Boolean);
  const unknown = requested.filter((id) => !validIds.includes(id));
  if (requested.length === 0 || unknown.length > 0) {
    throw new Error(
      `${label} selector is invalid: ${unknown.length ? unknown.join(', ') : '(empty)'}; valid values: ${validIds.join(', ')}`
    );
  }
  return [...new Set(requested)];
}

export function parseSimulationConfig(
  env: Record<string, string | undefined>,
  randomSeed: () => number = () => Math.floor(Math.random() * 0xffffffff)
): SimulationConfig {
  const rawLane = env.SIM_LANE ?? 'mock';
  if (rawLane !== 'mock' && rawLane !== 'real') {
    throw new Error(`SIM_LANE must be "mock" or "real" (got ${rawLane})`);
  }

  const rawSeed = env.SIM_SEED;
  const seed = rawSeed === undefined ? randomSeed() : Number(rawSeed);
  if (!Number.isFinite(seed) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error(`SIM_SEED must be an integer between 0 and 4294967295 (got ${String(rawSeed)})`);
  }

  const defaultSpeed = rawLane === 'mock' ? 8 : 1;
  const rawSpeed = env.SIM_SPEED === undefined ? defaultSpeed : Number(env.SIM_SPEED);
  if (!Number.isFinite(rawSpeed) || rawSpeed < MIN_SIM_SPEED || rawSpeed > MAX_SIM_SPEED) {
    throw new Error(
      `SIM_SPEED must be finite and between ${MIN_SIM_SPEED} and ${MAX_SIM_SPEED} (got ${String(env.SIM_SPEED)})`
    );
  }

  return {
    lane: rawLane,
    journeySelector: env.SIM_JOURNEYS ?? '*',
    personaSelector: env.SIM_PERSONAS ?? '*',
    seed,
    speed: validateSimSpeed(rawSpeed),
    out: env.SIM_OUT ?? 'e2e-results/sim',
  };
}
