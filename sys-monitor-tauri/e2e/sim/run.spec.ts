/**
 * Simulation runner entry point (npm run sim / npm run sim:real).
 *
 * Runs the configured (journey × persona × driver) matrix through the engine.
 * Driven by env vars so CI and local runs share one entry:
 *   SIM_LANE      = 'mock' (default) | 'real'
 *   SIM_JOURNEYS  = comma-separated journey ids, or '*' for all
 *   SIM_PERSONAS  = comma-separated persona ids, or '*' for all
 *   SIM_SEED      = fixed seed (defaults to a random-per-run seed)
 *   SIM_SPEED     = mock clock speed factor for the mock lane (default 1)
 *   SIM_OUT       = artifact root dir (default e2e-results/sim)
 *
 * The run header (seed, journey, persona, driver) is logged per run so any
 * failure reproduces locally with `SIM_SEED=<seed> npm run sim`.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JOURNEYS, getJourney } from './journeys';
import { PERSONAS, getPersona } from './personas';
import { MockHarnessDriver } from './drivers/MockHarnessDriver';
import { RealAppDriver } from './drivers/RealAppDriver';
import { runJourney, defaultScenarioFor, type RunSelection } from './engine/runner';
import { isQuarantined } from './flake-quarantine';
import { mulberry32 } from './engine/prng';
import { drawThinkTime, drawDwellTime } from './engine/behavior';
import type { RunOptions, RunResult, SimDriver, SimScenario, SimContext } from './types';

const LANE = (process.env.SIM_LANE ?? 'mock') as 'mock' | 'real';
const JOURNEY_SELECTOR = process.env.SIM_JOURNEYS ?? '*';
const PERSONA_SELECTOR = process.env.SIM_PERSONAS ?? '*';
const SEED = process.env.SIM_SEED ? Number(process.env.SIM_SEED) : Math.floor(Math.random() * 0xffffffff);
const SPEED = Number(process.env.SIM_SPEED ?? (LANE === 'mock' ? 8 : 1));
const OUT_ROOT = resolve(process.env.SIM_OUT ?? join('e2e-results', 'sim'));
const RUN_ID = `run-${Date.now().toString(36)}`;

const selectedJourneys = JOURNEYS.filter((j) => {
  if (JOURNEY_SELECTOR === '*') return true;
  return JOURNEY_SELECTOR.split(',').includes(j.id);
});
const selectedPersonas = PERSONAS.filter((p) => {
  if (PERSONA_SELECTOR === '*') return true;
  return PERSONA_SELECTOR.split(',').includes(p.id);
});

function scenarioFor(journeyId: string): SimScenario {
  const base = defaultScenarioFor(LANE);
  base.speed = LANE === 'mock' ? SPEED : 1;
  if (journeyId === 'degraded-startup') {
    // Corrupt persisted settings + failing initial history load; the app must
    // fall back per-field and recover to live charts on the first live tick.
    base.corrupt_settings = true;
    base.history_fault = { mode: 'fail' };
  }
  return base;
}

function buildSelections(): { journeyId: string; personaId: string }[] {
  const out: { journeyId: string; personaId: string }[] = [];
  for (const journey of selectedJourneys) {
    if (!journey.supportedDrivers.includes(LANE)) continue;
    const matching = journey.personaIds.length === 0 ? selectedPersonas : selectedPersonas.filter((p) => journey.personaIds.includes(p.id));
    for (const persona of matching) {
      out.push({ journeyId: journey.id, personaId: persona.id });
    }
  }
  return out;
}

function makeDriver(): SimDriver {
  return LANE === 'real' ? new RealAppDriver() : new MockHarnessDriver();
}

const pretendContext = (rng: ReturnType<typeof mulberry32>): SimContext =>
  ({
    rng,
    persona: getPersona('customizer'),
    opts: { seed: 0, runId: 'x', lane: 'mock', speed: 1, outDir: '.', deadlineMs: 0 },
    driver: {},
    journey: {},
  }) as unknown as SimContext;

test.describe('simulation', () => {
  test('determinism: same seed reproduces the identical decision/timing sequence', () => {
    // Two independent PRNG instances from the same seed must produce the same
    // think/dwell draws and dice rolls — the core "reproduce from run header"
    // contract (spec "Deterministic, reproducible execution").
    const draws = (seed: number): number[] => {
      const rng1 = mulberry32(seed);
      const rng2 = mulberry32(seed);
      const a = [];
      const ctx1 = pretendContext(rng1);
      const ctx2 = pretendContext(rng2);
      for (let i = 0; i < 40; i += 1) {
        a.push(drawThinkTime(ctx1), drawDwellTime(ctx2));
      }
      ctx1.rng.chance(0.5);
      a.push(ctx2.rng.int(1, 100));
      return a;
    };
    expect(draws(42)).toEqual(draws(42));
    expect(draws(42)).not.toEqual(draws(43));
  });

  test(`sim matrix (${LANE} lane)`, async () => {
    mkdirSync(OUT_ROOT, { recursive: true });
    const selections = buildSelections();
    if (selections.length === 0) {
      test.skip(true, `no journeys selected for lane ${LANE} (SIM_JOURNEYS=${JOURNEY_SELECTOR})`);
      return;
    }
    const results: RunResult[] = [];
    for (const sel of selections) {
      if (isQuarantined(sel.journeyId)) {
        console.log(`[sim] quarantined, skipping: ${sel.journeyId}`);
        continue;
      }
      const opts: RunOptions = {
        seed: SEED,
        runId: RUN_ID,
        lane: LANE,
        speed: SPEED,
        outDir: OUT_ROOT,
        deadlineMs: 0,
      };
      const driver = makeDriver();
      const persona = getPersona(sel.personaId);
      const journey = getJourney(sel.journeyId);
      const scenario = scenarioFor(sel.journeyId);
      const selection: RunSelection = { persona, journey, driver, scenario };
      const result = await runJourney(opts, selection);
      results.push(result);
      console.log(
        `[sim] ${result.journeyId} [${result.personaId}] (${result.driverKind}) → ${result.passed ? 'PASS' : 'FAIL'} (${result.assertPassed}/${result.assertCount}) ${result.failureMessage ?? ''}`
      );
    }
    const failed = results.filter((r) => !r.passed);
    if (failed.length > 0) {
      throw new Error(
        `simulation: ${failed.length}/${results.length} journey(s) failed (see ${OUT_ROOT})`
      );
    }
  });
});