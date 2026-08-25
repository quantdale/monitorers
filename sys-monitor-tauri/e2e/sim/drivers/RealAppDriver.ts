/**
 * RealAppDriver — the packaged-app SimDriver.
 *
 * Launches the built Tauri app with WebView2 remote debugging enabled via
 * environment variables (loopback-only, env-gated — never in shipped config),
 * attaches Playwright over CDP, and drives the real backend: real Tauri IPC,
 * real `settings.json` persistence, real sensors.
 *
 * Isolation guarantees (task 2.2 / 2.5):
 *  - Every run gets a fresh temp work dir; the child's `APPDATA` (where the
 *    plugin-store writes `settings.json`) and `WEBVIEW2_USER_DATA_FOLDER` are
 *    redirected there, so a developer's real store is never touched.
 *  - The debug port is allocated per run (never a fixed port).
 *  - `selfTest()` snapshots the developer's real store path before launch and
 *    verifies it is byte-identical after the run.
 *
 * The real app does not run the browser side of the simulation bridge, so:
 *  - `injectFault`/`setSpeed` are unsupported (return false / no-op) — real
 *    backend faults are whatever the hardware does, and fault journeys that
 *    need scripted faults keep to the mock lane (see the register discipline).
 *  - `restartApp()` relaunches the process with the SAME temp app-data dir so
 *    settings persistence round-trips across a true relaunch.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { chromium, type Browser, type Page } from '@playwright/test';
import type { SimDriver, DriverLaunchResult } from '../types';
import type { SimFault, SimScenario } from '../../../src/sim/mockBackend';
import { ClassifiedSimulationError } from '../errors';

export const APP_IDENTIFIER = 'com.quantdale.systemmonitor';

export interface RealDriverOptions {
  /** Path to the built app exe. Defaults to SIM_APP_EXE or the release exe. */
  appExe?: string;
  /** Root dir for per-run temp work dirs. Defaults to os.tmpdir(). */
  workRoot?: string;
  /** Extra env vars for the child (e.g. SYSMON_CADENCE_LOG). */
  extraEnv?: Record<string, string>;
  /** Keep the temp work dir after close (for triage). Debug helper. */
  keepWorkDir?: boolean;
}

export function resolveAppExe(explicit?: string): string {
  if (explicit) return explicit;
  const fromEnv = process.env.SIM_APP_EXE;
  if (fromEnv) return fromEnv;
  const candidates = [
    join(process.cwd(), 'src-tauri', 'target', 'release', 'sys-monitor-tauri.exe'),
    join(process.cwd(), 'src-tauri', 'target', 'debug', 'sys-monitor-tauri.exe'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    'RealAppDriver: no built app exe found. Build one first (e.g. `npm run tauri build` ' +
      'or a cargo build in src-tauri/) or set SIM_APP_EXE.'
  );
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** Polls a CDP endpoint until it responds (app/driver bring-up). */
async function waitForCdp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new ClassifiedSimulationError(
    `RealAppDriver: CDP endpoint ${url} did not come up within ${timeoutMs}ms` + (lastErr ? ` (${String(lastErr)})` : ''),
    'harness-defect',
    'cdp',
  );
}

export async function waitForCdpOrProcess(proc: ChildProcess, url: string, timeoutMs: number): Promise<void> {
  let ready = false;
  let settled = false;
  let rejectExit: ((error: Error) => void) | null = null;
  const processFailure = new Promise<never>((_, reject) => {
    rejectExit = reject;
  });
  const onError = (error: Error): void => {
    if (!settled) {
      rejectExit?.(
        new ClassifiedSimulationError(
          `RealAppDriver: failed to spawn ${proc.spawnfile}: ${error.message}`,
          'harness-defect',
          'spawn',
        ),
      );
    }
  };
  const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (!settled && !ready) {
      rejectExit?.(
        new ClassifiedSimulationError(
          `RealAppDriver: app exited before CDP was ready (code=${String(code)}, signal=${String(signal)})`,
          'harness-defect',
          'cdp',
        ),
      );
    }
  };
  if (proc.exitCode !== null) {
    throw new ClassifiedSimulationError(
      `RealAppDriver: app exited before CDP was ready (code=${String(proc.exitCode)})`,
      'harness-defect',
      'cdp',
    );
  }
  proc.once('error', onError);
  proc.once('exit', onExit);
  try {
    await Promise.race([
      waitForCdp(url, timeoutMs).then(() => {
        ready = true;
      }),
      processFailure,
    ]);
  } finally {
    settled = true;
    proc.off('error', onError);
    proc.off('exit', onExit);
  }
}

export interface FileState {
  exists: boolean;
  bytes: Buffer | null;
}

export function readFileState(path: string): FileState {
  return existsSync(path) ? { exists: true, bytes: readFileSync(path) } : { exists: false, bytes: null };
}

export function sameFileState(before: FileState, after: FileState): boolean {
  if (before.exists !== after.exists) return false;
  if (!before.exists) return true;
  return before.bytes?.equals(after.bytes ?? Buffer.alloc(0)) ?? false;
}

