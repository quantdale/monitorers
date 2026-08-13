import { test, expect } from '@playwright/test';
import { waitForFirstMetrics, readDashboardCardOrder } from './helpers';

// Drag-to-reorder is a core UX promise. Two independent input paths are
// exercised: the pointer (mouse) and the keyboard (accessible drag via dnd-kit
// KeyboardSensor). Settings persistence is out of scope here — it is covered
// by useSettings.persistence.test.ts unit tests.
test.describe('drag to reorder', () => {
  test('reorders cards by keyboard', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    const before = await readDashboardCardOrder(page);
    expect(before[0]).toBe('cpu');

    await page.locator('.drag-handle').first().focus();
    await page.keyboard.press('Space'); // begin drag (dnd-kit keyboard sensor)
    await expect(page.getByTestId('dashboard-card-list')).toHaveAttribute('data-dragging', 'true');
    await page.keyboard.press('ArrowDown'); // move one slot down
    await expect
      .poll(async () => page.locator('[data-testid="sortable-card-memory"]').evaluate((element) => getComputedStyle(element).transform))
      .not.toBe('none');
    await page.keyboard.press('Enter'); // drop

    // React applies the reorder asynchronously after the drop keyup.
    await expect
      .poll(async () => (await readDashboardCardOrder(page))[0], { timeout: 3_000 })
      .not.toBe('cpu');

    const after = await readDashboardCardOrder(page);
    // Only the order changed — same cards, same count.
    expect([...after].sort()).toEqual([...before].sort());
  });

  test('reorders cards by pointer drag', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    const before = await readDashboardCardOrder(page);
    const source = page.locator('[data-testid="metric-card-cpu"] .drag-handle');
    const target = page.locator('[data-testid="metric-card-memory"]');
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 });
    await page.mouse.up();

    await expect
      .poll(async () => (await readDashboardCardOrder(page))[0], { timeout: 3_000 })
      .not.toBe('cpu');

    const after = await readDashboardCardOrder(page);
    expect([...after].sort()).toEqual([...before].sort());
  });
});
