/**
 * Typed step library — every user-reachable interaction, plus state
 * checkpoints. Steps are driver-agnostic (they operate on `ctx.driver.page`)
 * and use driver-level waits (never fixed sleeps) except where human timing is
 * the point of the step (dwell/think delays come from the persona).
 *
 * Each step returns a boolean success so journeys can branch on recoverable
 * outcomes; hard failures are surfaced via `ctx.assert`.
 */
import { expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SimContext, JourneyState } from '../types';
import { drawThinkTime, drawDwellTime, mistakes } from './behavior';

const CARD = '[data-testid^="metric-card-"]';
const CARD_ID = (id: string) => `[data-testid="metric-card-${id}"]`;
// Sidebar drag handles are buttons inside the hardware sidebar (see
// SortableSidebarCard.tsx); the sidebar does not expose card ids as DOM
// attributes, so sidebar-order assertions go through persisted settings.
const SIDEBAR_HANDLE = '#hardware-sidebar button[title="Drag to reorder"]';
const DASH_HANDLE = '.drag-handle';

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Reads the current card ids in DOM order (dashboard). */
export async function readCardIds(ctx: SimContext): Promise<string[]> {
  const page = ctx.driver.page;
  if (!page) return [];
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="metric-card-"]'))
      .map((n) => (n.getAttribute('data-testid') ?? '').replace(/^metric-card-/, ''))
  );
}

/**
 * Polls `read()` until `predicate` holds or the deadline passes, returning
 * the last value. Semantic replacement for fixed sleeps: waits exactly as
 * long as the app needs, and no longer.
 */
export async function pollUntil<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  intervalMs = 200
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await sleep(intervalMs);
    value = await read();
  }
  return value;
}

// ── Persisted settings (per-run shim on mock, temp settings.json on real) ─────

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

/** Reads the run's persisted settings regardless of lane. */
export async function persistedSettings(ctx: SimContext): Promise<Record<string, unknown>> {
  return ctx.driver.kind === 'real' ? readRealSettings(ctx) : readSettingsShim(ctx);
}

/** Polls persisted settings until `predicate` holds (persistence-settle wait). */
export async function waitForPersistedSettings(
  ctx: SimContext,
  predicate: (settings: Record<string, unknown>) => boolean,
  timeoutMs = 8_000
): Promise<Record<string, unknown>> {
  return pollUntil(() => persistedSettings(ctx), predicate, timeoutMs);
}

// ── State checkpoints ─────────────────────────────────────────────────────────

/** Polls until at least `minCount` cards are rendered (real-driver restart
 *  race: hardware cards appear progressively as detection settles). */
