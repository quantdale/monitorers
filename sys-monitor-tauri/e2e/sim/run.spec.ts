/**
 * Simulation runner entry point (npm run sim / npm run sim:real).
 *
 * Runs the configured (journey × persona × driver) matrix through the engine.
 * Driven by env vars so CI and local runs share one entry:
 *   SIM_LANE      = 'mock' (default) | 'real'
 *   SIM_JOURNEYS  = comma-separated journey ids, or '*' for all
 *   SIM_PERSONAS  = comma-separated persona ids, or '*' for all
 *   SIM_SEED      = fixed seed (defaults to a random-per-run seed)
 *   SIM_SPEED     = mock clock speed factor for the mock lane (default 8)
 *   SIM_OUT       = artifact root dir (default e2e-results/sim)
 *
 * The run header (seed, journey, persona, driver) is logged per run so any
 * failure reproduces locally with `SIM_SEED=<seed> npm run sim`.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { JOURNEYS, getJourney } from './journeys';
import { PERSONAS, getPersona } from './personas';
import { MockHarnessDriver } from './drivers/MockHarnessDriver';
import { RealAppDriver } from './drivers/RealAppDriver';
import { runJourney, defaultScenarioFor, type RunSelection } from './engine/runner';
import { isQuarantined } from './flake-quarantine';
import { mulberry32 } from './engine/prng';
import { drawThinkTime, drawDwellTime, mistakes, wantsAction } from './engine/behavior';
import { createReloadGuard, type ReloadWatchTarget } from './engine/reloadGuard';
import { ClassifiedSimulationError } from './errors';
import { FREE_ROAM_ACTIONS, planFreeRoamTick } from './engine/freeroam';
import type { RunOptions, RunResult, SimDriver, SimScenario, SimContext } from './types';
import { parseSimulationConfig, resolveSimulationIds } from '../../src/sim/simConfig';

const config = parseSimulationConfig(process.env);
const LANE = config.lane;
const JOURNEY_SELECTOR = config.journeySelector;
const PERSONA_SELECTOR = config.personaSelector;
const SEED = config.seed;
const SPEED = config.speed;
const OUT_ROOT = resolve(config.out);
const RUN_ID = `run-${Date.now().toString(36)}-${LANE}`;

const selectedJourneyIds = resolveSimulationIds(JOURNEY_SELECTOR, JOURNEYS.map((j) => j.id), 'SIM_JOURNEYS');
const selectedPersonaIds = resolveSimulationIds(PERSONA_SELECTOR, PERSONAS.map((p) => p.id), 'SIM_PERSONAS');
const selectedJourneys = JOURNEYS.filter((j) => selectedJourneyIds.includes(j.id));
const selectedPersonas = PERSONAS.filter((p) => selectedPersonaIds.includes(p.id));

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
    // think/dwell draws AND the same decisions (mistakes, action dice) — the
    // core "reproduce from run header" contract (spec "Deterministic,
    // reproducible execution").
    const draws = (seed: number): (number | boolean)[] => {
      const rng1 = mulberry32(seed);
      const rng2 = mulberry32(seed);
      const a: (number | boolean)[] = [];
      const ctx1 = pretendContext(rng1);
      const ctx2 = pretendContext(rng2);
      for (let i = 0; i < 40; i += 1) {
        a.push(
          drawThinkTime(ctx1),
          drawDwellTime(ctx2),
          mistakes(ctx1, 'misdrag'),
          wantsAction(ctx2, 'toggleMetric'),
        );
      }
      ctx1.rng.chance(0.5);
      a.push(ctx2.rng.int(1, 100));
      return a;
    };
    expect(draws(42)).toEqual(draws(42));
    expect(draws(42)).not.toEqual(draws(43));
  });

  test('free-roam: same seed reproduces the identical decision plan', () => {
    // The free-roam step's contract: fixed draw order ⇒ same seed ⇒ same
    // plan (which actions each tick wants, plus the wrongClick die).
    const plan = (seed: number): ReturnType<typeof planFreeRoamTick>[] => {
      const ctx = pretendContext(mulberry32(seed));
      return Array.from({ length: 6 }, (_, i) => planFreeRoamTick(ctx, i));
    };
    const a = plan(42);
    expect(plan(42)).toEqual(a);
    expect(plan(43)).not.toEqual(a);
    for (const decision of a) {
      expect(decision.actions.every((kind) => FREE_ROAM_ACTIONS.includes(kind))).toBe(true);
      expect(typeof decision.wrongClick).toBe('boolean');
    }
  });

  test('reload guard: main-frame reload fails fast as harness-defect; child frames and restartApp reloads are tolerated', async () => {
    class FakeFrame {
      constructor(public urlValue: string) {}
      url(): string {
        return this.urlValue;
      }
    }
    class FakePage implements ReloadWatchTarget {
      private listeners = new Set<(frame: FakeFrame) => void>();
      readonly main = new FakeFrame('http://127.0.0.1:5180/?__sim_run=run-x');
      readonly child = new FakeFrame('about:blank');
      mainFrame(): FakeFrame {
        return this.main;
      }
      on(_event: 'framenavigated', listener: (frame: FakeFrame) => void): unknown {
        this.listeners.add(listener);
        return this;
      }
      off(_event: 'framenavigated', listener: (frame: FakeFrame) => void): unknown {
        this.listeners.delete(listener);
        return this;
      }
      navigate(frame: FakeFrame, url: string): void {
        frame.urlValue = url;
        for (const listener of this.listeners) listener(frame);
      }
    }

    const page = new FakePage();
    const guard = createReloadGuard(page);

    // Child-frame navigation (app-internal iframe) never trips the guard.
    page.navigate(page.child, 'http://127.0.0.1:5180/@vite/client');
    // An expected reload (driver restartApp) is suspended for its duration.
    guard.suspend();
    page.navigate(page.main, 'http://127.0.0.1:5180/?__sim_run=run-x&r');
    guard.resume();

    let rejection: unknown = null;
    guard.failure.catch((error) => {
      rejection = error;
    });
    // Vite HMR full reload mid-journey → fail-fast rejection naming the cause.
    page.navigate(page.main, 'http://127.0.0.1:5180/?__sim_run=run-x&t=0');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rejection).toBeInstanceOf(ClassifiedSimulationError);
    expect((rejection as ClassifiedSimulationError).failureClass).toBe('harness-defect');
    expect((rejection as ClassifiedSimulationError).message).toContain('HMR');

    // After dispose (runner teardown) further navigations are inert; the
    // recorded violation remains drainable exactly once.
    guard.dispose();
    page.navigate(page.main, 'http://127.0.0.1:5180/?__sim_run=run-x&t=1');
    expect(guard.drainViolations()).toHaveLength(1);
    expect(guard.drainViolations()).toHaveLength(0);
  });

  test(`sim matrix (${LANE} lane)`, async () => {
    mkdirSync(OUT_ROOT, { recursive: true });
    const selections = buildSelections();
    if (selections.length === 0) {
      throw new Error(
        `simulation configuration selected no journeys supporting lane ${LANE} (SIM_JOURNEYS=${JOURNEY_SELECTOR})`
      );
    }
    const runnableSelections = selections.filter((selection) => !isQuarantined(selection.journeyId));
    const quarantinedSelections = selections.filter((selection) => isQuarantined(selection.journeyId));
    console.log(
      `[sim] matrix selected=${selections.length} runnable=${runnableSelections.length} quarantined=${quarantinedSelections.length}`
    );
    if (runnableSelections.length === 0) {
      throw new Error(
        `simulation configuration selected only quarantined journeys: ${quarantinedSelections.map((s) => s.journeyId).join(', ')}`
      );
    }
    const results: RunResult[] = [];
    for (const sel of runnableSelections) {
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
    if (results.length === 0) {
      throw new Error('simulation produced zero runnable results');
    }
    if (failed.length > 0) {
      throw new Error(
        `simulation: ${failed.length}/${results.length} journey(s) failed (see ${OUT_ROOT})`
      );
    }
  });
});
