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
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
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

/**
 * Injectable seam for the machine-wide WebView2 args policy so unit tests can
 * exercise every failure path WITHOUT touching a real HKLM hive.
 */
export interface HklmPolicyOps {
  /** Applies the value; throws on failure (e.g. access denied). */
  write(key: string, valueName: string, data: string): void;
  /** Removes the value; throws on failure. */
  remove(key: string, valueName: string): void;
  /**
   * Reports whether the value currently EXISTS. Returns a definite boolean
   * rather than signalling absence through a thrown error, so a post-removal
   * check can never confuse "the value is gone" (success) with "the query
   * itself failed" (an operational error worth escalating).
   */
  read(key: string, valueName: string): boolean;
}

/** Production registry channel via reg.exe (synchronous, stdio captured). */
export const RegHklmPolicyOps: HklmPolicyOps = {
  write(key, valueName, data) {
    execFileSync('reg.exe', ['add', key, '/v', valueName, '/t', 'REG_SZ', '/d', data, '/f'], {
      stdio: 'pipe',
    });
  },
  remove(key, valueName) {
    execFileSync('reg.exe', ['delete', key, '/v', valueName, '/f'], { stdio: 'pipe' });
  },
  read(key, valueName) {
    try {
      execFileSync('reg.exe', ['query', key, '/v', valueName], { stdio: 'pipe' });
      return true;
    } catch (error) {
      // `reg query` exits 1 with "The system was unable to find the specified
      // registry key or value." when the value (or its key) is absent. That is
      // a DEFINITE "absent", not an error — and treating it as an error would
      // make the post-removal check fail on a correctly removed value.
      //
      // A spawn failure (reg.exe missing/unexecutable) carries no numeric
      // `status`; that IS an operational error and must propagate.
      const status = (error as { status?: number | null }).status;
      if (typeof status === 'number') return false;
      throw error;
    }
  },
};

/**
 * WebView2 Runtime ≥150 ignores `WEBVIEW2_*` environment variables when the
 * host app process runs elevated (High IL) — a documented security hardening
 * (MicrosoftEdge/WebView2Feedback #5640/#5645; GitHub-hosted Windows runners
 * run elevated). The SAME flags delivered through the machine-wide
 * AdditionalBrowserArguments policy ARE honored by elevated hosts, so the
 * driver mirrors its debug switches there whenever it has permission and
 * removes the value again on close. On standard-integrity hosts the write is
 * expected to fail with access-denied — there the environment variable works.
 */
const WV2_ARGS_POLICY_KEY = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments';

/**
 * Value name for the machine-wide debug-switch channel.
 *
 * `*` is the wildcard form and it is the ONLY form documented for
 * `AdditionalBrowserArguments`; it applies to EVERY WebView2 host on the
 * machine, not just this app. That blast radius is the reason the value is
 * (a) removed on every termination path, (b) verified absent after removal,
 * and (c) created only for the duration of a run. Whether a per-application
 * value name (e.g. the app's exe basename) is honoured instead was tested —
 * see evidence.md §4 — and could not be confirmed on the available host, so
 * `*` is retained as a RECORDED decision rather than an unexamined default.
 */
const WV2_ARGS_VALUE_NAME = '*';

export interface RealDriverOptions {
  /** Path to the built app exe. Defaults to SIM_APP_EXE or the release exe. */
  appExe?: string;
  /** Root dir for per-run temp work dirs. Defaults to os.tmpdir(). */
  workRoot?: string;
  /** Extra env vars for the child (e.g. SYSMON_CADENCE_LOG). */
  extraEnv?: Record<string, string>;
  /** Keep the temp work dir after close (for triage). Debug helper. */
  keepWorkDir?: boolean;
  /** Registry seam override (tests only). Defaults to RegHklmPolicyOps. */
  hklmOps?: HklmPolicyOps;
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
    `RealAppDriver: CDP endpoint ${url} did not come up within ${timeoutMs}ms${lastErr ? ` (${String(lastErr)})` : ''}`,
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
  private hklmArgsValueWritten = false;
  /** Unbind records for this instance's process-termination handlers. */
  private policyRemovalHandlers: Array<{ event: NodeJS.Signals | 'exit' | 'uncaughtException'; handler: () => void }> = [];
  private readonly hklmOps: HklmPolicyOps;
  private lastExitInfo: string | null = null;
  private realSettingsPath: string | null = null;
  private realSettingsBefore: FileState | null = null;
  private ownsWorkDir = false;

