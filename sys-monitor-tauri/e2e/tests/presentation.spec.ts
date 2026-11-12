import { test, expect } from '@playwright/test';
import { waitForFirstMetrics } from './helpers';

test('view thumb aligns with each equal-width segment without style conflicts', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForFirstMetrics(page);
  const group = page.getByRole('group', { name: 'Dashboard view mode' });
  for (const mode of ['Default', 'Tile', 'List']) {
    const button = group.getByRole('button', { name: mode, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => {
      const thumb = await page.getByTestId('view-mode-thumb').boundingBox();
      const segment = await button.boundingBox();
      return thumb && segment ? Math.max(Math.abs(thumb.x - segment.x), Math.abs(thumb.width - segment.width)) : 999;
    }).toBeLessThan(1);
  }
  expect(errors).toEqual([]);
});

test('reduced motion disables decorative animation while keeping controls operable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForFirstMetrics(page);
  await expect.poll(() => page.getByTestId('sortable-card-cpu').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await expect.poll(() => page.locator('.live-pulse').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.getByRole('button', { name: 'Tile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tile', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Metrics/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Metric card visibility' });
  await expect(dialog).toBeVisible();
  const motion = await dialog.evaluate((el) => ({ transform: getComputedStyle(el).transform, animations: el.getAnimations().filter((animation) => animation.playState === 'running').length }));
  expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(motion.transform);
  expect(motion.animations).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Metrics/ })).toBeFocused();
});

test('the glass toolbar stays reachable when the dashboard scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 300 });
  await page.goto('/');
  await waitForFirstMetrics(page);
  await page.getByTestId('dashboard-scroll-area').evaluate((el) => { el.scrollTop = 500; });
  await expect.poll(async () => (await page.getByRole('banner').boundingBox())!.y).toBe(0);
  await page.getByRole('button', { name: /Metrics/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Metric card visibility' });
  const box = await dialog.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(8);
  expect(box!.y + box!.height).toBeLessThanOrEqual(292);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Metrics/ })).toBeFocused();
});
