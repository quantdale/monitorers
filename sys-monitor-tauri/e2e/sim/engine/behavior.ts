/**
 * Human-plausible behavior model: think time, dwell time, and decision points
 * drawn from persona ranges via the seeded PRNG. Zero-variance personas draw
 * midpoints so smoke runs are deterministic sequences.
 */
import type { Persona, Range, SimContext } from '../types';

function draw(rng: SimContext['rng'], range: Range, variance: number): number {
  const [min, max] = range;
  const base = min + (max - min) / 2;
  if (variance <= 0) return base;
  const spread = (max - min) / 2;
  return Math.max(min, Math.min(max, base + (rng.next() - 0.5) * 2 * spread * variance));
}

/** Delay between actions (ms) in WALL time — sim-time drawn from the persona
 *  range, scaled by the mock clock speed so compressed runs don't take real
 *  minutes. On the real lane speed=1, so these match human behavior exactly. */
export function drawThinkTime(ctx: SimContext): number {
  const simMs = draw(ctx.rng, ctx.persona.thinkTimeMs, ctx.persona.variance);
  return simMs / Math.max(1, ctx.opts.speed);
}

/** Dwell time before acting (ms) in WALL time (see drawThinkTime). */
export function drawDwellTime(ctx: SimContext): number {
  const simMs = draw(ctx.rng, ctx.persona.dwellTimeMs, ctx.persona.variance);
  return simMs / Math.max(1, ctx.opts.speed);
}

/** Waits a think-time delay (wall time). */
export async function thinkWait(ctx: SimContext): Promise<void> {
  const ms = drawThinkTime(ctx);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/** Waits a dwell-time delay (wall time). */
export async function dwellWait(ctx: SimContext): Promise<void> {
  const ms = drawDwellTime(ctx);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/** Whether the persona performs an optional action kind this session. */
export function wantsAction(ctx: SimContext, kind: keyof Persona['actionPreference']): boolean {
  const p = ctx.persona.actionPreference[kind] ?? 0;
  return ctx.rng.chance(p);
}

/** Draws a mistake outcome for the given mistake kind. */
export function mistakes(ctx: SimContext, kind: keyof Persona['mistakes']): boolean {
  const p = ctx.persona.mistakes[kind] ?? 0;
  return ctx.rng.chance(p);
}
