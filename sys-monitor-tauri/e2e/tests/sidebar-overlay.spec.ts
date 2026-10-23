import { test, expect } from '@playwright/test';
import { waitForFirstMetrics } from './helpers';

const CARD = '[data-testid^="metric-card-"]';

async function listWidth(page: import('@playwright/test').Page): Promise<number> {
  return page.getByTestId('dashboard-card-list').evaluate((el) => Math.round(el.getBoundingClientRect().width));
}

async function overflowingCards(page: import('@playwright/test').Page): Promise<number> {
  return page.locator(CARD).evaluateAll((cards) => cards.filter((card) => card.scrollWidth > card.clientWidth + 1).length);
}

test.describe('hardware sidebar presentation', () => {
  test('narrow window overlays the rail instead of crushing cards', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 300 });
    await page.goto('/');
    await waitForFirstMetrics(page);

    const closedWidth = await listWidth(page);
    await page.getByRole('button', { name: 'Show hardware info' }).click();

    await expect(page.locator('#hardware-sidebar')).toHaveAttribute('data-sidebar-presentation', 'overlay');
    await expect(page.getByRole('dialog', { name: 'Hardware info' })).toBeVisible();
    const openWidth = await listWidth(page);
    expect(Math.abs(openWidth - closedWidth)).toBeLessThanOrEqual(1);
    expect(await overflowingCards(page)).toBe(0);

    const box = await page.locator('#hardware-sidebar').evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        width: Math.round(el.getBoundingClientRect().width),
        position: style.position,
      };
    });
    expect(box.width).toBe(220);
    expect(box.position).toBe('fixed');

    // The scrim covers the viewport; its center sits under the 220px rail.
    await page.getByTestId('hardware-sidebar-scrim').click({ position: { x: 360, y: 40 } });
    await expect(page.locator('#hardware-sidebar')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show hardware info' })).toBeFocused();
  });

  test('escape closes the overlay and restores focus to the toggle', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 300 });
    await page.goto('/');
    await waitForFirstMetrics(page);
    await page.getByRole('button', { name: 'Show hardware info' }).click();
    await expect(page.getByRole('button', { name: 'Close hardware info' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#hardware-sidebar')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show hardware info' })).toBeFocused();
  });

  test('wide window still pushes the dashboard aside', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1100 });
    await page.goto('/');
    await waitForFirstMetrics(page);

    const closedWidth = await listWidth(page);
    await page.getByRole('button', { name: 'Show hardware info' }).click();
    await expect(page.locator('#hardware-sidebar')).toHaveAttribute('data-sidebar-presentation', 'push');
    await expect(page.getByRole('dialog', { name: 'Hardware info' })).toHaveCount(0);
    // The push rail animates its width; measure after the transition settles.
    await expect.poll(async () => closedWidth - (await listWidth(page)), { timeout: 2_000 }).toBeGreaterThanOrEqual(200);
    expect(await overflowingCards(page)).toBe(0);
    await expect(page.getByTestId('hardware-sidebar-scrim')).toHaveCount(0);
  });
});
