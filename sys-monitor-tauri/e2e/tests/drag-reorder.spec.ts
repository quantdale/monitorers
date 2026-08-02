import { test, expect } from '@playwright/test';
import { waitForFirstMetrics, readCardIds } from './helpers';

// Drag-to-reorder is a core UX promise. Two independent input paths are
// exercised: the pointer (mouse) and the keyboard (accessible drag via dnd-kit
// KeyboardSensor). Settings persistence is out of scope here — it is covered
// by useSettings.persistence.test.ts unit tests.
test.describe('drag to reorder', () => {
  test('reorders cards by keyboard', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    const before = await readCardIds(page);
    expect(before[0]).toBe('cpu');

    await page.locator('.drag-handle').first().focus();
    await page.keyboard.press('Space'); // begin drag (dnd-kit keyboard sensor)
    await page.waitForTimeout(150); // let the drag activation register
    await page.keyboard.press('ArrowDown'); // move one slot down
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter'); // drop

    // React applies the reorder asynchronously after the drop keyup.
    await expect
      .poll(async () => (await readCardIds(page))[0], { timeout: 3_000 })
      .not.toBe('cpu');

    const after = await readCardIds(page);
    // Only the order changed — same cards, same count.
    expect([...after].sort()).toEqual([...before].sort());
  });

  test('reorders cards by pointer drag', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    const before = await readCardIds(page);
    const source = page.locator('[data-testid="metric-card-cpu"] .drag-handle');
    const target = page.locator('[data-testid="metric-card-memory"] .drag-handle');
    await source.dragTo(target);

    await expect
      .poll(async () => (await readCardIds(page))[0], { timeout: 3_000 })
      .not.toBe('cpu');

    const after = await readCardIds(page);
    expect([...after].sort()).toEqual([...before].sort());
  });
});
