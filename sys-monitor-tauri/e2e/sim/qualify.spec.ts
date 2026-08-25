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
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { RealAppDriver } from './drivers/RealAppDriver';

const execFileAsync = promisify(execFile);

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

async function assertNoOrphanProcesses(): Promise<void> {
  const exeName = join(APP_EXE).replace(/\\/g, '/').split('/').pop() ?? '';
  const { stdout } = await execFileAsync('tasklist', [
    '/FI',
    `IMAGENAME eq ${exeName}`,
    '/FO',
    'CSV',
    '/NH',
  ]);
  const rows = stdout.trim();
  expect(
    rows.includes(exeName),
    `orphaned packaged-app processes must not survive the run:\n${rows}`
  ).toBe(false);
}

test('packaged app qualifies end-to-end over real IPC', async ({ }, testInfo) => {
  const appExe = assertBuiltExe();
  console.log(`[qualify] launching built app: ${appExe}`);
  const driver = new RealAppDriver({
    appExe,
    workRoot: process.env.QUALIFY_WORK_ROOT || undefined,
  });
  let launched = false;
  try {
    const { page } = await driver.launch(
      `qualify-${Date.now()}`,
      { version: 1 },
      testInfo.outputDir()
    );
    launched = true;

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
    expect(history.schema_version, 'real IPC history schema version').toBe(5);
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

    // ── 5. Clean exit; no orphaned processes; real store untouched ──
    await driver.close();
    launched = false;
    await assertNoOrphanProcesses();
    await driver.selfTest();

    console.log('[qualify] PASS: real IPC, live data, isolated settings, clean exit');
  } finally {
    if (launched) await driver.close().catch(() => undefined);
  }
});
