import { EventEmitter } from 'node:events';
import { mkdtempSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
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
import { waitForCards } from '../../e2e/sim/engine/steps';
import type { SimContext } from '../../e2e/sim/types';

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
  it('rejects enough dynamic cards when required core metrics never render', async () => {
    vi.useFakeTimers();
    const assert = vi.fn();
    const ctx = {
      driver: { page: { evaluate: async () => ['gpu_a', 'gpu_b', 'disk_C:'] } },
      assert,
    } as unknown as SimContext;
    try {
      const pending = waitForCards(ctx, 3, 200);
      await vi.advanceTimersByTimeAsync(300);
      await pending;
      expect(assert).toHaveBeenCalledWith('cards-settled(>=3)', false, expect.any(String));
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts the restored expected set when a core card was deliberately hidden', async () => {
    const assert = vi.fn();
    const ctx = {
      driver: { page: { evaluate: async () => ['memory', 'network', 'disk_C:'] } },
      assert,
    } as unknown as SimContext;
    await waitForCards(ctx, 3, 200, ['memory', 'network', 'disk_C:']);
    expect(assert).toHaveBeenCalledWith('cards-settled(>=3)', true, expect.any(String));
  });

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
  it.each(['rejection', 'timeout'] as const)('releases the screenshot deadline after %s', async (outcome) => {
    vi.useFakeTimers();
    const root = mkdtempSync(join(tmpdir(), 'monitorers-screenshot-'));
    const page = {
      on: () => undefined,
      screenshot: outcome === 'rejection'
        ? async () => { throw new Error('screenshot refused'); }
        : () => new Promise(() => {}),
    } as never;
    const chosen = selection();
    chosen.driver = { ...chosen.driver, page, launch: async () => ({ page, appStderrPath: null }) };
    chosen.journey.run = async (ctx) => ctx.assert('original failure', false, 'app failed');
    try {
      const pending = runJourney(options(root), chosen);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.passed).toBe(false);
      expect(result.artifacts.screenshot).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
      vi.useRealTimers();
    }
  });

  it('keeps the app failure primary while preserving cleanup diagnostics and a screenshot', async () => {
    vi.useFakeTimers();
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
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
      vi.useRealTimers();
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

  it('aborts a hanging CDP request when the app process exits', async () => {
    let aborted = false;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true });
    }));
    const proc = Object.assign(new EventEmitter(), { exitCode: null, spawnfile: 'fixture.exe' });
    try {
      const pending = waitForCdpOrProcess(proc as never, 'http://127.0.0.1:1/json/version', 10_000);
      queueMicrotask(() => proc.emit('exit', 17, null));
      await expect(pending).rejects.toMatchObject({ code: 'cdp' });
      expect(aborted).toBe(true);
      expect(proc.listenerCount('exit')).toBe(0);
      expect(proc.listenerCount('error')).toBe(0);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('bounds a CDP fetch that accepts the connection but never answers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const proc = Object.assign(new EventEmitter(), { exitCode: null, spawnfile: 'fixture.exe' });
    try {
      await expect(waitForCdpOrProcess(proc as never, 'http://127.0.0.1:1/json/version', 20)).rejects.toMatchObject({ code: 'cdp' });
      expect(proc.listenerCount('exit')).toBe(0);
    } finally {
      fetchMock.mockRestore();
    }
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
