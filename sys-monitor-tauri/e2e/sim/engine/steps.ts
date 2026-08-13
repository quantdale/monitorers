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
import type { SimContext, JourneyState } from '../types';
import { drawThinkTime, drawDwellTime, mistakes } from './behavior';

const CARD = '[data-testid^="metric-card-"]';
const CARD_ID = (id: string) => `[data-testid="metric-card-${id}"]`;
const SIDEBAR_HANDLE = 'div[title="Drag to reorder"]';
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

/** Reads the current sidebar card ids in DOM order. */
export async function readSidebarCardIds(ctx: SimContext): Promise<string[]> {
  const page = ctx.driver.page;
  if (!page) return [];
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-sb-id]')).map((n) =>
      (n.getAttribute('data-sb-id') ?? '').replace(/^sb_/, '')
    )
  );
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
  await page.locator('input[type="checkbox"]').first().waitFor({ state: 'visible' });
}

export async function toggleMetric(ctx: SimContext, cardId: string, visible: boolean): Promise<void> {
  const page = ctx.driver.page;
  await sleep(await drawThinkTime(ctx));
  if (!page) return;
  // Modeled mistake: personality may Escape-close the dropdown before selecting.
  if (mistakes(ctx, 'escapeDropdown')) {
    await openDropdown(ctx);
    await sleep(await drawDwellTime(ctx));
    await page.keyboard.press('Escape');
    await page.locator('input[type="checkbox"]').first().waitFor({ state: 'hidden' });
    ctx.log('action', { kind: 'toggleMetric', cardId, visible, outcome: 'escaped' });
    await openDropdown(ctx);
  } else {
    await openDropdown(ctx);
  }
  await page.waitForTimeout(250);
  // The checkbox labeled with the card's display label.
  const label = await cardLabelFor(ctx, cardId);
  const checkbox = page.locator('label', { hasText: label }).locator('input[type="checkbox"]');
  const isChecked = await checkbox.isChecked();
  if (isChecked !== visible) {
    await checkbox.click();
  }
  await page.keyboard.press('Escape');
  await page.locator('input[type="checkbox"]').first().waitFor({ state: 'hidden' });
  ctx.log('action', { kind: 'toggleMetric', cardId, visible });
}

async function cardLabelFor(ctx: SimContext, cardId: string): Promise<string> {
  const page = ctx.driver.page;
  if (!page) return cardId;
  // The card's display title (matches the dropdown's item.label, which App
  // computes via getCardLabel). Strip trailing whitespace only.
  const text = await page.locator(`[data-testid="metric-title-${cardId}"]`).innerText();
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
    await src.dragTo(dst);
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

export async function dragSidebarCard(ctx: SimContext, from: string, to: string): Promise<void> {
  const page = ctx.driver.page;
  await sleep(await drawThinkTime(ctx));
  if (!page) return;
  await page.locator('button[title="Show hardware info"]').click();
  await page.waitForTimeout(300);
  const handles = page.locator(SIDEBAR_HANDLE);
  const count = await handles.count();
  if (count < 2) {
    ctx.assert('dragSidebarCard', false, 'fewer than 2 sidebar cards to reorder');
    return;
  }
  const src = handles.nth(0);
  await src.focus();
  await page.keyboard.press('Space');
  await sleep(150);
  await page.keyboard.press('ArrowDown');
  await sleep(150);
  await page.keyboard.press('Enter');
  ctx.log('action', { kind: 'dragSidebarCard', from, to });
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
