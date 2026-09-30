/**
 * Unit coverage for RealAppDriver's resource-lifecycle guarantees —
 * especially the SECURITY-CRITICAL unconditional removal of the machine-wide
 * WebView2 debug-args policy (HKLM). All registry traffic goes through an
 * injected HklmPolicyOps seam, so these tests never touch a real hive.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RealAppDriver,
  type HklmPolicyOps,
} from './RealAppDriver';
import type { SimDriver } from '../types';
import type { SimScenario } from '../../../src/sim/mockBackend';

// Only meaningful where the HKLM channel exists; skipped elsewhere (CI lane is
// windows-latest, so the suite runs there).
const describeOnWindows = process.platform === 'win32' ? describe : describe.skip;

interface OpsLog {
  writes: string[];
  removes: string[];
  reads: string[];
}

/**
 * A fake hive that behaves like the real one: `write` makes the value present,
 * `remove` makes it absent, `read` reports presence. Injecting an error into
 * write/remove reproduces registry refusals. No real hive is ever touched.
 *
 * `removeButKeepsPresent` models the case this change exists for: `reg delete`
 * reports success but the value is still readable afterwards.
 */
function fakeOps(
  log: OpsLog,
  writeError?: Error,
  removeError?: Error,
  removeButKeepsPresent = false,
): HklmPolicyOps {
  const present = new Set<string>();
  const id = (key: string, valueName: string): string => `${key}\\${valueName}`;
  return {
    write(key, valueName, data) {
      if (writeError) throw writeError;
      log.writes.push(`${key}\\${valueName}=${data}`);
      present.add(id(key, valueName));
    },
    remove(key, valueName) {
      log.removes.push(`${key}\\${valueName}`);
      if (removeError) throw removeError;
      if (!removeButKeepsPresent) present.delete(id(key, valueName));
    },
    read(key, valueName) {
      log.reads.push(`${key}\\${valueName}`);
      return present.has(id(key, valueName));
    },
  };
}

/** The private handlers this instance registered, for driving them in tests. */
function handlersOf(driver: RealAppDriver): Array<{ event: string; handler: () => void }> {
  return (
    driver as unknown as {
      policyRemovalHandlers: Array<{ event: string; handler: () => void }>;
    }
  ).policyRemovalHandlers;
}

/** Sets the private post-launch state close() operates on, without spawning. */
function primeRunState(driver: RealAppDriver, workDir: string | null): void {
  const internals = driver as unknown as {
    proc: null;
    browser: null;
    page: null;
    workDir: string | null;
    ownsWorkDir: boolean;
    hklmArgsValueWritten: boolean;
    appStderrPath: string | null;
  };
  internals.proc = null;
  internals.browser = null;
  internals.page = null;
  internals.workDir = workDir;
  internals.ownsWorkDir = workDir !== null;
  internals.hklmArgsValueWritten = true;
  internals.appStderrPath = null;
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'sysmon-driver-test-'));
}

