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
import type { SimDriver, DriverLaunchResult } from '../types';
import type { SimFault, SimScenario } from '../../../src/sim/mockBackend';

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
    return { page, appStderrPath: null };
  }

    /**
   * Stops context tracing and saves the trace to `tracePath`. Note: stopTrace
   * must be called before `close()` (which flushes video and shuts the browser).
   */
  async stopTrace(tracePath: string): Promise<void> {
    if (!this.context) return;
    try {
      await this.context.tracing.stop({ path: tracePath });
    } catch {
      // trace is best-effort; the journey outcome is reported regardless
    }
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

  async restartApp(): Promise<void> {
    if (!this.page) return;
    // Same context ⇒ same localStorage namespace ⇒ settings persist; the
    // addInitScript re-installs the scenario for the fresh page.
    await this.page.reload({ waitUntil: 'domcontentloaded' });
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
    this.page = null;
  }
}
