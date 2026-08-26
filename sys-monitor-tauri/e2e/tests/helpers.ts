import { type Page, expect } from '@playwright/test';

// Test helpers for the browser/mock harness (see playwright.config.ts for why
// these tests run against Vite's mock-data mode rather than the Tauri app).
//
// All card ids are slugified on the frontend (src/cardIdentity.ts), e.g.
// "gpu_uhd_graphics", and every MetricCard renders
// data-testid="metric-card-<slug>" (sortable and standalone paths alike).

const CARD = '[data-testid^="metric-card-"]';
const CARD_ID = (id: string) => `[data-testid="metric-card-${id}"]`;

/** Waits for the first metrics card to render (mock data is ~immediate). */
export async function waitForFirstMetrics(page: Page): Promise<void> {
  await expect(page.locator(CARD).first()).toBeVisible({ timeout: 10_000 });
}

/** Reads the displayed text of a card (title, live value, badges). */
export async function readCardText(page: Page, id: string): Promise<string> {
  return (await page.locator(CARD_ID(id)).innerText()).trim();
}

/** Returns the card ids in current DOM order. */
export async function readCardIds(page: Page): Promise<string[]> {
  return page.locator(CARD).evaluateAll((nodes) =>
    nodes.map((n) => {
      const testId = n.getAttribute('data-testid') ?? '';
      return testId.replace(/^metric-card-/, '');
    })
  );
}

/** Reads the app-owned order signal emitted by the dashboard after a reorder. */
export async function readDashboardCardOrder(page: Page): Promise<string[]> {
  const value = await page.getByTestId('dashboard-card-list').getAttribute('data-card-order');
  return value ? value.split('|').filter(Boolean) : [];
}

/**
 * First GPU card id. The exact GPU is unknown until runtime (slug from the
 * display name), so specs must resolve it dynamically instead of hardcoding.
 */
export async function firstGpuCardId(page: Page): Promise<string> {
  const ids = await readCardIds(page);
  const gpu = ids.find((id) => id.startsWith('gpu_'));
  if (!gpu) throw new Error('no GPU card found — mock payload missing gpu cards?');
  return gpu;
}

/** Reads app-owned chart metadata. This deliberately does not depend on
 * Recharts' internal SVG class names or path commands. */
export async function chartPointCount(page: Page, id: string): Promise<number> {
  return Number(await page.locator(`${CARD_ID(id)} [data-testid="metric-chart-${id}"]`).getAttribute('data-chart-point-count'));
}

export async function chartTimeSpanMs(page: Page, id: string): Promise<number> {
  return Number(await page.locator(`${CARD_ID(id)} [data-testid="metric-chart-${id}"]`).getAttribute('data-chart-span-ms'));
}

export async function chartLatestTimestamp(page: Page, id: string): Promise<number> {
  return Number(await page.locator(`${CARD_ID(id)} [data-testid="metric-chart-${id}"]`).getAttribute('data-chart-latest-ts'));
}

/** Asserts a card's displayed value changes at least `minChanges` times. */
export async function assertUpdatesAtLeast(
  page: Page,
  id: string,
  minChanges: number,
  windowMs: number
): Promise<void> {
  const seen = new Set<string>();
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    seen.add(await readCardText(page, id));
    await page.waitForTimeout(200);
  }
  expect(seen.size, `card '${id}' changed value at least ${minChanges} times`).toBeGreaterThanOrEqual(
    minChanges
  );
}
