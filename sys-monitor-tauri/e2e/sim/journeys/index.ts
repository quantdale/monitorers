/**
 * v1 journeys — code modules composing typed steps with assertions (tasks
 * 3.4–3.8). Each journey declares which drivers support it and runs against
 * `ctx.driver.page`. The mock lane scripts faults via the bridge; the real
 * lane drives the packaged app and leaves unsupported steps registered (see
 * the register discipline in e2e/exploratory-register.md).
 */
import type { Journey } from '../types';
import * as S from '../engine/steps';
import { freeRoam } from '../engine/freeroam';

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
    const persisted = await S.persistedSettings(ctx);
    ctx.assert('card-order-persisted', Array.isArray(persisted.cardOrder), 'cardOrder persisted');
    await new Promise((r) => setTimeout(r, 500));
    const again = await S.readCardIds(ctx);
    ctx.assert('order-stable', JSON.stringify(again) === JSON.stringify(ids), 'order stable across re-read');

    // Free-roam epilogue: the persona spends a couple of self-directed ticks
    // exercising its decision dice (wantsAction/wrongClick/inspectSettings).
    // Runs AFTER every assertion above, so these deliberate mutations cannot
    // invalidate the first-launch contract.
    await freeRoam(ctx, { ticks: 2 });
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

    // Wait for persistence to actually land (no fixed sleep), then restart.
    await S.waitForPersistedSettings(ctx, (s) => s.windowSecs === 300 && s.viewMode === 'tile');
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
    const persisted = await S.persistedSettings(ctx);
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

// ── 4. Fault response: budget exhaustion + manual retry (mock lane) ──────────

const faultResponse: Journey = {
  id: 'fault-retry-exhaustion',
  title: 'Fault response: exhausted recovery budget, manual retry restores',
  supportedDrivers: ['mock'],
  personaIds: ['sentinel'],
  async run(ctx) {
    await S.waitForState(ctx, 'live');
    const page = ctx.driver.page;
    if (!page) {
      ctx.assert('page-available', false, 'exhaustion journey requires a page');
      return;
    }

    const cpuValue = async () => {
      const text = await page.locator('[data-testid="metric-card-cpu"]').innerText();
      return (text.match(/\d+(?:\.\d+)?%/) ?? [''])[0];
    };

    // Repeated failures exhaust the budget: interruption is reported
    // immediately, then the persistent alert appears with the failure message
    // and an accessible Retry control.
    await S.injectFault(ctx, { kind: 'collector-crash-permanent', reason: 'repeated synthetic panics' });
    await S.waitForState(ctx, 'collector-error-banner');
    // Sample the held value only after the failed state is on screen: ticks
    // may legitimately render during fault-injection latency.
    const held = await cpuValue();
    const bannerText = await page.locator('[data-testid="collector-error-banner"]').innerText();
    ctx.assert('failure-message-visible', /recovery attempts/i.test(bannerText), `alert names the failure: ${bannerText.slice(0, 60)}`);
    const retry = page.getByRole('button', { name: /retry metrics/i });
    await retry.waitFor({ state: 'visible', timeout: 5_000 });
    ctx.assert('retry-button-accessible', await retry.isEnabled(), 'Retry metrics button is present and enabled');

    // Last-known values stay visible (no zeros) while failed.
    const duringFailure = await cpuValue();
    ctx.assert('values-retained-while-failed', held.length > 0 && held === duringFailure, `cpu value held (${held.slice(0, 40)})`);

    // No automatic restart happens while failed.
    await new Promise((r) => setTimeout(r, 1_500));
    ctx.assert('no-auto-restart', (await page.locator('[data-testid="collector-error-banner"]').count()) === 1, 'failed state persists without automatic restart');

    // Manual retry: one click leaves Failed and live collection resumes.
    await retry.click();
    const cleared = await S.pollUntil(
      async () => (await page.locator('[data-testid="collector-error-banner"]').count()) === 0,
      (gone) => gone,
      10_000
    );
    ctx.assert('retry-clears-failure', cleared, 'failure UI cleared after manual retry');
    const resumed = await S.pollUntil(cpuValue, (v) => v !== held, 15_000);
    ctx.assert('values-resume-after-retry', resumed !== held, `cpu value resumed (${resumed.slice(0, 40)})`);
  },
};

// ── 4b. Automatic recovery: interruption is transient, app stays usable ──────

