/**
 * Persona free-roam step — seeded self-directed interaction.
 *
 * Instead of a scripted sequence, each tick asks the persona's decision dice
 * (`wantsAction`) which of the free-roam action kinds it wants, plus the
 * `wrongClick` mistake die — the previously declared-but-unused decision
 * levers. Every executed action carries its own observable postcondition (DOM
 * and/or persisted settings), so a pass means the app actually applied what
 * the persona did, not merely that clicks landed. A tick whose dice all come
 * up empty is a "watched" observation; a closing settings-consistency
 * checkpoint keeps the step non-vacuous even then.
 *
 * Determinism: decision draws happen in a fixed order (FREE_ROAM_ACTIONS
 * declaration order, then the mistake die), so the same SIM_SEED reproduces
 * the exact plan — verified by the trust test in run.spec.ts.
 */
import type { SimContext } from '../types';
import { mistakes, wantsAction } from './behavior';
import * as S from './steps';

/** Action kinds a persona may exercise in free roam, in draw order. */
export const FREE_ROAM_ACTIONS = [
  'toggleSidebar',
  'setWindow',
  'toggleMetric',
  'setViewMode',
  'reorderDashboard',
  'inspectSettings',
] as const;

export type FreeRoamAction = (typeof FREE_ROAM_ACTIONS)[number];

export interface FreeRoamDecision {
  tick: number;
  /** Actions the persona's dice want this tick (subset of FREE_ROAM_ACTIONS). */
  actions: FreeRoamAction[];
  /** Modeled wrong-click before this tick's actions. */
  wrongClick: boolean;
}

/** Pure decision layer: fixed draw order ⇒ same seed ⇒ same plan. */
export function planFreeRoamTick(ctx: SimContext, tick: number): FreeRoamDecision {
  const actions = FREE_ROAM_ACTIONS.filter((kind) => wantsAction(ctx, kind));
  const wrongClick = mistakes(ctx, 'wrongClick');
  return { tick, actions, wrongClick };
}

// ── DOM readers (aria/state hooks rendered by App + selectors) ────────────────

const SIDEBAR_TOGGLE = 'button[aria-controls="hardware-sidebar"]';
const VIEW_MODE_GROUP = '[role="group"][aria-label="Dashboard view mode"]';
const WINDOW_SELECT = 'select[aria-label="History time range"]';
const DASHBOARD_LIST = '[data-testid="dashboard-card-list"]';
type ViewModeKey = 'default' | 'tile' | 'list';
const VIEW_MODES: ViewModeKey[] = ['default', 'tile', 'list'];
const WINDOW_CHOICES = [30, 60, 300, 600];

async function sidebarExpanded(ctx: SimContext): Promise<boolean> {
  const page = ctx.driver.page;
  if (!page) return false;
  return (await page.locator(SIDEBAR_TOGGLE).getAttribute('aria-expanded')) === 'true';
}

async function activeViewMode(ctx: SimContext): Promise<ViewModeKey> {
  const page = ctx.driver.page;
  if (!page) return 'default';
  const label = await page.locator(`${VIEW_MODE_GROUP} button[aria-pressed="true"]`).innerText();
  return label.trim().toLowerCase() as ViewModeKey;
}

async function dashboardDisplay(ctx: SimContext): Promise<string> {
  const page = ctx.driver.page;
  if (!page) return '';
  return page.locator(DASHBOARD_LIST).evaluate((el) => getComputedStyle(el).display);
}

/**
 * Persisted-settings ↔ rendered-UI consistency (the inspectSettings action):
 * what the user sees must be exactly what the store holds.
 */
interface ConsistencyReport {
  ok: boolean;
  failures: string[];
}

