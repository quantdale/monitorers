/**
 * Journey runner — executes a (persona × journey × driver) combination and
 * produces a complete RunResult with artifacts (JSONL, JUnit, HTML, triage).
 * Deterministic: the seed is fixed per run; the persona draws all timings and
 * decisions from the seeded PRNG, and the run header logs seed + persona +
 * journey + driver so a failure reproduces locally from the header alone.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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
  ReloadGuardSession,
} from '../types';
import type { SimScenario } from '../../../src/sim/mockBackend';
import { mulberry32 } from './prng';
import { thinkWait, dwellWait } from './behavior';
import { ClassifiedSimulationError } from '../errors';
import { assertNoOrphanProcesses } from '../drivers/processGuard';
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

export interface JourneyOutcomeInput {
  assertions: AssertionRecord[];
  consoleErrors: string[];
  pageErrors: string[];
  allowedConsoleErrors?: RegExp[];
  allowedPageErrors?: RegExp[];
  currentStep: string;
}

export interface JourneyOutcome {
  passed: boolean;
  failureClass: Exclude<FailureClass, 'none'> | 'none';
  failureMessage: string | null;
  failingStep: string | null;
}

/**
 * Applies the runner's pass contract without requiring a browser. Keeping
 * this decision pure makes the false-green rules directly testable:
 * meaningful assertions are mandatory, and unexpected browser errors always
 * fail the journey unless an explicit journey-scoped allowlist matches.
 */
export function evaluateJourneyOutcome(input: JourneyOutcomeInput): JourneyOutcome {
  const unexpectedConsole = input.consoleErrors.filter(
    (message) => !input.allowedConsoleErrors?.some((pattern) => pattern.test(message))
  );
  const unexpectedPage = input.pageErrors.filter(
    (message) => !input.allowedPageErrors?.some((pattern) => pattern.test(message))
  );
  if (unexpectedConsole.length || unexpectedPage.length) {
    return {
      passed: false,
      failureClass: 'app-defect',
      failureMessage: `unexpected browser errors: ${[...unexpectedConsole, ...unexpectedPage].join(' | ')}`,
      failingStep: input.currentStep,
    };
  }
  if (input.assertions.length === 0) {
    return {
      passed: false,
      failureClass: 'harness-defect',
      failureMessage: 'journey completed with zero meaningful assertions',
      failingStep: input.currentStep,
    };
  }
  const failing = input.assertions.find((assertion) => assertion.result === 'fail');
  if (failing) {
    return {
      passed: false,
      failureClass: 'app-defect',
      failureMessage: failing.detail ?? `assertion failed: ${failing.label}`,
      failingStep: failing.label,
    };
  }
  return { passed: true, failureClass: 'none', failureMessage: null, failingStep: null };
}

function pathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function createRunDirectory(opts: RunOptions, selection: RunSelection): string {
  const name = [
    pathSegment(opts.runId),
    pathSegment(opts.lane),
    pathSegment(selection.driver.kind),
    pathSegment(selection.journey.id),
    pathSegment(selection.persona.id),
    `seed-${opts.seed}`,
  ].join('__');
  const runDir = join(opts.outDir, name);
  if (existsSync(runDir)) {
    throw new Error(`harness run directory already exists; refusing overwrite: ${runDir}`);
  }
  mkdirSync(runDir, { recursive: true });
  return runDir;
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
  const runDir = createRunDirectory(opts, selection);

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
  const diagnostics: string[] = [];
  let reloadSession: ReloadGuardSession | null = null;

  const appendDiagnostic = (message: string): void => {
    diagnostics.push(message);
  };

  const setPrimaryFailure = (kind: Exclude<FailureClass, 'none'>, message: string, step: string): void => {
    if (failureClass === 'none') {
      failureClass = kind;
      failureMessage = message;
      failingStep = step;
    } else {
      appendDiagnostic(message);
    }
    passed = false;
  };

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
    consoleCapture = { messages: [], pageErrors: [] };
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleCapture?.messages.push({ type: msg.type(), text: msg.text() });
      }
    });
    page.on('pageerror', (err) => {
      consoleCapture?.pageErrors.push(String(err));
    });

    currentStep = `journey:${selection.journey.id}`;
    logLine('step-start', { label: currentStep });
    // Fail-fast reload guard: a Vite HMR full reload (or stray navigation)
    // wipes the page mid-journey and previously surfaced as foreign console
    // errors attributed to the app. Race the journey against the guard so the
    // defect is attributed to the harness the moment it happens.
    reloadSession = selection.driver.guardUnexpectedReload?.() ?? null;
    const guard = reloadSession;
    const journeyPromise = selection.journey.run(ctx);
    // No-op consumer: when the reload guard wins the race below, the losing
    // journey promise may still reject (its page just navigated away) — that
    // late rejection must not become an unhandled one. The race remains the
    // real consumer for the normal path.
    journeyPromise.catch(() => {});
    if (guard) await Promise.race([journeyPromise, guard.failure]);
    else await journeyPromise;
    logLine('step-end', { label: currentStep });

    // Belt and braces: a violation recorded but not fatalized through the
    // race (e.g. it landed between journey completion and this check) still
    // fails the run as a harness defect.
    const lateViolations = guard?.drainViolations() ?? [];
    if (lateViolations.length > 0) {
      throw new ClassifiedSimulationError(
        `unexpected page navigation/reload completed during the journey: ${lateViolations.join(' | ')}`,
        'harness-defect',
        'config',
      );
    }

    const outcome = evaluateJourneyOutcome({
      assertions,
      consoleErrors: (consoleCapture?.messages ?? []).map((message) => message.text),
      pageErrors: consoleCapture?.pageErrors ?? [],
      allowedConsoleErrors: selection.journey.allowedConsoleErrors,
      allowedPageErrors: selection.journey.allowedPageErrors,
      currentStep,
    });
    if (outcome.passed) {
      passed = true;
    } else if (outcome.failureClass !== 'none' && outcome.failureMessage) {
      setPrimaryFailure(outcome.failureClass, outcome.failureMessage, outcome.failingStep ?? currentStep);
    }
  } catch (err) {
    const classified = classifyFailure(err, false);
    setPrimaryFailure(classified.failureClass, classified.message, currentStep);
  } finally {
    // ── artifact finalization ─────────────────────────────────────────────
    // Stop watching for reloads before teardown navigations begin.
    reloadSession?.dispose();
    reloadSession = null;
    type WithTrace = { stopTrace?: (path: string) => Promise<void> };
    const d = selection.driver as SimDriver & WithTrace;

    // Flush the log BEFORE any cleanup runs: if the process dies or the test
    // harness times out during screenshot/trace/close below, the partial
    // run.jsonl (with the reproduction header) still lands on disk. The
    // final writeJsonl below overwrites this with the complete log.
    try {
      writeJsonl(runDir, logs);
    } catch (error) {
      appendDiagnostic(`partial jsonl flush failed: ${String(error)}`);
    }

    if (!passed && !screenshotPath) {
      try {
        screenshotPath = await captureFailureScreenshot(selection.driver, runDir);
      } catch (error) {
        appendDiagnostic(`failure screenshot capture failed: ${String(error)}`);
      }
    }

    if (d.stopTrace) {
      const trace = join(runDir, 'trace.zip');
      try {
        await d.stopTrace(trace);
        if (readdirSync(runDir).includes('trace.zip')) tracePath = trace;
        else appendDiagnostic('trace stop completed without producing trace.zip');
      } catch (error) {
        appendDiagnostic(`trace cleanup failed: ${String(error)}`);
      }
    }
    try {
      await selection.driver.close();
    } catch (error) {
      appendDiagnostic(`driver close failed: ${String(error)}`);
    }

    // Video is flushed on browser close; find and normalize it.
    try {
      const webm = readdirSync(runDir).find((f) => f.endsWith('.webm'));
      if (webm) {
        const target = join(runDir, 'video.webm');
        copyFileSync(join(runDir, webm), target);
        videoPath = target;
      }
    } catch (error) {
      appendDiagnostic(`video artifact finalization failed: ${String(error)}`);
    }

    // Real driver isolation self-test is the platform's own gate.
    if (selection.driver.kind === 'real' && typeof selection.driver.selfTest === 'function') {
      try {
        await selection.driver.selfTest();
      } catch (e) {
        setPrimaryFailure('harness-defect', `driver self-test failed: ${String(e)}`, currentStep);
      }
    }

    // Real-lane orphan guard: after close(), no process of the launched exe
    // may survive. Same guarantee the packaged qualification asserts; applied
    // here so EVERY real-driver journey (including relaunch journeys) carries it.
    if (selection.driver.kind === 'real') {
      const exePath = (selection.driver as unknown as { appExePath?: string }).appExePath;
      if (exePath) {
        try {
          await assertNoOrphanProcesses(exePath);
        } catch (e) {
          setPrimaryFailure('harness-defect', `orphan-process guard failed: ${String(e)}`, currentStep);
        }
      }
    }

    if (diagnostics.length > 0) {
      if (passed) {
        setPrimaryFailure(
          'harness-defect',
          `harness cleanup/isolation diagnostics failed: ${diagnostics.join(' | ')}`,
          currentStep,
        );
      } else if (failureMessage) {
        failureMessage = `${failureMessage}; diagnostics: ${diagnostics.join(' | ')}`;
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
    diagnostics,
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
  // A wedged browser must not hang artifact finalization; bounded like the
  // driver teardown paths.
  const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000));
  const taken = driver.page.screenshot({ path: shot, fullPage: true }).then(() => shot);
  return Promise.race([taken, timer]);
}