const collectorRecovery: Journey = {
  id: 'collector-recovery',
  title: 'Automatic recovery: interruption shows recovering UI, then clears itself',
  supportedDrivers: ['mock'],
  personaIds: ['sentinel', 'customizer'],
  async run(ctx) {
    await S.waitForState(ctx, 'live');
    const page = ctx.driver.page;
    if (!page) {
      ctx.assert('page-available', false, 'recovery journey requires a page');
      return;
    }

    const cpuValue = async () => {
      const text = await page.locator('[data-testid="metric-card-cpu"]').innerText();
      return (text.match(/\d+(?:\.\d+)?%/) ?? [''])[0];
    };

    // Session panic: emissions stop, recovering status drives the polite banner.
    await S.injectFault(ctx, { kind: 'collector-crash', reason: 'journey synthetic panic', recoverAfterMs: 2_500 });
    await S.waitForState(ctx, 'collector-recovering-banner');
    // Sample the retained value only once recovery is visibly underway; ticks
    // may legitimately render during fault-injection latency.
    const beforeInterruption = await cpuValue();
    await S.waitForState(ctx, 'collector-recovering-banner');
    const recoveringText = await page.locator('[data-testid="collector-recovering-banner"]').innerText();
    ctx.assert('recovering-message', /recovering/i.test(recoveringText), `transient announcement shown: ${recoveringText.slice(0, 50)}`);

    // Dashboard keeps last-known values during recovery — no zeros, no blanks.
    const duringRecovery = await cpuValue();
    ctx.assert('last-known-retained', beforeInterruption.length > 0 && beforeInterruption === duringRecovery, `cpu value retained (${beforeInterruption.slice(0, 40)})`);
    ctx.assert('cards-still-present', (await page.locator('[data-testid^="metric-card-"]').count()) >= 3, 'dashboard stays rendered during recovery');

    // Automatic restoration: banner clears by itself; no restart, no user action.
    const autoCleared = await S.pollUntil(
      async () => (await page.locator('[data-testid="collector-recovering-banner"]').count()) === 0,
      (gone) => gone,
      12_000
    );
    ctx.assert('auto-clear-on-recovery', autoCleared, 'recovering banner cleared automatically after restoration');

    // Live values resume moving after the gap.
    const resumed = await S.pollUntil(cpuValue, (v) => v !== beforeInterruption, 15_000);
    ctx.assert('values-resume-after-recovery', resumed !== beforeInterruption, `cpu value resumed (${resumed.slice(0, 40)})`);

    // The app remains fully usable afterwards: a settings interaction lands and
    // persists through the normal path.
    await S.setWindow(ctx, 300);
    await S.waitForPersistedSettings(ctx, (s) => s.windowSecs === 300);
    const persisted = await S.persistedSettings(ctx);
    ctx.assert('usable-after-recovery', persisted.windowSecs === 300, `post-recovery settings interaction persisted (windowSecs=${String(persisted.windowSecs)})`);
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
    // Semantic wait: poll until the ghost TTL prunes the card (no fixed sleep).
    const during = await S.pollUntil(
      () => S.readCardIds(ctx),
      (ids) => !ids.includes(diskId),
      15_000
    );
    ctx.assert('disk-hidden', !during.includes(diskId), `${diskId} pruned from view`);

    await S.injectFault(ctx, { kind: 'disk-add', key });
    const restored = await S.pollUntil(
      () => S.readCardIds(ctx),
      (ids) => ids.includes(diskId),
      8_000
    );
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

// ── 6. PDH freeze hold + recovery (mock lane; scripted fault) ─────────────────

const freezeRecovery: Journey = {
  id: 'fault-freeze-recovery',
  title: 'Fault response: values hold during a PDH freeze, then resume',
  supportedDrivers: ['mock'],
  personaIds: ['sentinel'],
  async run(ctx) {
    await S.waitForState(ctx, 'live');
    const val = async () => {
      const page = ctx.driver.page;
      if (!page) return '';
      const text = await page.locator('[data-testid="metric-card-cpu"]').innerText();
      // Only the metric value freezes — the card also renders a clock that
      // keeps ticking through the hold, so compare the percentage alone.
      return (text.match(/\d+(?:\.\d+)?%/) ?? [''])[0];
    };

    // 128 ticks ≈ 32 simulated seconds ≈ 4 wall seconds at the lane's 8×
    // clock — comfortably longer than the sampling latency below.
    await S.injectFault(ctx, { kind: 'freeze', ticks: 128 });
    await new Promise((r) => setTimeout(r, 300)); // let a frozen emission render
    const held = await val();
    await new Promise((r) => setTimeout(r, 2_000)); // mid-freeze sample
    const mid = await val();
    ctx.assert(
      'values-held-during-freeze',
      held.length > 0 && held === mid,
      `cpu value held during freeze (${held.slice(0, 40)})`
    );

    // Once the freeze budget is spent the pipeline must resume moving.
    const resumed = await S.pollUntil(val, (v) => v !== held, 12_000);
    ctx.assert('values-resume-after-freeze', resumed !== held, 'cpu value resumed after freeze');
  },
};

// ── 7. Layout persistence: view modes + sidebar order across restart ──────────

const layoutPersistence: Journey = {
  id: 'layout-persistence',
  title: 'View-mode switch mid-run survives a restart (DOM + persisted settings)',
  supportedDrivers: ['mock'],
  personaIds: ['customizer'],
  async run(ctx) {
    await S.waitForState(ctx, 'live');
    const page = ctx.driver.page;
    if (!page) {
      ctx.assert('page-available', false, 'layout journey requires a page');
      return;
    }
    const listDisplay = () =>
      page
        .locator('[data-testid="dashboard-card-list"]')
        .evaluate((el) => getComputedStyle(el).display);
    // List rows are fixed-height compact cards (height: 50); default/tile
    // cards embed a 140px chart and are far taller.
    const firstCardHeight = () =>
      page
        .locator('[data-testid^="metric-card-"]')
        .first()
        .evaluate((el) => el.getBoundingClientRect().height);

    // default → tile: the dashboard becomes a two-column grid.
    await S.setViewMode(ctx, 'tile');
    await S.pollUntil(listDisplay, (d) => d === 'grid', 5_000);
    ctx.assert('tile-grid-applied', (await listDisplay()) === 'grid', 'tile view renders a grid');

    // tile → list: cards collapse into fixed-height compact rows.
    await S.setViewMode(ctx, 'list');
    await S.pollUntil(firstCardHeight, (h) => h > 0 && h < 80, 5_000);
    const listHeight = await firstCardHeight();
    ctx.assert('list-compacts-cards', listHeight > 0 && listHeight < 80, `list card height ${listHeight}px`);

    // Restart: layout comes back exactly as left. Sidebar reorder is NOT
    // exercised here — the mock harness has no hardware profile, so sidebar
    // cards never render (see e2e/exploratory-register.md).
    await S.restartApp(ctx);
    await S.waitForState(ctx, 'live', 30_000);
    const restored = await S.persistedSettings(ctx);
    ctx.assert(
      'restored-view-mode',
      restored.viewMode === 'list',
      `viewMode restored as list, got ${String(restored.viewMode)}`
    );
    await S.pollUntil(firstCardHeight, (h) => h > 0 && h < 80, 5_000);
    const restoredHeight = await firstCardHeight();
    ctx.assert('restored-list-dom', restoredHeight > 0 && restoredHeight < 80, `restored card height ${restoredHeight}px`);
  },
};

// ── 8. Persona free roam: decision dice drive self-directed ticks ─────────────

const personaFreeRoam: Journey = {
  id: 'persona-free-roam',
  title: 'Free roam: persona decision dice (wantsAction/wrongClick/inspectSettings) over N ticks',
  // Mock only: the pointer-drag reorder is tuned to the compressed mock clock;
  // on the real lane that step self-skips, and the lane stays unregistered
  // until driven once by hand (exploratory-register discipline).
  supportedDrivers: ['mock'],
  personaIds: ['glancer', 'customizer'],
  async run(ctx) {
    await S.waitForState(ctx, 'live');
    await S.waitForCards(ctx, 3);
    await freeRoam(ctx, { ticks: 6 });
  },
};

export const JOURNEYS: Journey[] = [
  firstLaunch,
  customizationRoundtrip,
  longWatchCadence,
  faultResponse,
  collectorRecovery,
  diskGhostCycle,
  gpuHotplugGap,
  schemaMismatch,
  degradedStartup,
  freezeRecovery,
  layoutPersistence,
  personaFreeRoam,
];

export function getJourney(id: string): Journey {
  const j = JOURNEYS.find((x) => x.id === id);
  if (!j) throw new Error(`unknown journey: ${id}`);
  return j;
}
