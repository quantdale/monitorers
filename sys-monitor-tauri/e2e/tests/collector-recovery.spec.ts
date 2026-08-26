import { test, expect } from '@playwright/test';
import { waitForFirstMetrics } from './helpers';

// Supervised-recovery runtime paths, driven through the browser-mode bridge
// (window.__SIM__ exists in the Vite mock harness; it never runs in Tauri).
// Unit tests pin hook semantics; these assert the rendered banner contract:
// transient recovering announcement with retained values, automatic clearing,
// and the failed state's accessible Retry control.
test.describe('collector recovery banners', () => {
  test('recovering banner appears on session crash and clears automatically', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    const cpuValue = async () => {
      const text = await page.locator('[data-testid="metric-card-cpu"]').innerText();
      return (text.match(/\d+(?:\.\d+)?%/) ?? [''])[0];
    };

    await page.evaluate(() =>
      window.__SIM__?.backend.injectFault({ kind: 'collector-crash', recoverAfterMs: 1_500 })
    );
    const recovering = page.locator('[data-testid="collector-recovering-banner"]');
    await expect(recovering).toBeVisible({ timeout: 5_000 });
    await expect(recovering).toHaveText(/Recovering/);
    await expect(recovering).toHaveAttribute('role', 'status');

    // Last-known values stay visible during recovery (no zeros/blanks).
    const held = await cpuValue();
    expect(held).not.toBe('');

    await expect(recovering).toHaveCount(0, { timeout: 10_000 });
    // Values resume after restoration.
    await expect
      .poll(cpuValue, { timeout: 15_000 })
      .not.toBe(held);
    await expect(page.locator('[data-testid="collector-error-banner"]')).toHaveCount(0);
  });

  test('failed state shows an alert with a working Retry metrics control', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    const cpuValue = async () => {
      const text = await page.locator('[data-testid="metric-card-cpu"]').innerText();
      return (text.match(/\d+(?:\.\d+)?%/) ?? [''])[0];
    };

    await page.evaluate(() =>
      window.__SIM__?.backend.injectFault({ kind: 'collector-crash-permanent' })
    );
    const failed = page.locator('[data-testid="collector-error-banner"]');
    await expect(failed).toBeVisible({ timeout: 8_000 });
    await expect(failed).toHaveAttribute('role', 'alert');
    await expect(failed).toContainText(/recovery attempts/i);

    // Last-known values stay visible while failed.
    const held = await cpuValue();
    expect(held).not.toBe('');

    const retry = page.getByRole('button', { name: /retry metrics/i });
    await expect(retry).toBeVisible();
    await retry.click();

    await expect(failed).toHaveCount(0, { timeout: 10_000 });
    await expect.poll(cpuValue, { timeout: 15_000 }).not.toBe(held);
    await expect(page.locator('[data-testid="collector-error-banner"]')).toHaveCount(0);
  });
});