  constructor(options: RealDriverOptions = {}) {
    this.options = options;
    this.hklmOps = options.hklmOps ?? RegHklmPolicyOps;
    this.appExe = resolveAppExe(options.appExe);
  }

  /** Absolute path of the current run's temp app-data dir (settings.json here). */
  get appDataDir(): string | null {
    return this.workDir ? join(this.workDir, 'appdata') : null;
  }

  /** The CDP debug port allocated for the CURRENT app process (null pre-launch).
   *  Freshly allocated per launch, so two launches of one driver instance never
   *  share a port — journeys use this to prove a genuine second process. */
  get cdpPort(): number | null {
    return this.port;
  }

  /** Path of the executable this driver launches (for process-table assertions). */
  get appExePath(): string {
    return this.appExe;
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
    // The elevated-host policy channel MUST be written before spawn: if the
    // value lands after the WebView2 loader has already created its
    // environment, runtime ≥150 restarts the browser process over the flag
    // change and tears down the just-established debug server.
    this.applyHklmArgsFallback();
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
    this.trackAppExit();

    // Bounded cold-start retry: on a cold runner the WebView2 browser process
    // can vanish between CDP-endpoint readiness and page attach (observed as
    // 'Target page, context or browser has been closed' on the FIRST launch
    // of a hosted run, with later launches fine). One fresh-process retry
    // absorbs that transient; a genuine spawn/exe defect keeps failing here.
    const attempts = 2;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const cdpUrl = `http://127.0.0.1:${this.port}/json/version`;
        await waitForCdpOrProcess(
          this.proc!,
          cdpUrl,
          this.options.extraEnv?.SIM_CDP_TIMEOUT ? Number(this.options.extraEnv.SIM_CDP_TIMEOUT) : 60_000
        );
        await this.attachPage();
        return { page: this.page!, appStderrPath: this.appStderrPath };
      } catch (error) {
        lastError = error;
        if (attempt === attempts) break;
        console.warn(`[RealAppDriver] bring-up attempt ${attempt} failed (${String(error)}); retrying with a fresh process`);
        await this.closeProcess();
        await new Promise((r) => setTimeout(r, 1_000));
        this.port = await freePort();
        // Elevated hosts receive the debug switches through the machine-wide
        // HKLM policy (env vars are ignored), so the rewritten value MUST be
        // re-applied with the NEW port or the respawned process opens its
        // debug server on the stale one while we poll the new endpoint.
        this.env = {
          ...this.env,
          WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${this.port} --remote-allow-origins=*`,
        };
        this.applyHklmArgsFallback();
        const stderrFd2 = this.appStderrPath ? openSync(this.appStderrPath, 'a') : undefined;
        try {
          this.proc = spawn(this.appExe, [], { env: this.env, stdio: ['ignore', 'ignore', stderrFd2 ?? 'ignore'] });
        } catch (spawnError) {
          if (stderrFd2 !== undefined) closeSync(stderrFd2);
          throw new ClassifiedSimulationError(
            `RealAppDriver: failed to respawn ${this.appExe}: ${String(spawnError)}`,
            'harness-defect',
            'spawn',
          );
        }
        if (stderrFd2 !== undefined) closeSync(stderrFd2);
        this.trackAppExit();
      }
    }
    throw lastError;
  }

  /** Connects over CDP and validates the app page (launch tail, retried). */
  private async attachPage(): Promise<void> {
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
  }

  /**
   * Elevated-host channel for the debug switches (see WV2_ARGS_POLICY_KEY).
   * Best-effort: access denied on non-admin hosts is fine because there the
   * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS variable is honored. The write is
   * logged either way so access-denied vs successful application is
   * diagnosable from run output. The value name `*` applies to every WebView2
   * host on the machine, which is acceptable for an ephemeral runner and
   * bounded by UNCONDITIONAL removal in close().
   *
   * MUST be called before spawn: if the value lands after the WebView2 loader
   * has created its environment, runtime ≥150 restarts the browser process
   * over the flag change and tears down the just-established debug server.
   */
  private applyHklmArgsFallback(): boolean {
    if (process.platform !== 'win32') return false;
    const args = this.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
    if (!args) return false;
    try {
      this.hklmOps.write(WV2_ARGS_POLICY_KEY, WV2_ARGS_VALUE_NAME, args);
      this.hklmArgsValueWritten = true;
      // From the moment the value exists machine-wide, EVERY way this process
      // can end must be able to take it back out — including ones that never
      // reach close() (Ctrl-C, SIGTERM, process.exit, an uncaught throw).
      this.registerPolicyRemovalHandlers();
      console.log('[RealAppDriver] HKLM WebView2 args policy applied before spawn');
    } catch (error) {
      this.hklmArgsValueWritten = false;
      console.warn(
        `[RealAppDriver] HKLM WebView2 args policy not applied (${String(error)}); relying on WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
      );
    }
    return this.hklmArgsValueWritten;
  }

  /**
   * SECURITY-CRITICAL teardown: removes the machine-wide debug/origin policy
   * and then VERIFIES it is gone. Called from close() OUTSIDE every fallible
   * path so neither process-close, work-directory, nor assertion failures can
   * skip it; its own failure is returned to the caller for aggregation, never
   * swallowed.
   *
   * The ownership flag (`hklmArgsValueWritten`) is cleared only when the value
   * is confirmed absent. If it is still present afterwards, the driver owns a
   * cleanup it has NOT completed: `close()` reports that as a teardown failure
   * naming the key and value, and the flag stays set so a termination handler
   * can make a final attempt at process exit.
   */
  private removeHklmArgsFallback(): void {
    if (!this.hklmArgsValueWritten) return;
    this.hklmOps.remove(WV2_ARGS_POLICY_KEY, WV2_ARGS_VALUE_NAME);
    if (this.hklmOps.read(WV2_ARGS_POLICY_KEY, WV2_ARGS_VALUE_NAME)) {
      // Still present: do NOT clear ownership and do NOT report success.
      throw new Error(
        `WebView2 debug-policy value ${WV2_ARGS_POLICY_KEY}\\${WV2_ARGS_VALUE_NAME} is STILL PRESENT after removal`
      );
    }
    // Confirmed gone: ownership released, and the termination handlers that
    // existed only to clean this up have nothing left to do.
    this.hklmArgsValueWritten = false;
    this.unregisterPolicyRemovalHandlers();
  }

  /**
   * Per-instance process-termination handlers, registered at the moment the
   * machine-wide value is first written (never at construction, so a driver
   * that never writes the value never installs handlers).
   *
   * Every handler body is non-throwing: a cleanup problem must not turn a
   * clean Ctrl-C into an unhandled exception, nor prevent sibling handlers
   * from running. Failures here cannot be reported to anyone — the process is
   * exiting — so they are surfaced on stderr and otherwise dropped; close()
   * remains the path that actually escalates a removal failure.
   */
  private registerPolicyRemovalHandlers(): void {
    if (this.policyRemovalHandlers.length > 0) return;
    const removeQuietly = (): void => {
      try {
        this.removeHklmArgsFallback();
      } catch (error) {
        try {
          console.error(
            `[RealAppDriver] WebView2 debug-policy removal failed during process termination: ${String(error)}`
          );
        } catch {
          // Nothing may escape a termination handler.
        }
      }
    };
    const bindings: Array<{
      event: NodeJS.Signals | 'exit' | 'uncaughtException';
      handler: () => void;
    }> = [];
    const bind = (event: NodeJS.Signals | 'exit' | 'uncaughtException', handler: () => void): void => {
      process.on(event, handler as never);
      bindings.push({ event, handler });
    };
    bind('SIGINT', removeQuietly);
    bind('SIGTERM', removeQuietly);
    bind('exit', removeQuietly);
    bind('uncaughtException', () => {
      removeQuietly();
      // Registering an `uncaughtException` listener suppresses Node's default
      // crash-and-exit. Restore it explicitly so the failure is still fatal
      // and still reported, instead of leaving the worker running in a
      // half-broken state.
      process.exit(1);
    });
    this.policyRemovalHandlers = bindings;
  }

  /**
   * Removes the termination handlers once the value is confirmed gone, so a
   * normal run leaves no live listener behind at exit and per-selection driver
   * instances in run.spec.ts do not accumulate handlers.
   */
  private unregisterPolicyRemovalHandlers(): void {
    for (const entry of this.policyRemovalHandlers) {
      process.off(entry.event, entry.handler as never);
    }
    this.policyRemovalHandlers = [];
  }

  /** How the spawned app process ended so far, for failure diagnostics. */
  get appExitInfo(): string | null {
    return this.lastExitInfo;
  }

  private trackAppExit(): void {
    const proc = this.proc;
    if (!proc) return;
    const record = (code: number | null, signal: NodeJS.Signals | null): void => {
      this.lastExitInfo = `app process exited (code=${String(code)}, signal=${String(signal)})`;
    };
    proc.on('exit', record);
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

  /** Protected so tests can simulate process-close failures. */
  protected async closeProcess(): Promise<void> {
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

  /**
   * Removes the run's temp work dir. Protected so tests can simulate Windows
   * file-locking failures without real WebView2 handles.
   */
  protected async cleanupWorkDir(): Promise<void> {
    if (!this.workDir || !this.ownsWorkDir || this.options.keepWorkDir) return;
    // WebView2 may still hold handles for a while after process death
    // (icon DB, cache flushes, GPU process teardown); a short bounded
    // retry ladder absorbs Windows file locking without leaking temp dirs.
    // Delays sit BETWEEN attempts — a hard failure pays no trailing sleep.
    let removed = false;
    let lastCleanupError: unknown = null;
    const delays = [250, 500, 1_000, 2_000, 4_000];
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      try {
        rmSync(this.workDir, { recursive: true, force: true });
        removed = true;
        break;
      } catch (error) {
        lastCleanupError = error;
        if (attempt < delays.length - 1) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
      }
    }
    if (!removed && lastCleanupError !== null) {
      throw lastCleanupError;
    }
    this.workDir = null;
    this.ownsWorkDir = false;
  }

  /**
   * Full teardown, structured as a resource lifecycle with AGGREGATED errors:
   *
   *   apply temporary policy (launch) → qualify → remove policy (always)
   *
   * The machine-wide HKLM debug/origin policy is removed on EVERY path —
   * success, spawn failure, browser/process close failure, work-directory
   * deletion failure — because it runs outside those fallible steps and its
   * own failure is aggregated rather than allowed to mask or skip the rest.
   */
  async close(): Promise<void> {
    const failures: string[] = [];
    try {
      await this.closeProcess();
    } catch (error) {
      failures.push(`process close failed: ${String(error)}`);
    }
    try {
      await this.cleanupWorkDir();
    } catch (error) {
      failures.push(`work directory cleanup failed: ${String(error)}`);
    }
    try {
      // Security cleanup LAST so nothing above can skip it; a failure here
      // still surfaces in the aggregated error below.
      this.removeHklmArgsFallback();
    } catch (error) {
      failures.push(`WebView2 debug-policy removal failed: ${String(error)}`);
    }
    if (failures.length > 0) {
      throw new Error(`RealAppDriver: close completed with failures — ${failures.join('; ')}`);
    }
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
