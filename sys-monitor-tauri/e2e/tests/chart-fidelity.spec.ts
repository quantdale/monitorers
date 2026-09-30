import { test, expect } from '@playwright/test';
import {
  waitForFirstMetrics,
  chartTimeSpanMs,
  chartLatestTimestamp,
  chartStartTimestamp,
  chartPointCount,
} from './helpers';

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

  // The window must slice ONE accumulated session, not re-seed an unrelated
  // series: widening it reveals strictly earlier committed samples, and the
  // newest sample is shared by every window width.
  //
  // The mock's emission is STOPPED first so the history ring is static for the
  // whole comparison. Without that, a 1 Hz commit landing between the two
  // reads would legitimately change the newest sample and fail an equality
  // assertion that is really about window slicing, not about live growth.
  // Stopping is the honest way to isolate the variable under test: a re-seed
  // regression still fails this (it stamps a fresh `Date.now()` per request,
  // so the newest sample would move even with a static ring).
  test('widening the window reveals earlier committed samples of the same session', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);
    // Let the ring accumulate so there is real history to widen into.
    await page.waitForTimeout(3_000);
    // Freeze the ring: no further commits while the two windows are compared.
    await page.evaluate(() => window.__SIM__?.backend.stop());

    await page.getByRole('combobox').selectOption('30');
    await expect.poll(() => chartPointCount(page, 'cpu')).toBeGreaterThan(0);
    const narrowSpan = await chartTimeSpanMs(page, 'cpu');
    const narrowStart = await chartStartTimestamp(page, 'cpu');
    const narrowLatest = await chartLatestTimestamp(page, 'cpu');

    await page.getByRole('combobox').selectOption('60');
    await expect
      .poll(() => chartTimeSpanMs(page, 'cpu'), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(narrowSpan);

    const wideSpan = await chartTimeSpanMs(page, 'cpu');
    const wideStart = await chartStartTimestamp(page, 'cpu');
    const wideLatest = await chartLatestTimestamp(page, 'cpu');

    // Wider window => strictly more elapsed time covered...
    expect(wideSpan).toBeGreaterThanOrEqual(narrowSpan);
    // ...reaching strictly further back into the same session...
    expect(wideStart).toBeLessThan(narrowStart);
    // ...while the newest committed sample is identical across both widths
    // (exactly equal now that the ring is frozen).
    expect(wideLatest).toBe(narrowLatest);
  });

  test('narrowing the window shrinks the span but keeps the newest sample', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);
    await page.waitForTimeout(3_000);
    // Freeze the ring for the same reason as the widening test: the newest
    // sample must be comparable across the two window widths.
    await page.evaluate(() => window.__SIM__?.backend.stop());

    await page.getByRole('combobox').selectOption('60');
    await expect.poll(() => chartPointCount(page, 'cpu')).toBeGreaterThan(0);
    const wideSpan = await chartTimeSpanMs(page, 'cpu');
    const wideLatest = await chartLatestTimestamp(page, 'cpu');

    await page.getByRole('combobox').selectOption('30');
    await expect.poll(() => chartTimeSpanMs(page, 'cpu')).toBeLessThanOrEqual(wideSpan);

    const narrowSpan = await chartTimeSpanMs(page, 'cpu');
    const narrowLatest = await chartLatestTimestamp(page, 'cpu');
    expect(narrowSpan).toBeLessThanOrEqual(wideSpan);
    // Narrowing keeps the newest sample — the chart always shows "now".
    expect(narrowLatest).toBe(wideLatest);
  });

  test('chart grows at roughly one point per second', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    const before = await chartLatestTimestamp(page, 'cpu');
    await expect.poll(() => chartLatestTimestamp(page, 'cpu'), { timeout: 10_000 })
      .toBeGreaterThan(before + 3_000);
  });
});
