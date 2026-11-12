import { test, expect } from '@playwright/test';
import { readDashboardCardOrder, waitForFirstMetrics } from './helpers';

// Exercise the keyboard sensor's scroll-only path: with a target below the
// viewport midpoint, smooth scrolling can leave `over` on the source when the
// next key drops the card. Waiting for a non-'none' transform would not catch
// it: translate3d(0,0,0) is an identity transform but still passes that check.
test('keyboard drop reaches the adjacent card when movement requires scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 500 });
  await page.goto('/');
  await waitForFirstMetrics(page);
  const before = await readDashboardCardOrder(page);
  expect(before[0]).toBe('cpu');

  await page.getByTestId('drag-handle-cpu').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('dashboard-card-list')).toHaveAttribute('data-dragging', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => readDashboardCardOrder(page)).toEqual([
    before[1], before[0], ...before.slice(2),
  ]);

  await page.getByTestId('drag-handle-cpu').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('dashboard-card-list')).toHaveAttribute('data-dragging', 'true');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect.poll(() => readDashboardCardOrder(page)).toEqual(before);

  // Back-to-back movement and cancellation must not leave a sensor listener
  // behind or commit a partial order.
  await page.getByTestId('drag-handle-cpu').focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dashboard-card-list')).toHaveAttribute('data-dragging', 'false');
  expect(await readDashboardCardOrder(page)).toEqual(before);
});

test('metric selector stays viewport-relative under a transformed glass toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 300 });
  await page.goto('/');
  await waitForFirstMetrics(page);
  await page.getByRole('banner').evaluate((header) => {
    // A transform and backdrop both establish containing blocks for fixed
    // descendants. The panel must work independently of either treatment.
    header.style.transform = 'translateY(12px)';
    header.style.backdropFilter = 'blur(16px)';
  });
  const trigger = page.getByRole('button', { name: /Metrics/ });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Metric card visibility' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.y).toBeGreaterThanOrEqual(8);
  expect(box!.x + box!.width).toBeLessThanOrEqual(392);
  expect(box!.y + box!.height).toBeLessThanOrEqual(292);
  await page.getByRole('checkbox').last().focus();
  await expect(page.getByRole('checkbox').last()).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
