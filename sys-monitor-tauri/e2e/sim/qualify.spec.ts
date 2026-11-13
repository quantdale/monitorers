/**
 * Packaged-app qualification (canonical `verify:packaged` lane).
 *
 * Launches the REAL built Tauri executable through the existing RealAppDriver
 * isolation and asserts, end to end:
 *   1. the app window serves the real frontend,
 *   2. real Tauri IPC answers (`get_history` through __TAURI_INTERNALS__),
 *   3. real collector data arrives and advances,
 *   4. a representative UI interaction lands in the run-isolated real
 *      settings store (plugin-store → settings.json under SYSMON_SIM_APP_DATA),
 *   5. teardown is clean: no orphaned app process, developer's real
 *      settings.json byte-identical.
 *
 * The remote-debugging port is supplied per-process via environment variables
 * owned by this driver — shipped configuration carries no debugging flag.
 */
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RealAppDriver } from './drivers/RealAppDriver';
import { assertNoOrphanProcesses } from './drivers/processGuard';
// The packaged lane must follow the schema pair, not a copy of it: this assertion
// was hardcoded at 5 and silently went stale when the metrics schema moved to 6
// (`MetricsSnapshot` gained `timestamp_ms`), failing the lane against a correct
// app. Importing the frontend's expectation keeps the two halves in lockstep.
import { EXPECTED_SCHEMA_VERSION } from '../../src/hooks/useMetrics';

const APP_EXE =
  process.env.SIM_APP_EXE ?? 'src-tauri/target/release/sys-monitor-tauri.exe';

function assertBuiltExe(): string {
  if (!existsSync(APP_EXE)) {
    throw new Error(
      `packaged qualification needs a built exe at ${APP_EXE} (set SIM_APP_EXE to override); run "npx tauri build --no-bundle" first`
    );
  }
  return APP_EXE;
}

async function assertNoOrphanAppProcesses(): Promise<void> {
  // Shared with the simulation runner's real-lane teardown guard.
  await assertNoOrphanProcesses(APP_EXE);
}

/** One synthetic transport response in the isolated CDP page. Tauri's invoke
 * function is deliberately immutable; leave it intact and intercept fetch at
 * the test boundary. The following attempt uses the untouched native fetch. */
async function failNextIpc(page: Page, command: string, message: string): Promise<void> {
  await page.evaluate(({ command, message }) => {
    const nativeFetch = window.fetch;
    window.fetch = (input, options) => {
      const address = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(address, window.location.href);
      if (url.hostname === 'ipc.localhost' && decodeURIComponent(url.pathname) === `/${command}`) {
        window.fetch = nativeFetch;
        return Promise.resolve(new Response(message, { headers: { 'Tauri-Response': 'error', 'Content-Type': 'text/plain' } }));
      }
      return nativeFetch(input, options);
    };
  }, { command, message });
}

