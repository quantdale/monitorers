/**
 * MockHarnessDriver — the browser-lane SimDriver.
 *
 * Wraps the existing Vite mock harness (port 5180) plus the simulation bridge
 * (`src/sim/mockBackend.ts`): it hands a run's scenario to the page via
 * localStorage + `?__sim_run=<id>`, then drives faults, clock speed and
 * restart through `window.__SIM__`. Settings persistence round-trips through
 * the bridge's per-run localStorage namespace.
 *
 * The browser context is created per-run by this driver (not Playwright's
 * fixtures) so mock and real lanes share one driver shape.
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { SimDriver, DriverLaunchResult, ReloadGuardSession } from '../types';
import type { SimFault, SimScenario } from '../../../src/sim/mockBackend';
import { ClassifiedSimulationError } from '../errors';
import { createReloadGuard, type ReloadGuard } from '../engine/reloadGuard';

export const MOCK_BASE_URL = 'http://127.0.0.1:5180';

export interface MockArtifacts {
  traceDir: string;
  videoDir: string;
}

export class MockHarnessDriver implements SimDriver {
  readonly kind = 'mock' as const;
  page: Page | null = null;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  /** Unexpected-reload (HMR) guard armed for the launched page. */
  private reloadGuard: ReloadGuard | null = null;

  async launch(
    runId: string,
    scenario: SimScenario,
    outDir?: string,
    artifacts?: MockArtifacts
  ): Promise<DriverLaunchResult> {
    this.browser = await chromium.launch();
    this.context = await this.browser.newContext({
      baseURL: MOCK_BASE_URL,
      viewport: { width: 900, height: 1100 },
      ...(artifacts?.videoDir
        ? { recordVideo: { dir: artifacts.videoDir } }
        : outDir
          ? { recordVideo: { dir: outDir } }
          : {}),
    });
    if (artifacts?.traceDir || outDir) {
      await this.context.tracing.start({ screenshots: true, snapshots: true });
    }

    // Install the scenario into localStorage before EVERY navigation so an
    // app-restart (page reload) resumes the identical run state.
    const ctx = this.context;
    await ctx.addInitScript(
      ([id, scn]: [string, SimScenario]) => {
        try {
          localStorage.setItem(`sysmon_sim_session_${id}`, JSON.stringify(scn));
        } catch {
          // best-effort handoff; the journey surfaces a harness error instead
        }
      },
      [runId, scenario] as [string, SimScenario]
    );

    const page = await ctx.newPage();
    this.page = page;
    await page.goto(`/?__sim_run=${encodeURIComponent(runId)}`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        ([expectedRunId, expectedScenarioVersion]) =>
          window.__SIM__?.runId === expectedRunId && window.__SIM__?.scenario.version === expectedScenarioVersion,
        [runId, scenario.version]
      );
    } catch (error) {
      throw new ClassifiedSimulationError(
        `mock scenario handoff failed for run ${runId}: ${String(error)}`,
        'harness-defect',
        'config',
      );
    }
    // Arm the HMR/reload guard only AFTER the initial goto + handoff: the
    // launch navigation itself is expected; anything from here on is not.
    this.reloadGuard = createReloadGuard(page);
    return { page, appStderrPath: null };
  }

  /** Rejects if `p` does not settle within `ms` — bounds teardown against a
   *  wedged browser, which otherwise eats the whole test budget. */
  private async bounded<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Stops context tracing and saves the trace to `tracePath`. Note: stopTrace
   * must be called before `close()` (which flushes video and shuts the browser).
   */
  async stopTrace(tracePath: string): Promise<void> {
    if (!this.context) return;
    await this.bounded(this.context.tracing.stop({ path: tracePath }), 15_000, 'tracing.stop');
  }

  async injectFault(fault: SimFault): Promise<boolean> {
    if (!this.page) return false;
    await this.page.waitForFunction(() => typeof window.__SIM__ !== 'undefined');
    await this.page.evaluate((f) => window.__SIM__?.backend.injectFault(f), fault);
    return true;
  }

  async setSpeed(factor: number): Promise<void> {
    if (!this.page) return;
    await this.page.waitForFunction(() => typeof window.__SIM__ !== 'undefined');
    await this.page.evaluate((x) => window.__SIM__?.backend.setSpeed(x), factor);
  }

  /** Exposes the armed guard to the runner (see SimDriver contract). */
  guardUnexpectedReload(): ReloadGuardSession {
    if (!this.reloadGuard) throw new Error('guardUnexpectedReload: driver has no launched page');
    const guard = this.reloadGuard;
    return { failure: guard.failure, dispose: guard.dispose, drainViolations: guard.drainViolations };
  }

  async restartApp(): Promise<void> {
    if (!this.page) return;
    // Same context ⇒ same localStorage namespace ⇒ settings persist; the
    // addInitScript re-installs the scenario for the fresh page. This reload
    // is driver-initiated, so the HMR guard is suspended for its duration.
    this.reloadGuard?.suspend();
    try {
      await this.page.reload({ waitUntil: 'domcontentloaded' });
    } finally {
      this.reloadGuard?.resume();
    }
  }

  async close(): Promise<void> {
    const errors: string[] = [];
    this.reloadGuard?.dispose();
    this.reloadGuard = null;
    if (this.context) {
      try {
        await this.bounded(this.context.close(), 15_000, 'context.close');
      } catch (error) {
        errors.push(`context close failed: ${String(error)}`);
      }
      this.context = null;
    }
    if (this.browser) {
      try {
        await this.bounded(this.browser.close(), 15_000, 'browser.close');
      } catch (error) {
        errors.push(`browser close failed: ${String(error)}`);
      }
      this.browser = null;
    }
    this.page = null;
    if (errors.length > 0) throw new Error(errors.join('; '));
  }
}
