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
}

function fakeOps(log: OpsLog, writeError?: Error, removeError?: Error): HklmPolicyOps {
  return {
    write(key, valueName, data) {
      if (writeError) throw writeError;
      log.writes.push(`${key}\\${valueName}=${data}`);
    },
    remove(key, valueName) {
      if (removeError) throw removeError;
      log.removes.push(`${key}\\${valueName}`);
    },
  };
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
    const log: OpsLog = { writes: [], removes: [] };
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
    const log: OpsLog = { writes: [], removes: [] };
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
    const log: OpsLog = { writes: [], removes: [] };
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
    const log: OpsLog = { writes: [], removes: [] };
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
    const log: OpsLog = { writes: [], removes: [] };
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
    const log: OpsLog = { writes: [], removes: [] };
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

  it('still satisfies the SimDriver contract surface used by journeys', () => {
    const driver: SimDriver = new RealAppDriver({
      hklmOps: fakeOps({ writes: [], removes: [] }),
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
