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

/**
 * Counts the data points rendered in a card's chart. The area fill path
 * (`.recharts-area-area`) carries one command letter per data point, unlike
 * the stroke curve, which Recharts downsamples when the point count exceeds
 * the pixel width. Falls back to the longest path if the class is renamed.
 */
export async function chartPointCount(page: Page, id: string): Promise<number> {
  return page.locator(`${CARD_ID(id)} svg path`).evaluateAll((paths) => {
    const count = (p: Element) => (p.getAttribute('d') ?? '').match(/[MLCQAST]/g)?.length ?? 0;
    const fill = paths.find((p) => (p.getAttribute('class') ?? '').includes('area-area'));
    if (fill) return count(fill);
    return paths.reduce((max, p) => Math.max(max, count(p)), 0);
  });
}

/**
 * Asserts a card's chart keeps growing at ~1 point per second (the 1 Hz
 * history commit cadence), with generous tolerance for render timing.
 */
export async function assertChartGrowth(page: Page, id: string, seconds = 6): Promise<void> {
  const before = await chartPointCount(page, id);
  await page.waitForTimeout(seconds * 1000);
  const after = await chartPointCount(page, id);
  const expected = seconds; // 1 Hz commits
  const tolerance = Math.max(2, Math.ceil(expected * 0.5));
  expect(Math.abs(after - before - expected)).toBeLessThanOrEqual(tolerance);
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
