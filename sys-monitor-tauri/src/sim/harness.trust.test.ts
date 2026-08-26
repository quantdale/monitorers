import { EventEmitter } from 'node:events';
import { mkdtempSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  createRunDirectory,
  evaluateJourneyOutcome,
  runJourney,
} from '../../e2e/sim/engine/runner';
import {
  createOwnedWorkDir,
  navigateToAppOrigin,
  readFileState,
  sameFileState,
  waitForCdpOrProcess,
} from '../../e2e/sim/drivers/RealAppDriver';
import { classifyFailure } from '../../e2e/sim/reporting/reports';
import { ClassifiedSimulationError } from '../../e2e/sim/errors';
import type { AssertionRecord, RunOptions, SimDriver } from '../../e2e/sim/types';
import type { RunSelection } from '../../e2e/sim/engine/runner';

const passingAssertion: AssertionRecord = { stepIndex: 1, label: 'visible', result: 'pass' };

function selection(): RunSelection {
  const driver: SimDriver = {
    kind: 'mock',
    page: null,
    launch: async () => {
      throw new Error('not used');
    },
    injectFault: async () => false,
    setSpeed: async () => undefined,
    restartApp: async () => undefined,
    close: async () => undefined,
  };
  return {
    driver,
    persona: {
      id: 'glancer',
      description: 'test',
      thinkTimeMs: [0, 0],
      dwellTimeMs: [0, 0],
      actionPreference: {},
      mistakes: { escapeDropdown: 0, misdrag: 0, wrongClick: 0 },
      faultReaction: 'ignore',
      variance: 0,
    },
    journey: { id: 'journey', title: 'test', supportedDrivers: ['mock'], personaIds: [], run: async () => undefined },
    scenario: { version: 1, speed: 1, disks: [], gpus: [] },
  };
}

function options(outDir: string): RunOptions {
  return { seed: 42, runId: 'run', lane: 'mock', speed: 1, outDir, deadlineMs: 1_000 };
}

describe('simulation pass contract', () => {
  it('rejects zero-assertion journeys', () => {
    const outcome = evaluateJourneyOutcome({
      assertions: [],
      consoleErrors: [],
      pageErrors: [],
      currentStep: 'journey',
    });
    expect(outcome).toMatchObject({ passed: false, failureClass: 'harness-defect' });
  });

  it('uses structured driver failure classes before regex fallback', () => {
    const classified = classifyFailure(
      new ClassifiedSimulationError('CDP process exited', 'harness-defect', 'cdp'),
      false,
    );
    expect(classified).toEqual({ failureClass: 'harness-defect', message: '[cdp] CDP process exited' });
  });

  it('rejects unexpected console errors and page errors', () => {
    const outcome = evaluateJourneyOutcome({
      assertions: [passingAssertion],
      consoleErrors: ['console exploded'],
      pageErrors: ['page exploded'],
      currentStep: 'journey',
    });
    expect(outcome).toMatchObject({ passed: false, failureClass: 'app-defect' });
    expect(outcome.failureMessage).toContain('console exploded');
    expect(outcome.failureMessage).toContain('page exploded');
  });

  it('requires explicit allowlists for intentional browser errors', () => {
    const outcome = evaluateJourneyOutcome({
      assertions: [passingAssertion],
      consoleErrors: ['known test warning'],
      pageErrors: ['known test page fault'],
      allowedConsoleErrors: [/known test warning/],
      allowedPageErrors: [/known test page fault/],
      currentStep: 'journey',
    });
    expect(outcome).toMatchObject({ passed: true, failureClass: 'none' });
  });

  it('keeps assertion failures as app failures', () => {
    const outcome = evaluateJourneyOutcome({
      assertions: [{ stepIndex: 1, label: 'order', result: 'fail', detail: 'wrong order' }],
      consoleErrors: [],
      pageErrors: [],
      currentStep: 'journey',
    });
    expect(outcome).toMatchObject({
      passed: false,
      failureClass: 'app-defect',
      failureMessage: 'wrong order',
      failingStep: 'order',
    });
  });
});

