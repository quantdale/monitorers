/**
 * Journey runner — executes a (persona × journey × driver) combination and
 * produces a complete RunResult with artifacts (JSONL, JUnit, HTML, triage).
 * Deterministic: the seed is fixed per run; the persona draws all timings and
 * decisions from the seeded PRNG, and the run header logs seed + persona +
 * journey + driver so a failure reproduces locally from the header alone.
 */
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type {
  SimContext,
  RunOptions,
  RunResult,
  Persona,
  Journey,
  SimDriver,
  AssertionRecord,
  JsonLog,
  FailureClass,
} from '../types';
import type { SimScenario } from '../../../src/sim/mockBackend';
import { mulberry32 } from './prng';
import { thinkWait, dwellWait } from './behavior';
import {
  classifyFailure,
  writeJsonl,
  writeJunit,
  writeHtml,
  writeTriageBundle,
  type ConsoleCapture,
} from '../reporting/reports';

export interface RunSelection {
  persona: Persona;
  journey: Journey;
  driver: SimDriver;
  scenario: SimScenario;
}

export function defaultScenarioFor(_lane: RunOptions['lane']): SimScenario {
  return {
    version: 1,
    speed: 1,
    disks: [{ key: 'C:' }, { key: 'D:' }],
    gpus: [
      { name: 'UHD Graphics', vendor: 'intel' },
      { name: 'RTX 4050', vendor: 'nvidia' },
    ],
  };
}

export async function runJourney(opts: RunOptions, selection: RunSelection): Promise<RunResult> {
  const runDir = join(opts.outDir, `${opts.runId}__${selection.journey.id}__${selection.persona.id}`);
  mkdirSync(runDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const logs: JsonLog[] = [];
  const assertions: AssertionRecord[] = [];
  let consoleCapture: ConsoleCapture | null = null;
  let screenshotPath: string | null = null;
  let tracePath: string | null = null;
  let videoPath: string | null = null;
  let appStderrPath: string | null = null;
  let passed = false;
  let failureClass: FailureClass = 'none';
  let failureMessage: string | null = null;
  let failingStep: string | null = null;
  let currentStep = 'journey';

  const rng = mulberry32(opts.seed);
  const startWall = Date.now();
  const logLine = (kind: string, payload?: Record<string, unknown>): void => {
    logs.push({
      timestampMs: Date.now() - startWall,
      tick: String(stepCounter++),
      payload: kind ? { kind, ...payload } : payload,
    });
  };
  let stepCounter = 0;

  const ctx: SimContext = {
    driver: selection.driver,
    persona: selection.persona,
    journey: selection.journey,
    rng,
    opts,
    log: (kind, payload) => logLine(kind, payload),
    assert: (label, ok, detail) => {
      assertions.push({ stepIndex: stepCounter, label, result: ok ? 'pass' : 'fail', detail });
      logLine('assert', { label, result: ok ? 'pass' : 'fail', detail });
    },
    think: () => thinkWait(ctx),
    dwell: () => dwellWait(ctx),
    elapsedMs: () => Date.now() - startWall,
    deadline: (ms) => Date.now() - startWall > ms,
  };

  // Run header — the reproduction contract.
  logs.push({
    timestampMs: 0,
    tick: 'header',
    payload: {
      kind: 'run-header',
      seed: opts.seed,
      persona: selection.persona.id,
      journey: selection.journey.id,
      driver: selection.driver.kind,
      lane: opts.lane,
      speed: opts.speed,
      runId: opts.runId,
      startedAt,
    },
  });

  try {
    const launched = await selection.driver.launch(opts.runId, selection.scenario, runDir);
    appStderrPath = launched.appStderrPath;
    const page = launched.page;
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleCapture = consoleCapture ?? { messages: [], pageErrors: [] };
        consoleCapture.messages.push({ type: msg.type(), text: msg.text() });
      }
    });
    page.on('pageerror', (err) => {
      consoleCapture = consoleCapture ?? { messages: [], pageErrors: [] };
      consoleCapture.pageErrors.push(String(err));
    });

    currentStep = `journey:${selection.journey.id}`;
    logLine('step-start', { label: currentStep });
    await selection.journey.run(ctx);
    logLine('step-end', { label: currentStep });

    passed = assertions.every((a) => a.result === 'pass');
    if (!passed) {
      const failing = assertions.find((a) => a.result === 'fail');
      failureClass = 'app-defect';
      failureMessage = failing?.detail ?? `assertion failed: ${failing?.label ?? 'unknown'}`;
      failingStep = failing?.label ?? currentStep;
    }
  } catch (err) {
    const classified = classifyFailure(err, false);
    failureClass = classified.failureClass;
    failureMessage = classified.message;
    failingStep = currentStep;
    passed = false;
    try {
      screenshotPath = await captureFailureScreenshot(selection.driver, runDir);
    } catch {
      // screenshot is best-effort; the triage bundle still carries the log
    }
  } finally {
    // ── artifact finalization ─────────────────────────────────────────────
    type WithTrace = { stopTrace?: (path: string) => Promise<void> };
    const d = selection.driver as SimDriver & WithTrace;
    if (d.stopTrace) {
      const trace = join(runDir, 'trace.zip');
      await d.stopTrace(trace);
      try {
        readdirSync(runDir).includes('trace.zip') && (tracePath = trace);
      } catch {
        // ignore
      }
    }
    await selection.driver.close();

    // Video is flushed on browser close; find and normalize it.
    try {
      const webm = readdirSync(runDir).find((f) => f.endsWith('.webm'));
      if (webm) {
        const target = join(runDir, 'video.webm');
        renameSync(join(runDir, webm), target);
        videoPath = target;
      }
    } catch {
      // no video
    }

    // Real driver isolation self-test is the platform's own gate.
    if (selection.driver.kind === 'real' && typeof selection.driver.selfTest === 'function') {
      try {
        await selection.driver.selfTest();
      } catch (e) {
        failureClass = 'harness-defect';
        failureMessage = (failureMessage ? failureMessage + '; ' : '') + String(e);
        passed = false;
      }
    }
  }

  const result: RunResult = {
    opts,
    personaId: selection.persona.id,
    journeyId: selection.journey.id,
    driverKind: selection.driver.kind,
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    passed,
    failureClass,
    failureMessage,
    failingStep: failureClass === 'none' ? null : failingStep,
    assertCount: assertions.length,
    assertPassed: assertions.filter((a) => a.result === 'pass').length,
    seed: opts.seed,
    artifacts: {
      outDir: runDir,
      jsonl: '',
      junit: '',
      html: '',
      trace: tracePath,
      video: videoPath,
      screenshot: screenshotPath,
      appStderr: appStderrPath,
    },
  };

  result.artifacts.jsonl = writeJsonl(runDir, logs);
  result.artifacts.junit = writeJunit(runDir, [result]);
  result.artifacts.html = writeHtml(runDir, [result]);

  if (!passed && failureMessage) {
    writeTriageBundle({
      runDir,
      jsonlPath: result.artifacts.jsonl,
      screenshotPath,
      tracePath,
      videoPath,
      appStderrPath,
      console: consoleCapture,
      failureMessage,
    });
  }

  return result;
}

async function captureFailureScreenshot(driver: SimDriver, runDir: string): Promise<string | null> {
  if (!driver.page) return null;
  const shot = join(runDir, 'failure.png');
  await driver.page.screenshot({ path: shot, fullPage: true });
  return shot;
}