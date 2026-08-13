import { test, expect } from '@playwright/test';
import { waitForFirstMetrics } from './helpers';

test.describe('accessible controls', () => {
  test('names the history range and exposes toolbar relationships', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    await expect(page.getByRole('combobox', { name: 'History time range' })).toBeVisible();
    const sidebarToggle = page.getByRole('button', { name: 'Show hardware info' });
    await expect(sidebarToggle).toHaveAttribute('aria-controls', 'hardware-sidebar');
    await expect(sidebarToggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('returns focus to the metric selector trigger on Escape', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    const trigger = page.getByRole('button', { name: /Metrics/ });
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Metric card visibility' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });

  test('makes the dashboard drag handle keyboard-focusable with a visible focus ring', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    const handle = page.getByRole('button', { name: 'Drag to reorder' }).first();
    await handle.focus();
    await expect(handle).toBeFocused();
    await expect(handle).toHaveAttribute('aria-label', 'Drag to reorder');
    const outlineStyle = await handle.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outlineStyle).toBe('solid');
  });
});