test('packaged app qualifies end-to-end over real IPC', async ({ }, testInfo) => {
  const appExe = assertBuiltExe();
  console.log(`[qualify] launching built app: ${appExe}`);
  const driver = new RealAppDriver({
    appExe,
    workRoot: process.env.QUALIFY_WORK_ROOT || undefined,
  });
  try {
    let page;
    try {
      ({ page } = await driver.launch(
        `qualify-${Date.now()}`,
        { version: 1 },
        testInfo.outputPath()
      ));
    } catch (launchError) {
      // Hosted-runner diagnosis aid: dump the app's stderr, the process table,
      // the WebView2 Evergreen runtime registration (its absence makes wry pop
      // a blocking dialog — process alive, webview never created), and our
      // window title, so a silent CDP failure is attributable.
      try {
        const { execFileSync } = await import('node:child_process');
        if (driver.appExitInfo) {
          console.log(`[qualify] ${driver.appExitInfo}`);
        } else {
          console.log('[qualify] app process still alive at failure time');
        }
        console.log(
          '[qualify] tasklist:',
          execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' })
            .split(/\r?\n/)
            .filter((l) => /sys-monitor|msedgewebview2/i.test(l))
            .join('\n')
        );
        console.log(
          '[qualify] webview2 cmdlines:',
          execFileSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-c',
              "Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" | Select-Object -ExpandProperty CommandLine",
            ],
            { encoding: 'utf8' },
          ),
        );
        console.log(
          '[qualify] webview2 runtime:',
          execFileSync(
            'reg.exe',
            ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', '/v', 'pv'],
            { encoding: 'utf8' }
          )
        );
        console.log(
          '[qualify] window titles:',
          execFileSync(
            'powershell.exe',
            ['-NoProfile', '-c', 'Get-Process sys-monitor-tauri | Select-Object Id,MainWindowTitle | Format-List'],
            { encoding: 'utf8' }
          )
        );
      } catch (diagError) {
        console.log('[qualify] diagnostics failed:', String(diagError));
      }
      const stderrPath = driver.appStderrPathValue ?? join(testInfo.outputPath(), 'app-stderr.log');
      if (existsSync(stderrPath)) {
        console.log(`[qualify] app stderr (${stderrPath}):\n`, readFileSync(stderrPath, 'utf8').slice(0, 4_000));
      } else {
        console.log(`[qualify] no app stderr captured at ${stderrPath}`);
      }
      throw launchError;
    }

    // ── 1. Real frontend is up ──
    await expect(
      page.locator('[data-testid^="metric-card-"]').first()
    ).toBeVisible({ timeout: 60_000 });

    // ── 2. Real Tauri IPC responds ──
    const history = await page.evaluate(async () => {
      const internals = (window as unknown as {
        __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__;
      if (!internals) throw new Error('__TAURI_INTERNALS__ missing — not a real Tauri runtime');
      return (await internals.invoke('get_history', { windowSecs: 60 })) as {
        schema_version: number;
        timestamps: number[];
      };
    });
    expect(history.schema_version, 'real IPC history schema version').toBe(EXPECTED_SCHEMA_VERSION);
    expect(Array.isArray(history.timestamps)).toBe(true);

    // ── 3. Real collector data arrives and advances ──
    const chart = page.locator('[data-testid="metric-chart-cpu"]');
    await expect(chart).toBeVisible({ timeout: 30_000 });
    const latestTs = () => chart.getAttribute('data-chart-latest-ts');
    const ts1 = await latestTs();
    expect(ts1, 'collector produced at least one committed point').not.toBeNull();
    let ts2: string | null = null;
    for (let waited = 0; waited < 20_000; waited += 500) {
      await page.waitForTimeout(500);
      ts2 = await latestTs();
      if (ts2 !== null && ts2 !== ts1) break;
    }
    expect(ts2, 'live collector data kept advancing').toBeTruthy();
    expect(Number(ts2)).toBeGreaterThan(Number(ts1));

    // Preserve the real, host-specific inventory for comparison with the
    // independent DXGI probe; do not hardcode this host's cards into CI.
    const inventory = await page.evaluate(async () => {
      const internals = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__;
      return internals.invoke('get_history', { windowSecs: 60 });
    });
    writeFileSync(testInfo.outputPath('gpu-inventory.json'), JSON.stringify(inventory, null, 2));

    // ── 4. Representative interaction lands in the isolated real store ──
    const settingsPath = join(driver.appDataDir ?? '', 'settings.json');
    await page.getByRole('button', { name: 'Tile' }).click();
    let persistedViewMode: string | null = null;
    for (let waited = 0; waited < 15_000; waited += 500) {
      if (existsSync(settingsPath)) {
        try {
          const raw = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
          if (raw.viewMode === 'tile') {
            persistedViewMode = String(raw.viewMode);
            break;
          }
        } catch {
          // plugin-store may be mid-write; retry on the next poll tick
        }
      }
      await page.waitForTimeout(500);
    }
    expect(persistedViewMode, 'settings write landed in the per-run isolated store').toBe('tile');

    // CDP-scoped transient failures at the transport boundary, not shipped
    // fault controls. Both recovery attempts use the real Tauri commands and
    // listener implementation; the collector process stays alive throughout.
    await failNextIpc(page, 'get_history', 'qualification history connection failure');
    await page.getByRole('combobox', { name: 'History time range' }).selectOption('300');
    const connectionError = page.getByTestId('metrics-connection-error');
    const retryConnection = page.getByRole('button', { name: 'Retry metrics connection', exact: true });
    await expect(connectionError).toContainText('qualification history connection failure');
    await expect(page.getByTestId('metric-card-cpu')).toBeVisible();

    await failNextIpc(page, 'plugin:event|listen', 'qualification live listener failure');
    await retryConnection.click();
    await expect(connectionError).toContainText('qualification live listener failure');
    await expect(retryConnection).toBeEnabled();
    const beforeReconnect = Number(await latestTs());
    await retryConnection.focus();
    await page.keyboard.press('Enter');
    await expect(connectionError).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'History time range' })).toBeFocused();
    await expect(page.getByRole('combobox', { name: 'History time range' })).toHaveValue('300');
    await expect(page.getByRole('button', { name: 'Tile', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => Number(await latestTs()), { timeout: 15_000 }).toBeGreaterThan(beforeReconnect);
    await expect.poll(() => {
      const persisted = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
      return { windowSecs: persisted.windowSecs, viewMode: persisted.viewMode };
    }).toEqual({ windowSecs: 300, viewMode: 'tile' });

    // ── 5. Qualify the responsive drawer with real hardware and drag sensors ──
    await page.setViewportSize({ width: 400, height: 700 });
    await page.getByRole('button', { name: 'Show hardware info' }).click();
    const drawer = page.getByRole('dialog', { name: 'Hardware info' });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('[data-sb-id]').first()).toBeVisible({ timeout: 30_000 });
    const close = drawer.getByRole('button', { name: 'Close hardware info' });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();

    const renderedIds = () => drawer.locator('[data-sb-id]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-sb-id')),
    );
    const beforeDrag = await renderedIds();
    expect(beforeDrag.length).toBeGreaterThanOrEqual(2);
    const handle = drawer.locator('button[title="Drag to reorder"]').first();
    await handle.focus();
    await page.keyboard.press('Space');
    await expect(handle).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    // dnd-kit removes aria-pressed when inactive; it does not serialize false.
    await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
    await expect(drawer).toBeVisible();
    expect(await renderedIds()).toEqual(beforeDrag);
    await page.screenshot({ path: testInfo.outputPath('hardware-drawer-real.png') });

    // Escape after cancellation dismisses; it must not be swallowed forever.
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show hardware info' })).toBeFocused();

    // Both desktop surfaces may coexist, but only the hardware modal can own
    // focus when a responsive transition makes the dashboard behind it inert.
    await page.setViewportSize({ width: 900, height: 700 });
    await page.getByRole('button', { name: 'Show hardware info' }).click();
    await page.getByRole('button', { name: /Metrics/ }).click();
    const metricVisibility = page.getByRole('dialog', { name: 'Metric card visibility' });
    await expect(metricVisibility).toBeVisible();
    await page.setViewportSize({ width: 400, height: 700 });
    await expect(metricVisibility).toHaveCount(0);
    await expect(close).toBeFocused();
    for (const key of ['Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      await expect.poll(() => drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath('exclusive-modal-real.png') });
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await page.setViewportSize({ width: 900, height: 1100 });
    await page.getByTestId('dashboard-scroll-area').evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath('dashboard-real.png') });

    // ── 6. Clean exit; no orphaned processes; real store untouched ──
    await driver.close();
    await assertNoOrphanAppProcesses();
    await driver.selfTest();

    console.log('[qualify] PASS: real IPC, live data, connection retries, isolated settings, modal focus, drag cancellation, clean exit');
  } finally {
    // Idempotent even after an explicit close above, and crucially runs on
    // launch failure too: kills the spawned app, removes the elevated-host
    // HKLM args value, and deletes the per-run work dir.
    await driver.close().catch(() => undefined);
  }
});
