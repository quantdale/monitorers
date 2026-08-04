import { test, expect } from '@playwright/test';
import { waitForFirstMetrics } from './helpers';

// The collector-error banner must only appear when the Rust collector thread
// panics and halts. The mock-data browser harness cannot trigger a real panic,
// so this spec asserts the banner stays absent during healthy operation. The
// banner's rendering path itself is covered by unit tests
// (useMetrics.hook.test.ts — collectorError lifetime, ~lines 199-224) and the
// error event flow by the Rust collector tests; the runtime path is exercised
// in the packaged app.
test.describe('collector error banner', () => {
  test('is not shown while the pipeline is healthy', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    await page.waitForTimeout(3_000);
    await expect(page.locator('[data-testid="collector-error-banner"]')).toHaveCount(0);
  });
});
