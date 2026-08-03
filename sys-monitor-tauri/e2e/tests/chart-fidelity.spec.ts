import { test, expect } from '@playwright/test';
import { waitForFirstMetrics, chartPointCount, assertChartGrowth } from './helpers';

// The history pipeline must (a) respect the selected time window and (b) keep
// appending one point per second at the 1 Hz commit cadence, so a fixed
// window shows a chart that grows at ~1 point/sec without resampling.
test.describe('chart fidelity', () => {
  test('respects the 30s window', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    // Baseline with the default 60 s window (relative comparison avoids
    // depending on the letters-per-point layout factor).
    const c60 = await chartPointCount(page, 'cpu');
    expect(c60).toBeGreaterThan(10);

    await page.getByRole('combobox').selectOption('30');
    await page.waitForTimeout(300); // let the sliced window re-render

    const c30 = await chartPointCount(page, 'cpu');
    // 30 s should be roughly half of 60 s — strictly smaller, still a chart.
    expect(c30).toBeLessThan(c60);
    expect(c30).toBeGreaterThan(c60 * 0.35);
    expect(c30).toBeLessThan(c60 * 0.65);
  });

  test('chart grows at roughly one point per second', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    // A 600 s window is wider than the 300-point mock seed, so every 1 Hz
    // history commit is visible as chart growth (with the default 60 s
    // window the chart is a sliding window that never visibly grows).
    await page.getByRole('combobox').selectOption('600');
    await page.waitForTimeout(300); // let the re-seeded history render

    // The mock seed sits exactly at the chart's 300-point rendering cap, so
    // the first live commit crosses it and stride-sampling resamples the
    // chart down to ~151 points. Wait for that boundary to settle before
    // measuring, or the "grows" assertion sees a resample, not growth.
    // chartPointCount counts path commands (~2 per point): the passthrough
    // regime reads ~610, the stride regime ~310.
    await expect.poll(async () => chartPointCount(page, 'cpu'), { timeout: 10_000 }).toBeLessThan(400);

    await assertChartGrowth(page, 'cpu', 5);
  });
});