function safeRunId(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function createOwnedWorkDir(root: string, runId: string): string {
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, `sysmon-sim-${safeRunId(runId)}-`));
}

/** Wait for the app target, then return as soon as a known fallback succeeds. */
export async function navigateToAppOrigin(page: Page): Promise<void> {
  const appUrl = /(127\.0\.0\.1:5180|tauri)/;
  try {
    await page.waitForURL(appUrl, { timeout: 15_000 });
    return;
  } catch {
    const tried: string[] = [];
    for (const candidate of ['http://127.0.0.1:5180/', 'tauri://localhost/']) {
      tried.push(candidate);
      try {
        await page.goto(candidate, { waitUntil: 'domcontentloaded', timeout: 10_000 });
        return;
      } catch {
        // Try the next known origin.
      }
    }
    throw new ClassifiedSimulationError(
      `RealAppDriver: page did not reach the app origin (tried ${tried.join(', ')})`,
      'harness-defect',
      'cdp',
    );
  }
}

async function validateAppPage(page: Page): Promise<void> {
  await page.waitForSelector('#root', { state: 'attached', timeout: 30_000 });
  const bridge = await page.evaluate(() => ({
    hasTauriBridge: typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined',
    // The simulation bridge must NEVER be live here: its presence means the
    // webview is showing the Vite mock harness (e.g. via the dev-origin
    // fallback while a stray dev server runs), and the lane would silently
    // drive mock data instead of the real backend.
    hasSimBridge: typeof (window as Window & { __SIM__?: unknown }).__SIM__ !== 'undefined',
  }));
  if (!bridge.hasTauriBridge) {
    throw new ClassifiedSimulationError(
      'RealAppDriver: app page has no Tauri IPC bridge',
      'harness-defect',
      'cdp',
    );
  }
  if (bridge.hasSimBridge) {
    throw new ClassifiedSimulationError(
      'RealAppDriver: mock simulation bridge present on the real-app page (wrong origin/document)',
      'harness-defect',
      'isolation',
    );
  }
}

export class RealAppDriver implements SimDriver {
  readonly kind = 'real' as const;
  page: Page | null = null;

  private options: RealDriverOptions;
  private appExe: string;
  private proc: ChildProcess | null = null;
  private browser: Browser | null = null;
  private workDir: string | null = null;
  private runId: string | null = null;
  private env: Record<string, string> = {};
  private port: number | null = null;
  private appStderrPath: string | null = null;
  private realSettingsPath: string | null = null;
  private realSettingsBefore: FileState | null = null;
  private ownsWorkDir = false;

  constructor(options: RealDriverOptions = {}) {
    this.options = options;
    this.appExe = resolveAppExe(options.appExe);
  }

  /** Absolute path of the current run's temp app-data dir (settings.json here). */
  get appDataDir(): string | null {
    return this.workDir ? join(this.workDir, 'appdata') : null;
  }

  get appTempRoot(): string | null {
    return this.workDir;
  }

  /** The developer's real settings.json path (for the isolation self-test). */
  get realSettingsPathValue(): string | null {
    return this.realSettingsPath;
  }

  /** Path of the current run's captured app stderr (diagnostics on failure). */
  get appStderrPathValue(): string | null {
    return this.appStderrPath;
  }

