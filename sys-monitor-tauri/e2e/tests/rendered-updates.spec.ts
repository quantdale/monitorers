import { test, expect } from '@playwright/test';
import {
  waitForFirstMetrics,
  readCardIds,
  assertUpdatesAtLeast,
  firstGpuCardId,
} from './helpers';

// Covers the core promise of the dashboard: hardware cards render, and their
// live values keep updating as mock metric events arrive (1 Hz ticks, so any
// update within a 3 s window means the pipeline is flowing end-to-end).
test.describe('rendered metric cards', () => {
  test('render the expected hardware cards', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    await expect(page.locator('[data-testid="metric-card-cpu"]')).toBeVisible();
    await expect(page.locator('[data-testid="metric-card-memory"]')).toBeVisible();
    await expect(page.locator('[data-testid="metric-card-network"]')).toBeVisible();

    // Disks and GPUs are resolved from the payload at runtime; at least one of
    // each must exist (mock payload ships a disk and two GPUs).
    expect(
      (await readCardIds(page)).filter((id) => id.startsWith('disk_')).length
    ).toBeGreaterThanOrEqual(1);
    const gpuId = await firstGpuCardId(page);
    await expect(page.locator(`[data-testid="metric-card-${gpuId}"]`)).toBeVisible();
  });

  test('CPU card value keeps updating', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);
    await assertUpdatesAtLeast(page, 'cpu', 2, 3_000);
  });

  test('GPU card value keeps updating', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);
    const gpuId = await firstGpuCardId(page);
    await assertUpdatesAtLeast(page, gpuId, 2, 3_000);
  });
});