async function readConsistency(ctx: SimContext): Promise<ConsistencyReport> {
  const page = ctx.driver.page;
  if (!page) return { ok: false, failures: ['no page'] };
  const persisted = await S.persistedSettings(ctx);
  const failures: string[] = [];

  // Unset persisted fields mean "app default" (first launch only writes a
  // field when it changes), so compare the UI against the effective value.
  const DEFAULT_WINDOW_SECS = 60;
  const expectedWindow = typeof persisted.windowSecs === 'number' ? persisted.windowSecs : DEFAULT_WINDOW_SECS;
  const uiWindow = await page.locator(WINDOW_SELECT).inputValue();
  if (Number(uiWindow) !== expectedWindow) {
    failures.push(`windowSecs ui=${uiWindow} persisted=${String(persisted.windowSecs)}`);
  }
  const expectedMode: ViewModeKey =
    typeof persisted.viewMode === 'string' ? (persisted.viewMode as ViewModeKey) : 'default';
  const uiMode = await activeViewMode(ctx);
  if (uiMode !== expectedMode) {
    failures.push(`viewMode ui=${uiMode} persisted=${String(persisted.viewMode)}`);
  }
  const domIds = await S.readCardIds(ctx);
  const hidden = Array.isArray(persisted.hiddenCardIds) ? (persisted.hiddenCardIds as string[]) : [];
  const leakedHidden = domIds.filter((id) => hidden.includes(id));
  if (leakedHidden.length > 0) {
    failures.push(`hidden-but-rendered cards: ${leakedHidden.join(',')}`);
  }
  if (!Array.isArray(persisted.cardOrder)) {
    failures.push('cardOrder missing from persisted settings');
  } else {
    const order = persisted.cardOrder as string[];
    const missingFromOrder = domIds.filter((id) => !order.includes(id));
    if (missingFromOrder.length > 0) {
      failures.push(`rendered cards absent from cardOrder: ${missingFromOrder.join(',')}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

/** Polls until persisted settings agree with the UI (store writes are async). */
async function assertSettingsConsistency(ctx: SimContext, label: string): Promise<void> {
  const report = await S.pollUntil(() => readConsistency(ctx), (r) => r.ok, 8_000);
  ctx.assert(
    label,
    report.ok,
    report.ok ? 'persisted settings match the rendered UI' : report.failures.join('; ')
  );
}

// ── Per-action executors (each with its own observable postcondition) ─────────

async function doToggleSidebar(ctx: SimContext): Promise<void> {
  const before = await sidebarExpanded(ctx);
  await S.toggleSidebar(ctx);
  const after = await S.pollUntil(() => sidebarExpanded(ctx), (v) => v !== before, 4_000);
  ctx.assert('roam:toggleSidebar-flipped', after !== before, `aria-expanded ${before} → ${after}`);
}

async function doSetWindow(ctx: SimContext): Promise<void> {
  const secs = WINDOW_CHOICES[ctx.rng.int(0, WINDOW_CHOICES.length - 1)];
  await S.setWindow(ctx, secs);
  const applied = await S.pollUntil(async () => {
    const page = ctx.driver.page;
    return page ? page.locator(WINDOW_SELECT).inputValue() : '';
  }, (v) => v === String(secs), 4_000);
  ctx.assert('roam:setWindow-applied', applied === String(secs), `window select shows ${applied}`);
  const persisted = await S.waitForPersistedSettings(ctx, (s) => s.windowSecs === secs);
  ctx.assert('roam:setWindow-persisted', persisted.windowSecs === secs, `windowSecs persisted as ${secs}`);
}

async function doToggleMetric(ctx: SimContext): Promise<void> {
  const ids = await S.readCardIds(ctx);
  // Never hide into the "All metrics hidden" state — keep at least one card.
  if (ids.length < 2) {
    ctx.log('observation', { kind: 'toggleMetric-skipped', reason: `only ${ids.length} card(s) visible` });
    return;
  }
  const target = ids[ctx.rng.int(0, ids.length - 1)];
  // Capture the display label while the card is still rendered: once hidden,
  // the card's DOM (and its title element) is gone, so the restore pass cannot
  // look the label up — that unbounded lookup was a multi-minute stall.
  const label = await S.cardLabelFor(ctx, target);
  await S.toggleMetric(ctx, target, false, label);
  const hidden = await S.pollUntil(() => S.readCardIds(ctx), (v) => !v.includes(target), 5_000);
  ctx.assert('roam:toggleMetric-hidden', !hidden.includes(target), `${target} removed from the dashboard`);
  await S.toggleMetric(ctx, target, true, label);
  const restored = await S.pollUntil(() => S.readCardIds(ctx), (v) => v.includes(target), 8_000);
  ctx.assert('roam:toggleMetric-restored', restored.includes(target), `${target} restored to the dashboard`);
}

async function doSetViewMode(ctx: SimContext): Promise<void> {
  const current = await activeViewMode(ctx);
  const options = VIEW_MODES.filter((m) => m !== current);
  const mode = options[ctx.rng.int(0, options.length - 1)];
  await S.setViewMode(ctx, mode);
  const applied = await S.pollUntil(() => activeViewMode(ctx), (v) => v === mode, 4_000);
  ctx.assert('roam:setViewMode-applied', applied === mode, `pressed button is ${applied}`);
  // Layout consequence: tile renders a two-column grid, others a flex column.
  const expectedDisplay = mode === 'tile' ? 'grid' : 'flex';
  const display = await S.pollUntil(() => dashboardDisplay(ctx), (d) => d === expectedDisplay, 4_000);
  ctx.assert('roam:setViewMode-layout', display === expectedDisplay, `dashboard display is ${display}`);
}

async function doReorderDashboard(ctx: SimContext): Promise<void> {
  // Pointer drag only: the keyboard path interleaves a misdrag die inside the
  // step, and free-roam asserts an unconditional outcome. On the real lane the
  // pointer drag crosses the CDP relaunch boundary — registered-risk territory
  // (see e2e/exploratory-register.md), so it is skipped there rather than flaked.
  if (ctx.driver.kind === 'real') {
    ctx.log('observation', { kind: 'reorderDashboard-skipped', reason: 'real-lane pointer drag over CDP' });
    return;
  }
  const ids = await S.readCardIds(ctx);
  if (ids.length < 2) {
    ctx.log('observation', { kind: 'reorderDashboard-skipped', reason: `only ${ids.length} card(s) visible` });
    return;
  }
  const before = ids.join('|');
  await S.dragCard(ctx, ids[0], ids[1], 'pointer');
  const after = await S.readCardIds(ctx);
  ctx.assert('roam:reorder-applied', after.join('|') !== before, `${before} → ${after.join('|')}`);
}

async function doInspectSettings(ctx: SimContext): Promise<void> {
  await assertSettingsConsistency(ctx, 'roam:inspectSettings-consistent');
}

/** Modeled mistake: click a harmless non-control, then verify nothing changed. */
async function doWrongClick(ctx: SimContext): Promise<void> {
  const page = ctx.driver.page;
  if (!page) return;
  const beforeCount = (await S.readCardIds(ctx)).length;
  await page.getByText('System Monitor').first().click();
  const afterCount = (await S.readCardIds(ctx)).length;
  const banners = await page.locator('[data-testid="collector-error-banner"]').count();
  ctx.assert(
    'roam:wrongClick-harmless',
    afterCount === beforeCount && banners === 0,
    `cards ${beforeCount}→${afterCount}, error banners ${banners}`
  );
}

function performAction(ctx: SimContext, action: FreeRoamAction): Promise<void> {
  switch (action) {
    case 'toggleSidebar':
      return doToggleSidebar(ctx);
    case 'setWindow':
      return doSetWindow(ctx);
    case 'toggleMetric':
      return doToggleMetric(ctx);
    case 'setViewMode':
      return doSetViewMode(ctx);
    case 'reorderDashboard':
      return doReorderDashboard(ctx);
    case 'inspectSettings':
      return doInspectSettings(ctx);
  }
}

// ── The step ──────────────────────────────────────────────────────────────────

export interface FreeRoamOptions {
  /** Number of seeded decision ticks. */
  ticks: number;
}

/**
 * Runs `ticks` self-directed persona ticks against a live dashboard. Assumes
 * the journey already reached the live state (waitForState/waitForCards).
 */
export async function freeRoam(ctx: SimContext, opts: FreeRoamOptions): Promise<void> {
  for (let tick = 1; tick <= opts.ticks; tick += 1) {
    const decision = planFreeRoamTick(ctx, tick);
    ctx.log('free-roam-tick', { tick, planned: decision.actions, wrongClick: decision.wrongClick });
    await ctx.dwell(); // watch the dashboard before acting
    if (decision.wrongClick) await doWrongClick(ctx);
    if (decision.actions.length === 0) {
      ctx.log('observation', { kind: 'watched', tick });
      continue;
    }
    for (const action of decision.actions) {
      await performAction(ctx, action);
    }
  }
  // Closing checkpoint: guaranteed non-vacuous even when every die came up
  // empty across all ticks.
  await assertSettingsConsistency(ctx, 'roam:final-consistent');
  ctx.log('free-roam-end', { ticks: opts.ticks });
}