  private async initRun(runId: string, outDir: string): Promise<void> {
    const root = this.options.workRoot ?? tmpdir();
    // Reuse an existing work dir on restart so settings.json persists across
    // the relaunch; otherwise create a fresh per-run dir.
    if (!this.workDir) {
      this.workDir = createOwnedWorkDir(root, runId);
      this.ownsWorkDir = true;
    }
    mkdirSync(join(this.workDir, 'appdata'), { recursive: true });
    mkdirSync(join(this.workDir, 'wv2'), { recursive: true });
    this.port = await freePort();
    this.appStderrPath = join(outDir, 'app-stderr.log');

    if (!this.realSettingsPath) {
      const realAppData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming');
      this.realSettingsPath = join(realAppData, APP_IDENTIFIER, 'settings.json');
      this.realSettingsBefore = readFileState(this.realSettingsPath);
    }

    this.env = {
      ...process.env,
      APPDATA: join(this.workDir, 'appdata'),
      WEBVIEW2_USER_DATA_FOLDER: join(this.workDir, 'wv2'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${this.port} --remote-allow-origins=*`,
      // Env-gated store override: the frontend reads this and loads the
      // settings store from an absolute path under this run's temp app-data
      // dir, so the developer's real settings.json is never written.
      SYSMON_SIM_APP_DATA: join(this.workDir, 'appdata'),
      ...(this.options.extraEnv ?? {}),
    };
  }

  async launch(runId: string, _scenario: SimScenario, outDir?: string): Promise<DriverLaunchResult> {
    this.runId = runId;
    await this.initRun(runId, outDir ?? process.cwd());
    const stderrFd = this.appStderrPath ? openSync(this.appStderrPath, 'w') : undefined;
    try {
      this.proc = spawn(this.appExe, [], { env: this.env, stdio: ['ignore', 'ignore', stderrFd ?? 'ignore'] });
    } catch (error) {
      if (stderrFd !== undefined) closeSync(stderrFd);
      throw new ClassifiedSimulationError(
        `RealAppDriver: failed to spawn ${this.appExe}: ${String(error)}`,
        'harness-defect',
        'spawn',
      );
    }
    if (stderrFd !== undefined) closeSync(stderrFd);

    const cdpUrl = `http://127.0.0.1:${this.port}/json/version`;
    await waitForCdpOrProcess(
      this.proc,
      cdpUrl,
      this.options.extraEnv?.SIM_CDP_TIMEOUT ? Number(this.options.extraEnv.SIM_CDP_TIMEOUT) : 60_000
    );

    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`);
    const context = this.browser.contexts()[0];
    const page = context?.pages()[0] ?? (await context?.newPage());
    if (!page) {
      throw new ClassifiedSimulationError(
        'RealAppDriver: no page target found after CDP attach',
        'harness-defect',
        'cdp',
      );
    }
    this.page = page;

    // The WebView2 target can still be `about:blank` at attach time (the app
    // navigates to its frontend a moment later). Wait for the app origin; if
    // it never arrives (stale/blank target), navigate it ourselves — Tauri v2
    // re-injects its IPC bridge into every document of the app webview, so a
    // driver-initiated navigation stays a fully functional app page.
    await navigateToAppOrigin(page);
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
    await validateAppPage(page);
    return { page, appStderrPath: this.appStderrPath };
  }

  async injectFault(_fault: SimFault): Promise<boolean> {
    // The real app does not run the mock bridge; faults are whatever the real
    // backend does. Registered as an undrivable step on this lane.
    return false;
  }

  async setSpeed(_factor: number): Promise<void> {
    // Real backend ticks in real time (owned by the cadence probe).
  }

  async restartApp(): Promise<void> {
    if (!this.page) return;
    // Reuse the same workDir + runId so settings.json persists across the
    // relaunch (initRun reuses an existing workDir).
    const runId = this.runId ?? 'run';
    const outDir = this.appStderrPath ? join(this.appStderrPath, '..') : process.cwd();
    await this.closeProcess();
    await this.launch(runId, { version: 1 }, outDir);
  }

  private async closeProcess(): Promise<void> {
    let closeError: unknown = null;
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        closeError = error;
      }
      this.browser = null;
    }
    this.page = null;
    const proc = this.proc;
    if (proc && !proc.killed) {
      await new Promise<void>((resolve) => {
        if (proc.exitCode !== null) {
          resolve();
          return;
        }
        const timer = setTimeout(resolve, 2_000);
        proc.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        proc.kill();
      });
      if (proc.exitCode === null) {
        proc.kill('SIGKILL');
      }
    }
    this.proc = null;
    if (closeError) throw new Error(`RealAppDriver: browser close failed: ${String(closeError)}`);
  }

  async close(): Promise<void> {
    let closeError: unknown = null;
    try {
      await this.closeProcess();
    } catch (error) {
      closeError = error;
    }
    try {
      if (this.workDir && this.ownsWorkDir && !this.options.keepWorkDir) {
        // WebView2 may still hold handles for a while after process death
        // (icon DB, cache flushes, GPU process teardown); a short bounded
        // retry loop absorbs Windows file locking without leaking temp dirs.
        let removed = false;
        let lastCleanupError: unknown = null;
        for (const delayMs of [250, 500, 1_000, 2_000, 4_000]) {
          try {
            rmSync(this.workDir, { recursive: true, force: true });
            removed = true;
            break;
          } catch (error) {
            lastCleanupError = error;
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
        if (!removed && lastCleanupError !== null) {
          throw lastCleanupError;
        }
        this.workDir = null;
        this.ownsWorkDir = false;
      }
    } catch (error) {
      closeError = closeError
        ? new Error(`${String(closeError)}; work directory cleanup failed: ${String(error)}`)
        : error;
    }
    if (closeError) throw closeError;
  }

  /**
   * Isolation self-test (task 2.5): the developer's real settings.json must be
   * byte-identical to its pre-run state after the run.
   */
  async selfTest(): Promise<void> {
    if (!this.realSettingsPath) return;
    const after = readFileState(this.realSettingsPath);
    if (!this.realSettingsBefore || !sameFileState(this.realSettingsBefore, after)) {
      throw new Error(
        `RealAppDriver isolation self-test FAILED: developer's real settings.json changed: ${this.realSettingsPath}`
      );
    }
  }

  /** Writes the resulting settings.json (temp) to a report dir for assertions. */
  copySettingsTo(outDir: string): void {
    if (!this.workDir) return;
    const src = join(this.workDir, 'appdata', 'settings.json');
    if (existsSync(src)) {
      writeFileSync(join(outDir, 'settings.json'), readFileSync(src));
    }
  }
}
