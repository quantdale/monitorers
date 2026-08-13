/**
 * v1 journeys — code modules composing typed steps with assertions (tasks
 * 3.4–3.8). Each journey declares which drivers support it and runs against
 * `ctx.driver.page`. The mock lane scripts faults via the bridge; the real
 * lane drives the packaged app and leaves unsupported steps registered (see
 * the register discipline in e2e/exploratory-register.md).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Journey, SimContext } from '../types';
import * as S from '../engine/steps';

async function readSettingsShim(ctx: SimContext): Promise<Record<string, unknown>> {
  const page = ctx.driver.page;
  if (!page) return {};
  // Read the per-run localStorage settings namespace synchronously.
  return (await page.evaluate(
    (runId) => {
      try {
        const raw = localStorage.getItem(`sysmon_sim_settings_${runId}`);
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    },
    ctx.opts.runId
  )) as Record<string, unknown>;
}

function readRealSettings(ctx: SimContext): Record<string, unknown> {
  const d = ctx.driver as unknown as { appDataDir?: string | null };
  const dir = d.appDataDir;
  if (!dir) return {};
  const p = join(dir, 'settings.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function persistedSettings(ctx: SimContext): Promise<Record<string, unknown>> {
  return ctx.driver.kind === 'real' ? readRealSettings(ctx) : readSettingsShim(ctx);
}

// ── 1. First-launch onboarding ────────────────────────────────────────────────

const firstLaunch: Journey = {
  id: 'first-launch-onboarding',
  title: 'First launch: default card order computed and persisted',
  supportedDrivers: ['mock', 'real'],
  personaIds: ['glancer', 'customizer'],
  async run(ctx) {
    await S.waitForState(ctx, 'live');
    // Real driver: cards appear progressively as hardware detection settles —
    // wait for the settled set before asserting the default order.
    const ids = await S.waitForCards(ctx, 5);
    ctx.assert('default-order-cpu-first', ids[0] === 'cpu', `first card should be cpu, got ${ids.join(',')}`);
    ctx.assert('default-memory-second', ids[1] === 'memory', `second card should be memory`);
    // The default order is persisted to the per-run settings store.
    const persisted = await persistedSettings(ctx);
    ctx.assert('card-order-persisted', Array.isArray(persisted.cardOrder), 'cardOrder persisted');
    await new Promise((r) => setTimeout(r, 500));
    const again = await S.readCardIds(ctx);
    ctx.assert('order-stable', JSON.stringify(again) === JSON.stringify(ids), 'order stable across re-read');
  },
};

// ── 2. Customization round-trip ───────────────────────────────────────────────

const customizationRoundtrip: Journey = {
  id: 'customization-roundtrip',
  title: 'Customize then restart; layout restored exactly',
  supportedDrivers: ['mock', 'real'],
  personaIds: ['customizer', 'glancer'],
  async run(ctx) {
    await S.waitForState(ctx, 'live');
    await ctx.dwell();
    const before = await S.readCardIds(ctx);
    if (before.length < 2) {
      ctx.assert('enough-cards', false, `need >= 2 cards, got ${before.length}`);
      return;
    }

    // Reorder: move the first card down one slot.
    const target = before[1];
    await S.dragCard(ctx, before[0], target, 'keyboard');
    const afterDrag = await S.readCardIds(ctx);
    ctx.assert('reorder-applied', afterDrag[0] !== before[0], 'reorder applied');

    // Hide the second card (was first, now anywhere).
    const toHide = afterDrag[1];
    await S.toggleMetric(ctx, toHide, false);
    const afterHide = await S.readCardIds(ctx);
    ctx.assert('card-hidden', !afterHide.includes(toHide), `${toHide} hidden`);

    // Change window + view mode.
    await S.setWindow(ctx, 300);
    await S.setViewMode(ctx, 'tile');

    // Wait for persistence to settle, then restart.
    await new Promise((r) => setTimeout(r, 700));
    await S.restartApp(ctx);
    await S.waitForState(ctx, 'live');

    // Real driver: relaunch re-detects hardware progressively — wait until the
    // restored set reaches the expected size before comparing order.
    const restored = await S.waitForCards(ctx, Math.max(2, afterHide.length - 1));
    ctx.assert(
      'restored-order',
      JSON.stringify(restored) === JSON.stringify(afterHide),
      `restored order ${restored.join(',')} should equal ${afterHide.join(',')}`
    );
    ctx.assert('restored-hidden', !restored.includes(toHide), `${toHide} still hidden after restart`);

    // Persistence layer check (real settings.json on the real driver).
    const persisted = await persistedSettings(ctx);
    ctx.assert('persisted-window', persisted.windowSecs === 300, `windowSecs persisted as 300, got ${persisted.windowSecs}`);
    ctx.assert('persisted-view-mode', persisted.viewMode === 'tile', 'viewMode persisted as tile');
  },
};

// ── 3. Long-watch cadence (compressed clock) ──────────────────────────────────

const longWatchCadence: Journey = {
  id: 'long-watch-cadence',
  title: 'Long watch: chart grows under the compressed bridge clock',
  supportedDrivers: ['mock'],
  personaIds: ['sentinel'],
  async run(ctx) {
    // The clock speed is applied at launch from the scenario (SIM_SPEED, 8× on
    // the default mock lane) so the long window fits in CI wall-time.
    await S.waitForState(ctx, 'live');
    await S.setWindow(ctx, 3600);

    const count = async () => {
      const page = ctx.driver.page;
      if (!page) return 0;
      return Number(await page.locator('[data-testid="metric-chart-cpu"]').getAttribute('data-chart-latest-ts'));
    };

    const start = await count();
    await ctx.dwell();
    // With an 8× clock, the persona's dwell advances simulated timestamps;
    // real-time cadence truth belongs to cadence_probe, not re-derived here.
    const end = await count();
    ctx.assert('chart-advances', end > start, `chart timestamp advanced from ${start} to ${end}`);
    ctx.assert('bounded-growth', end - start < 120_000, `timestamp advanced within CI bounds (${end - start}ms)`);
  },
};

// ── 4. Fault response (mock lane; scripted faults) ───────────────────────────

const faultResponse: Journey = {
  id: 'fault-response',
  title: 'Fault response: collector error + disk ghost/restore',
  supportedDrivers: ['mock'],
  personaIds: ['sentinel', 'customizer'],
  async run(ctx) {
    await S.waitForState(ctx, 'live');
    await ctx.dwell();

    // 4a. Collector error → banner appears, never clears, values freeze.
    await S.injectFault(ctx, { kind: 'collector-error', message: 'metrics collection stopped — restart the app' });
    await S.waitForState(ctx, 'collector-error-banner');
    const errText = await ctx.driver.page?.locator('[data-testid="collector-error-banner"]').innerText();
    ctx.assert('banner-text', (errText ?? '').includes('restart the app'), 'banner text matches');
    // Values freeze: cpu value stops changing after the error.
    const val = async () => {
      const page = ctx.driver.page;
      if (!page) return '';
      return (await page.locator('[data-testid="metric-card-cpu"]').innerText()).replace(/\s+/g, ' ');
    };
    const v1 = await val();
    await new Promise((r) => setTimeout(r, 1200));
    const v2 = await val();
    ctx.assert('values-frozen', v1 === v2, `cpu value held (${v1.slice(0, 40)})`);
  },
};

// The ghost cycle is a separate flow; expose it as its own journey for clarity.
const diskGhostCycle: Journey = {
  id: 'fault-disk-ghost',
  title: 'Fault response: disk hotplug ghost/restore',
  supportedDrivers: ['mock'],
  personaIds: ['sentinel'],
  async run(ctx) {
    await S.waitForState(ctx, 'live');
    const before = await S.readCardIds(ctx);
    const diskId = before.find((id) => id.startsWith('disk_'));
    ctx.assert('has-disk', !!diskId, `expected a disk card, got ${before.join(',')}`);
    if (!diskId) return;
    const key = diskId.slice('disk_'.length);

    await S.injectFault(ctx, { kind: 'disk-remove', key });
    await new Promise((r) => setTimeout(r, 7000));
    const during = await S.readCardIds(ctx);
    ctx.assert('disk-hidden', !during.includes(diskId), `${diskId} pruned from view`);

    await S.injectFault(ctx, { kind: 'disk-add', key });
    await new Promise((r) => setTimeout(r, 1500));
    const restored = await S.readCardIds(ctx);
    ctx.assert('disk-restored', restored.includes(diskId), `${diskId} restored`);
  },
};

const gpuHotplugGap: Journey = {
  id: 'gpu-hotplug-gap',
  title: 'Hot-plug: a newly discovered GPU starts with a genuine history gap',
  supportedDrivers: ['mock'],
  personaIds: ['sentinel'],
  async run(ctx) {
    await S.waitForState(ctx, 'live');
    const before = await S.readCardIds(ctx);
    await S.injectFault(ctx, { kind: 'gpu-add', key: 'sim_gpu_hotplug_fixture', name: 'Hotplug Fixture GPU', vendor: 'nvidia' });

    const page = ctx.driver.page;
    if (!page) {
      ctx.assert('page-available', false, 'mock journey requires a page');
      return;
    }
    const deadline = Date.now() + 8_000;
    let addedId: string | undefined;
    while (Date.now() < deadline) {
      const current = await S.readCardIds(ctx);
      addedId = current.find((id) => id.startsWith('gpu_') && !before.includes(id));
      if (addedId) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    ctx.assert('gpu-card-added', !!addedId, `new GPU card appeared: ${addedId ?? 'none'}`);
    if (!addedId) return;

    const chart = page.locator(`[data-testid="metric-chart-${addedId}"]`);
    await chart.waitFor({ state: 'visible', timeout: 8_000 });
    const gapCount = Number(await chart.getAttribute('data-chart-gap-count'));
    ctx.assert('pre-discovery-gap', gapCount > 0, `new GPU chart exposes ${gapCount} missing historical points`);
  },
};

const schemaMismatch: Journey = {
  id: 'ipc-schema-mismatch',
  title: 'IPC contract fault: incompatible live payload is rejected visibly',
  supportedDrivers: ['mock'],
  personaIds: ['glancer'],
  // The application intentionally logs the actionable mismatch once; the
  // journey allowlist is narrow and scoped to this injected contract fault.
  allowedConsoleErrors: [/metrics schema mismatch/i],
  async run(ctx) {
    await S.waitForState(ctx, 'live');
    const page = ctx.driver.page;
    if (!page) {
      ctx.assert('page-available', false, 'schema journey requires a page');
      return;
    }
    const chart = page.locator('[data-testid="metric-chart-cpu"]');
    await S.injectFault(ctx, { kind: 'schema-version', version: 3 });
    await page.getByText(/Frontend\/backend metrics schema mismatch/i).waitFor({ state: 'visible', timeout: 5_000 });
    ctx.assert('schema-error-visible', true, 'incompatible payload shows rebuild guidance');
    const afterError = {
      points: await chart.getAttribute('data-chart-point-count'),
      latest: await chart.getAttribute('data-chart-latest-ts'),
    };
    const errorClock = await page.evaluate(() => window.__SIM__?.backend.simSeconds ?? 0);
    await page.waitForFunction(
      (start) => (window.__SIM__?.backend.simSeconds ?? 0) >= start + 0.5,
      errorClock,
      { timeout: 5_000 },
    );
    const afterMoreIncompatibleEvents = {
      points: await chart.getAttribute('data-chart-point-count'),
      latest: await chart.getAttribute('data-chart-latest-ts'),
    };
    ctx.assert(
      'schema-data-rejected',
      afterMoreIncompatibleEvents.points === afterError.points && afterMoreIncompatibleEvents.latest === afterError.latest,
      `incompatible live payload changed chart state (${afterError.points}/${afterError.latest} -> ${afterMoreIncompatibleEvents.points}/${afterMoreIncompatibleEvents.latest})`,
    );
  },
};

// ── 5. Degraded startup ───────────────────────────────────────────────────────

const degradedStartup: Journey = {
  id: 'degraded-startup',
  title: 'Degraded startup: corrupt settings + history load failure',
  supportedDrivers: ['mock'],
  personaIds: ['glancer'],
  async run(ctx) {
    // The scenario (corrupt settings + history load failure) is applied on
    // launch by the runner. The initial get_history rejects; the first live
    // snapshot (tick 4 ≈ 1 s) seeds the charts and clears the error
    // (METRICS-001), so the failure warning may be visible only briefly —
    // poll for warning-or-live, then assert the deterministic recovery.
    const page = ctx.driver.page;
    if (page) {
      const deadline = Date.now() + 5000;
      let seenWarning = false;
      let recovered = false;
      while (Date.now() < deadline) {
        const hasWarning =
          (await page.getByText(/Couldn't (load|refresh) metrics history/).count()) > 0;
        const hasCards = (await page.locator('[data-testid^="metric-card-"]').count()) > 0;
        if (hasWarning) {
          seenWarning = true;
          ctx.log('observation', { kind: 'history-warning-seen' });
        }
        if (hasCards) {
          recovered = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      ctx.assert('recovery-to-live', recovered, 'live charts rendered after failed initial history load');
      void seenWarning;
    }
    await S.waitForState(ctx, 'live');
    await ctx.dwell();
    const ids = await S.readCardIds(ctx);
    // Per-field fallback: corrupt settings fields → defaults, so the default
    // card order (cpu first) still renders.
    ctx.assert('defaults-render', ids[0] === 'cpu', `default order rendered despite corrupt settings`);
    // The window selector falls back to the default 60s.
    const page2 = ctx.driver.page;
    if (page2) {
      const selected = await page2.locator('select').inputValue();
      ctx.assert('window-default', selected === '60', `window defaults to 60s, got ${selected}`);
    }
  },
};

export const JOURNEYS: Journey[] = [
  firstLaunch,
  customizationRoundtrip,
  longWatchCadence,
  faultResponse,
  diskGhostCycle,
  gpuHotplugGap,
  schemaMismatch,
  degradedStartup,
];

export function getJourney(id: string): Journey {
  const j = JOURNEYS.find((x) => x.id === id);
  if (!j) throw new Error(`unknown journey: ${id}`);
  return j;
}
