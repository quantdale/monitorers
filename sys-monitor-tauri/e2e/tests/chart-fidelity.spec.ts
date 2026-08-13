import { test, expect } from '@playwright/test';
import { waitForFirstMetrics, chartTimeSpanMs, chartLatestTimestamp } from './helpers';

// The history pipeline must (a) respect the selected time window and (b) keep
// appending one point per second at the 1 Hz commit cadence, so a fixed
// window shows a chart that grows at ~1 point/sec without resampling.
test.describe('chart fidelity', () => {
  test('respects the 30s window', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    const span60 = await chartTimeSpanMs(page, 'cpu');
    expect(span60).toBeGreaterThan(50_000);

    await page.getByRole('combobox').selectOption('30');
    await expect.poll(() => chartTimeSpanMs(page, 'cpu')).toBeLessThan(span60);

    const span30 = await chartTimeSpanMs(page, 'cpu');
    expect(span30).toBeGreaterThan(25_000);
    expect(span30).toBeLessThan(35_000);
  });

  test('chart grows at roughly one point per second', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    const before = await chartLatestTimestamp(page, 'cpu');
    await expect.poll(() => chartLatestTimestamp(page, 'cpu'), { timeout: 10_000 })
      .toBeGreaterThan(before + 3_000);
  });
});