describe('simulation run and isolation boundaries', () => {
  it('keeps the app failure primary while preserving cleanup diagnostics and a screenshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'monitorers-cleanup-'));
    const page = {
      on: () => undefined,
      screenshot: async ({ path }: { path: string }) => writeFileSync(path, 'png'),
    } as never;
    const driver: SimDriver & { stopTrace: (path: string) => Promise<void> } = {
      ...selection().driver,
      page,
      launch: async () => ({ page, appStderrPath: null }),
      stopTrace: async () => { throw new Error('trace unavailable'); },
      close: async () => { throw new Error('browser close unavailable'); },
    };
    const runSelection: RunSelection = {
      ...selection(),
      driver,
      journey: {
        id: 'cleanup-preserves-app-failure',
        title: 'cleanup test',
        supportedDrivers: ['mock'],
        personaIds: [],
        run: async (ctx) => ctx.assert('original assertion', false, 'original app failure'),
      },
    };
    try {
      const result = await runJourney(options(root), runSelection);
      expect(result.passed).toBe(false);
      expect(result.failureClass).toBe('app-defect');
      expect(result.failureMessage).toContain('original app failure');
      expect(result.failureMessage).toContain('trace cleanup failed');
      expect(result.failureMessage).toContain('driver close failed');
      expect(result.artifacts.screenshot).not.toBeNull();
      expect(existsSync(result.artifacts.screenshot!)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('turns cleanup failures after an otherwise passing journey into a harness failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'monitorers-cleanup-pass-'));
    const page = { on: () => undefined } as never;
    const driver: SimDriver & { stopTrace: (path: string) => Promise<void> } = {
      ...selection().driver,
      page,
      launch: async () => ({ page, appStderrPath: null }),
      stopTrace: async () => { throw new Error('trace unavailable'); },
      close: async () => { throw new Error('browser close unavailable'); },
    };
    const runSelection: RunSelection = {
      ...selection(),
      driver,
      journey: {
        id: 'cleanup-pass-is-harness-failure',
        title: 'cleanup pass test',
        supportedDrivers: ['mock'],
        personaIds: [],
        run: async (ctx) => ctx.assert('meaningful assertion', true, 'ok'),
      },
    };
    try {
      const result = await runJourney(options(root), runSelection);
      expect(result.passed).toBe(false);
      expect(result.failureClass).toBe('harness-defect');
      expect(result.diagnostics).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns when the second fallback navigation succeeds', async () => {
    const candidates: string[] = [];
    const page = {
      waitForURL: async () => { throw new Error('initial target stayed blank'); },
      goto: async (url: string) => {
        candidates.push(url);
        if (candidates.length === 1) throw new Error('dev origin unavailable');
        return null;
      },
    } as never;
    await navigateToAppOrigin(page);
    expect(candidates).toEqual(['http://127.0.0.1:5180/', 'tauri://localhost/']);
  });

  it('rejects an app process that exits before CDP is ready', async () => {
    const process = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      spawnfile: string;
    };
    process.exitCode = null;
    process.spawnfile = 'fixture.exe';
    const pending = waitForCdpOrProcess(
      process as never,
      'http://127.0.0.1:1/json/version',
      1_000,
    );
    queueMicrotask(() => process.emit('exit', 17, null));
    await expect(pending).rejects.toMatchObject({
      failureClass: 'harness-defect',
      code: 'cdp',
    });
  });

  it('rejects a process spawn error through the launch promise', async () => {
    const process = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      spawnfile: string;
    };
    process.exitCode = null;
    process.spawnfile = 'fixture.exe';
    const pending = waitForCdpOrProcess(
      process as never,
      'http://127.0.0.1:1/json/version',
      1_000,
    );
    queueMicrotask(() => process.emit('error', new Error('access denied')));
    await expect(pending).rejects.toMatchObject({
      failureClass: 'harness-defect',
      code: 'spawn',
    });
  });

  it('refuses to overwrite a run directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'monitorers-run-dir-'));
    try {
      const runOptions = options(root);
      createRunDirectory(runOptions, selection());
      expect(() => createRunDirectory(runOptions, selection())).toThrow(/refusing overwrite/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses a fresh owned directory without touching a stale run directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'monitorers-owned-dir-'));
    const stale = join(root, 'sysmon-sim-run-stale');
    try {
      mkdirSync(stale, { recursive: true });
      writeFileSync(join(stale, 'sentinel'), 'keep');
      const fresh = createOwnedWorkDir(root, 'run');
      expect(fresh).not.toBe(stale);
      expect(existsSync(join(stale, 'sentinel'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('treats file creation, deletion, and modification as isolation failures', () => {
    const root = mkdtempSync(join(tmpdir(), 'monitorers-file-state-'));
    const path = join(root, 'settings.json');
    try {
      const absent = readFileState(path);
      expect(sameFileState(absent, readFileState(path))).toBe(true);

      writeFileSync(path, 'before');
      const existing = readFileState(path);
      expect(sameFileState(existing, readFileState(path))).toBe(true);
      rmSync(path);
      expect(sameFileState(absent, readFileState(path))).toBe(true);

      writeFileSync(path, 'created');
      expect(sameFileState(absent, readFileState(path))).toBe(false);
      writeFileSync(path, 'changed');
      expect(sameFileState(existing, readFileState(path))).toBe(false);
      rmSync(path);
      expect(sameFileState(existing, readFileState(path))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
