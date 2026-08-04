/**
 * Deterministic seeded PRNG (mulberry32) — no external dependency. Same seed
 * ⇒ identical draw sequence, so a session is reproducible from its logged
 * header alone (see spec "Deterministic, reproducible execution").
 */
import type { Rng } from '../types';

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
  };
}