export async function waitForCards(ctx: SimContext, minCount: number, timeoutMs = 20_000): Promise<string[]> {
  const page = ctx.driver.page;
  if (!page) throw new Error('waitForCards: no page');
  const deadline = Date.now() + timeoutMs;
  let last: string[] = [];
  while (Date.now() < deadline) {
    last = await readCardIds(ctx);
    if (last.length >= minCount) {
      const required = ['cpu', 'memory', 'network'];
      const hasSubset = required.every((id) => last.includes(id));
      if (hasSubset) break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  ctx.assert(
    `cards-settled(>=${minCount})`,
    last.length >= minCount,
    `cards visible: ${last.join(',')}`
  );
  return last;
}

export async function waitForState(ctx: SimContext, state: JourneyState, timeoutMs = 15_000): Promise<void> {
  const page = ctx.driver.page;
  if (!page) throw new Error('waitForState: no page');
  const started = Date.now();
  const label = `state=${state}`;
  try {
    switch (state) {
      case 'live':
        await page.waitForSelector(CARD, { state: 'attached', timeout: timeoutMs });
        await page.locator(CARD).first().waitFor({ state: 'visible', timeout: timeoutMs });
        break;
      case 'collecting':
        await page.getByText('Collecting metrics…').waitFor({ state: 'visible', timeout: timeoutMs });
        break;
      case 'collector-error-banner':
        await page.locator('[data-testid="collector-error-banner"]').waitFor({ state: 'visible', timeout: timeoutMs });
        break;
      case 'collector-recovering-banner':
        await page.locator('[data-testid="collector-recovering-banner"]').waitFor({ state: 'visible', timeout: timeoutMs });
        break;
      case 'history-error-inline':
        await page.getByText(/Couldn't refresh metrics history/).waitFor({ state: 'visible', timeout: timeoutMs });
        break;
      case 'history-error-fatal':
        await page.getByText(/Couldn't load metrics history/).waitFor({ state: 'visible', timeout: timeoutMs });
        break;
      case 'all-hidden':
        await page.getByText('All metrics hidden').waitFor({ state: 'visible', timeout: timeoutMs });
        break;
      case 'settings-error':
        await page.getByText(/Couldn't load settings/).waitFor({ state: 'visible', timeout: timeoutMs });
        break;
      case 'loading':
        await page.waitForTimeout(300);
        break;
    }
    ctx.assert(label, true, `reached state ${state} in ${Date.now() - started}ms`);
  } catch (e) {
    ctx.assert(label, false, `did not reach ${state} within ${timeoutMs}ms: ${String(e)}`);
    throw e;
  }
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

export async function toggleSidebar(ctx: SimContext): Promise<void> {
  const page = ctx.driver.page;
  await sleep(await drawThinkTime(ctx));
  if (!page) return;
  await page.locator('button[title="Show hardware info"], button[title="Hide hardware info"]').first().click();
  ctx.log('action', { kind: 'toggleSidebar' });
}

export async function setWindow(ctx: SimContext, secs: number): Promise<void> {
  const page = ctx.driver.page;
  await sleep(await drawThinkTime(ctx));
  if (!page) return;
  await page.locator('select').selectOption(String(secs));
  await page.waitForTimeout(400); // let the sliced window re-render
  ctx.log('action', { kind: 'setWindow', secs });
}

export async function setViewMode(ctx: SimContext, mode: 'default' | 'tile' | 'list'): Promise<void> {
  const page = ctx.driver.page;
  await sleep(await drawThinkTime(ctx));
  if (!page) return;
  await page.getByRole('button', { name: mode === 'default' ? 'Default' : mode === 'tile' ? 'Tile' : 'List' }).click();
  ctx.log('action', { kind: 'setViewMode', mode });
}

// ── Metrics dropdown ──────────────────────────────────────────────────────────

async function openDropdown(ctx: SimContext): Promise<void> {
  const page = ctx.driver.page;
  if (!page) return;
  await page.getByRole('button', { name: /^Metrics \(/ }).click();
  // Bounded: an unbounded wait here once turned a missing dropdown into a
  // silent multi-minute journey stall instead of a fast classified failure.
  await page.locator('input[type="checkbox"]').first().waitFor({ state: 'visible', timeout: 5_000 });
}

export async function toggleMetric(
  ctx: SimContext,
  cardId: string,
  visible: boolean,
  label?: string
): Promise<void> {
  const page = ctx.driver.page;
  await sleep(await drawThinkTime(ctx));
  if (!page) return;
  // Modeled mistake: personality may Escape-close the dropdown before selecting.
  if (mistakes(ctx, 'escapeDropdown')) {
    await openDropdown(ctx);
    await sleep(await drawDwellTime(ctx));
    await page.keyboard.press('Escape');
    await page.locator('input[type="checkbox"]').first().waitFor({ state: 'hidden', timeout: 5_000 });
    ctx.log('action', { kind: 'toggleMetric', cardId, visible, outcome: 'escaped' });
    await openDropdown(ctx);
  } else {
    await openDropdown(ctx);
  }
  await page.waitForTimeout(250);
  // The checkbox labeled with the card's display label. Callers that already
  // know the label pass it precomputed — a HIDDEN card has no DOM title to
  // look up, so a hide→restore round-trip must capture the label up front.
  const resolved = label ?? (await cardLabelFor(ctx, cardId));
  const checkbox = page.locator('label', { hasText: resolved }).locator('input[type="checkbox"]');
  const isChecked = await checkbox.isChecked();
  if (isChecked !== visible) {
    await checkbox.click();
  }
  await page.keyboard.press('Escape');
  await page.locator('input[type="checkbox"]').first().waitFor({ state: 'hidden' });
  ctx.log('action', { kind: 'toggleMetric', cardId, visible });
}

/** The card's display label as shown in the Metrics dropdown (see
 *  toggleMetric's `label` param — capture BEFORE hiding the card). */
export async function cardLabelFor(ctx: SimContext, cardId: string): Promise<string> {
  const page = ctx.driver.page;
  if (!page) return cardId;
  // The card's display title (matches the dropdown's item.label, which App
  // computes via getCardLabel). Strip trailing whitespace only. Bounded so a
  // missing title fails fast instead of stalling the journey forever.
  const text = await page
    .locator(`[data-testid="metric-title-${cardId}"]`)
    .innerText({ timeout: 5_000 });
  return text.trim() || cardId;
}

// ── Drag reorder ──────────────────────────────────────────────────────────────

export async function dragCard(ctx: SimContext, from: string, to: string, via: 'pointer' | 'keyboard'): Promise<void> {
  const page = ctx.driver.page;
  await sleep(await drawThinkTime(ctx));
  if (!page) return;
  const before = await readCardIds(ctx);
  const fromIdx = before.indexOf(from);
  const toIdx = before.indexOf(to);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
    ctx.assert(`drag:${from}->${to}`, false, `cards not both present (${before.join(',')})`);
    return;
  }
  // Modeled mistake: mis-drag that cancels.
  if (via === 'keyboard' && mistakes(ctx, 'misdrag')) {
    const handle = page.locator(`${CARD_ID(from)} ${DASH_HANDLE}`);
    await handle.focus();
    await page.keyboard.press('Space');
    await sleep(150);
    await page.keyboard.press('Escape'); // cancel
    ctx.log('action', { kind: 'dragCard', from, to, via, outcome: 'cancelled' });
    return;
  }
  if (via === 'pointer') {
    const src = page.locator(`${CARD_ID(from)} ${DASH_HANDLE}`);
    const dst = page.locator(`${CARD_ID(to)} ${DASH_HANDLE}`);
    // dnd-kit's PointerSensor tracks intermediate pointer moves — a single
    // dragTo teleport is ignored, so drive the mouse explicitly (same recipe
    // as e2e/tests/drag-reorder.spec.ts).
    const srcBox = await src.boundingBox({ timeout: 5_000 });
    const dstBox = await dst.boundingBox({ timeout: 5_000 });
    if (!srcBox || !dstBox) {
      ctx.assert(`drag:${from}->${to}`, false, 'drag handles not visible for pointer drag');
      return;
    }
    await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, { steps: 12 });
    await page.mouse.up();
  } else {
    const handle = page.locator(`${CARD_ID(from)} ${DASH_HANDLE}`);
    await handle.focus();
    await page.keyboard.press('Space');
    await sleep(150);
    const diff = toIdx - fromIdx;
    for (let i = 0; i < Math.abs(diff); i += 1) {
      await page.keyboard.press(diff > 0 ? 'ArrowDown' : 'ArrowUp');
      await sleep(120);
    }
    await page.keyboard.press('Enter');
  }
  await expect
    .poll(async () => (await readCardIds(ctx)).indexOf(from), { timeout: 4000 })
    .not.toBe(fromIdx);
  ctx.log('action', { kind: 'dragCard', from, to, via });
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

/** Opens the hardware sidebar (idempotent — handles both toggle titles). */
export async function openSidebar(ctx: SimContext): Promise<void> {
  const page = ctx.driver.page;
  if (!page) return;
  await page
    .locator('button[title="Show hardware info"], button[title="Hide hardware info"]')
    .first()
    .click();
  await page.locator(SIDEBAR_HANDLE).first().waitFor({ state: 'visible', timeout: 5_000 });
}

/**
 * Keyboard-drags the first sidebar card down one slot. REAL LANE ONLY: the
 * mock harness never has a hardware profile (`useHardwareProfile` bails when
 * `isTauri()` is false), so sidebar cards — and their drag handles — do not
 * render in the browser (see e2e/exploratory-register.md).
 */
export async function dragSidebarCard(ctx: SimContext): Promise<void> {
  const page = ctx.driver.page;
  await sleep(await drawThinkTime(ctx));
  if (!page) return;
  await openSidebar(ctx);
  const handles = page.locator(SIDEBAR_HANDLE);
  const count = await handles.count();
  if (count < 2) {
    ctx.assert('dragSidebarCard', false, 'fewer than 2 sidebar cards to reorder');
    return;
  }
  // Keyboard drag: move the first sidebar card down one slot (dnd-kit
  // keyboard sensor, same pattern as the dashboard reorder).
  await handles.nth(0).focus();
  await page.keyboard.press('Space');
  await sleep(150);
  await page.keyboard.press('ArrowDown');
  await sleep(150);
  await page.keyboard.press('Enter');
  ctx.log('action', { kind: 'dragSidebarCard' });
}

// ── ErrorBoundary retry ───────────────────────────────────────────────────────

export async function retryCard(ctx: SimContext, cardId: string): Promise<void> {
  const page = ctx.driver.page;
  if (!page) return;
  await expect(page.locator(CARD_ID(cardId))).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  ctx.log('action', { kind: 'retryCard', cardId });
}

// ── Restart ───────────────────────────────────────────────────────────────────

export async function restartApp(ctx: SimContext): Promise<void> {
  const page = ctx.driver.page;
  if (!page) return;
  await sleep(await drawThinkTime(ctx));
  await ctx.driver.restartApp();
  ctx.log('action', { kind: 'restartApp' });
}

// ── Fault injection ───────────────────────────────────────────────────────────

export async function injectFault(ctx: SimContext, fault: Parameters<SimContext['driver']['injectFault']>[0]): Promise<void> {
  const ok = await ctx.driver.injectFault(fault);
  if (!ok) {
    ctx.assert(`inject:${fault.kind}`, false, `driver ${ctx.driver.kind} does not support ${fault.kind}`);
    return;
  }
  ctx.log('action', { kind: 'injectFault', fault });
}
