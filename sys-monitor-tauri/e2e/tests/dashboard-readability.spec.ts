import { test, expect } from '@playwright/test';
import { waitForFirstMetrics } from './helpers';

test.describe('dashboard readability', () => {
  test('names the hardware control and keeps reorder handles visible', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1100 });
    await page.goto('/');
    await waitForFirstMetrics(page);

    const toggle = page.getByRole('button', { name: 'Show hardware info' });
    await expect(toggle).toContainText('Hardware');
    const box = await toggle.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(32);

    const handle = page.locator('[data-testid="drag-handle-cpu"]');
    const opacity = await handle.evaluate((el) => getComputedStyle(el).opacity);
    expect(opacity).toBe('1');
  });

  test('shows a window range on percent cards and a peak scale on network', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);
    await expect(page.getByTestId('metric-range-cpu')).toContainText('Min:');
    await expect(page.getByTestId('metric-range-cpu')).toContainText('Max:');
    await expect(page.getByTestId('metric-range-network')).toContainText('Peak down');
    await expect(page.getByTestId('metric-range-network')).toContainText('peak up');
  });

  test('metrics dialog traps tab and the empty state opens it', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);
    await page.getByRole('button', { name: /Metrics/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Metric card visibility' });
    await expect(dialog).toContainText('Show or hide cards');
    const boxes = page.getByRole('checkbox');
    const count = await boxes.count();
    await boxes.nth(count - 1).focus();
    await page.keyboard.press('Tab');
    await expect(boxes.first()).toBeFocused();

    for (let i = 0; i < count; i++) await boxes.nth(i).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('empty-metrics-action').click();
    await expect(dialog).toBeVisible();
  });
});