describeOnWindows('RealAppDriver WebView2 policy lifecycle', () => {
  it('applies the policy and removes it after a normal close', async () => {
    const log: OpsLog = { writes: [], removes: [], reads: [] };
    const driver = new RealAppDriver({ hklmOps: fakeOps(log) });
    (driver as unknown as { env: Record<string, string> }).env = {
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0 --remote-allow-origins=*',
    };
    const applied = (
      driver as unknown as { applyHklmArgsFallback(): boolean }
    ).applyHklmArgsFallback();
    expect(applied).toBe(true);
    expect(log.writes).toHaveLength(1);

    primeRunState(driver, tempRoot());
    await expect(driver.close()).resolves.toBeUndefined();
    expect(log.removes).toHaveLength(1);
  });

  it('close() removes the policy even when process close fails', async () => {
    const log: OpsLog = { writes: [], removes: [], reads: [] };
    const driver = new (class extends RealAppDriver {
      override async closeProcess(): Promise<void> {
        throw new Error('browser.close exploded');
      }
    })({ hklmOps: fakeOps(log) });
    primeRunState(driver, null);

    await expect(driver.close()).rejects.toThrow(/process close failed/);
    expect(log.removes).toHaveLength(1); // security cleanup RAN despite the failure
  });

  it('close() removes the policy even when work-directory deletion fails', async () => {
    const log: OpsLog = { writes: [], removes: [], reads: [] };
    const driver = new (class extends RealAppDriver {
      protected override async cleanupWorkDir(): Promise<void> {
        throw new Error('EBUSY: resource busy');
      }
    })({ hklmOps: fakeOps(log) });
    primeRunState(driver, tempRoot());

    await expect(driver.close()).rejects.toThrow(/work directory cleanup failed/);
    expect(log.removes).toHaveLength(1);
  });

  it('aggregates multiple cleanup failures instead of masking them', async () => {
    const log: OpsLog = { writes: [], removes: [], reads: [] };
    const driver = new (class extends RealAppDriver {
      override async closeProcess(): Promise<void> {
        throw new Error('first');
      }
      protected override async cleanupWorkDir(): Promise<void> {
        throw new Error('second');
      }
    })({
      hklmOps: fakeOps(log, undefined, new Error('reg delete denied')),
    });
    primeRunState(driver, tempRoot());

    // All three failures surface together; the removal was ATTEMPTED exactly
    // once even though the registry seam refused it.
    await expect(driver.close()).rejects.toThrow(
      /process close failed.*second.*debug-policy removal failed.*reg delete denied/s
    );
  });

  it('never attempts removal when the policy write was refused (access denied)', async () => {
    const log: OpsLog = { writes: [], removes: [], reads: [] };
    const driver = new RealAppDriver({
      hklmOps: fakeOps(log, new Error('Access is denied.')),
    });
    (driver as unknown as { env: Record<string, string> }).env = {
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0',
    };
    const applied = (
      driver as unknown as { applyHklmArgsFallback(): boolean }
    ).applyHklmArgsFallback();
    expect(applied).toBe(false);
    expect(log.writes).toHaveLength(0);

    primeRunState(driver, null);
    // Nothing was written machine-wide, so teardown must not touch the hive.
    (driver as unknown as { hklmArgsValueWritten: boolean }).hklmArgsValueWritten = false;
    await expect(driver.close()).resolves.toBeUndefined();
    expect(log.removes).toHaveLength(0);
  });

  it('launch failure AFTER policy application still removes the policy on close', async () => {
    const log: OpsLog = { writes: [], removes: [], reads: [] };
    const workRoot = tempRoot();
    const driver = new RealAppDriver({
      appExe: join(tmpdir(), 'definitely-missing-sysmon.exe'),
      workRoot,
      extraEnv: { SIM_CDP_TIMEOUT: '1500' },
      hklmOps: fakeOps(log),
    });

    const scenario: SimScenario = { version: 1 };
    const outDir = join(workRoot, 'out');
    mkdirSync(outDir, { recursive: true });
    let launchThrew = false;
    try {
      await driver.launch('run-spawn-fail', scenario, outDir);
    } catch (error) {
      launchThrew = true;
      expect(String(error)).toMatch(/spawn|CDP|exited/i);
    }
    expect(launchThrew).toBe(true);
    expect(log.writes.length).toBeGreaterThanOrEqual(1); // applied BEFORE spawn

    await driver.close(); // must clean up unconditionally after the failed launch
    expect(log.removes).toHaveLength(1);
  });

  it('fails the run, naming key and value, when the value is STILL PRESENT after removal', async () => {
    const log: OpsLog = { writes: [], removes: [], reads: [] };
    // Models `reg delete` reporting success while the value stays readable:
    // the first removal is refused by the fake hive, a later one succeeds.
    let keepPresent = true;
    const present = new Set<string>();
    const ops: HklmPolicyOps = {
      write(key, valueName, data) {
        log.writes.push(`${key}\\${valueName}=${data}`);
        present.add(`${key}\\${valueName}`);
      },
      remove(key, valueName) {
        log.removes.push(`${key}\\${valueName}`);
        if (!keepPresent) present.delete(`${key}\\${valueName}`);
      },
      read(key, valueName) {
        log.reads.push(`${key}\\${valueName}`);
        return present.has(`${key}\\${valueName}`);
      },
    };
    const driver = new RealAppDriver({ hklmOps: ops });
    (driver as unknown as { env: Record<string, string> }).env = {
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0',
    };
    (driver as unknown as { applyHklmArgsFallback(): boolean }).applyHklmArgsFallback();
    primeRunState(driver, null);

    // Removal was attempted AND read back — the run must not report success.
    await expect(driver.close()).rejects.toThrow(/STILL PRESENT/);
    await expect(driver.close()).rejects.toThrow(
      /HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments\\\*/,
    );
    expect(log.removes.length).toBeGreaterThanOrEqual(1);
    expect(log.reads.length).toBeGreaterThanOrEqual(1);
    // Ownership is NOT released while the value is still there.
    expect((driver as unknown as { hklmArgsValueWritten: boolean }).hklmArgsValueWritten).toBe(true);

    // Clean up this test's listeners: let removal succeed and drive the
    // registered termination handler.
    keepPresent = false;
    const sigint = handlersOf(driver).find((h) => h.event === 'SIGINT');
    expect(sigint).toBeDefined();
    sigint!.handler();
    expect((driver as unknown as { hklmArgsValueWritten: boolean }).hklmArgsValueWritten).toBe(false);
    expect(handlersOf(driver)).toHaveLength(0);
  });

  it('reports success when the value is confirmed absent after removal', async () => {
    const log: OpsLog = { writes: [], removes: [], reads: [] };
    const driver = new RealAppDriver({ hklmOps: fakeOps(log) });
    (driver as unknown as { env: Record<string, string> }).env = {
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0',
    };
    (driver as unknown as { applyHklmArgsFallback(): boolean }).applyHklmArgsFallback();
    primeRunState(driver, null);

    await expect(driver.close()).resolves.toBeUndefined();
    expect(log.removes).toHaveLength(1);
    // Removal is VERIFIED, not assumed: the value was read back at least once.
    expect(log.reads).toHaveLength(1);
    expect(log.reads[0]).toContain('AdditionalBrowserArguments');
    expect((driver as unknown as { hklmArgsValueWritten: boolean }).hklmArgsValueWritten).toBe(false);
  });

  it('a registered termination handler removes the value on its own', async () => {
    const log: OpsLog = { writes: [], removes: [], reads: [] };
    const driver = new RealAppDriver({ hklmOps: fakeOps(log) });
    (driver as unknown as { env: Record<string, string> }).env = {
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0',
    };
    (driver as unknown as { applyHklmArgsFallback(): boolean }).applyHklmArgsFallback();

    // Handlers exist only once the value is machine-wide.
    const registered = handlersOf(driver);
    expect(registered.map((h) => h.event).sort()).toEqual(
      ['SIGINT', 'SIGTERM', 'exit', 'uncaughtException'].sort(),
    );
    expect(log.removes).toHaveLength(0);

    // Drive the SIGINT handler directly: a Ctrl-C that never reaches close().
    const sigint = registered.find((h) => h.event === 'SIGINT');
    expect(sigint).toBeDefined();
    sigint!.handler();

    expect(log.removes).toHaveLength(1);
    expect(log.reads).toHaveLength(1);
    expect((driver as unknown as { hklmArgsValueWritten: boolean }).hklmArgsValueWritten).toBe(false);
  });

  it('unregisters its handlers once removal is confirmed, so exit makes no second attempt', async () => {
    const log: OpsLog = { writes: [], removes: [], reads: [] };
    const driver = new RealAppDriver({ hklmOps: fakeOps(log) });
    // Baseline captured BEFORE the value is applied, i.e. before any handler
    // exists for this instance.
    const before = {
      SIGINT: process.listenerCount('SIGINT'),
      SIGTERM: process.listenerCount('SIGTERM'),
      exit: process.listenerCount('exit'),
    };
    (driver as unknown as { env: Record<string, string> }).env = {
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0',
    };
    (driver as unknown as { applyHklmArgsFallback(): boolean }).applyHklmArgsFallback();

    expect(process.listenerCount('SIGINT')).toBe(before.SIGINT + 1);

    const registered = handlersOf(driver);
    registered.find((h) => h.event === 'SIGINT')!.handler();

    // All four listeners are gone again.
    expect(handlersOf(driver)).toHaveLength(0);
    expect(process.listenerCount('SIGINT')).toBe(before.SIGINT);
    expect(process.listenerCount('SIGTERM')).toBe(before.SIGTERM);
    expect(process.listenerCount('exit')).toBe(before.exit);

    // Re-driving a now-unregistered handler is a no-op: ownership was released.
    registered.find((h) => h.event === 'SIGINT')!.handler();
    registered.find((h) => h.event === 'exit')!.handler();
    expect(log.removes).toHaveLength(1);
  });

  it('still satisfies the SimDriver contract surface used by journeys', () => {
    const driver: SimDriver = new RealAppDriver({
      hklmOps: fakeOps({ writes: [], removes: [], reads: [] }),
    });
    expect(driver.kind).toBe('real');
    expect(typeof driver.injectFault).toBe('function');
    expect(typeof driver.setSpeed).toBe('function');
    expect(typeof driver.restartApp).toBe('function');
    // Real-driver-only isolation/reporting API stays part of the surface.
    const real = driver as RealAppDriver;
    expect(typeof real.selfTest).toBe('function');
    expect(typeof real.copySettingsTo).toBe('function');
  });
});
