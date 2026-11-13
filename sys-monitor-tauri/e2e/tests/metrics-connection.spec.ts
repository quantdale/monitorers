import { test, expect, type Page } from '@playwright/test';
import { readDashboardCardOrder, waitForFirstMetrics } from './helpers';

const errorPanel = (page: Page) => page.getByTestId('metrics-connection-error');
const retryButton = (page: Page) => page.getByRole('button', { name: 'Retry metrics connection', exact: true });

async function failRefresh(page: Page) {
  await page.evaluate(() => window.__SIM__!.backend.setHistoryFault({ mode: 'fail' }));
  await page.getByRole('combobox', { name: 'History time range' }).selectOption('300');
  await expect(errorPanel(page)).toContainText('simulated history load failure');
  await expect(retryButton(page)).toBeEnabled();
}

for (const viewport of [{ width: 400, height: 300 }, { width: 768, height: 900 }, { width: 900, height: 1100 }, { width: 1440, height: 900 }]) {
  test(`history connection recovers in place at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await waitForFirstMetrics(page);
    await page.getByRole('button', { name: 'Tile', exact: true }).click();
    // Playwright's scroll-into-view step can move an already-visible sticky
    // toolbar. Capture the intended top-of-dashboard state deliberately.
    await page.getByTestId('dashboard-scroll-area').evaluate((el) => { el.scrollTop = 0; });
    const order = await readDashboardCardOrder(page);
    await failRefresh(page);
    await expect(page.getByTestId('metric-card-cpu')).toBeVisible();
    await expect(errorPanel(page)).toHaveCSS('opacity', '1');
    const panelBox = await errorPanel(page).boundingBox();
    const toolbarBox = await page.getByRole('banner').boundingBox();
    expect(panelBox!.y).toBeGreaterThanOrEqual(toolbarBox!.y + toolbarBox!.height);
    await page.screenshot({ path: testInfo.outputPath('connection-error.png') });
    await expect.poll(() => page.getByTestId('dashboard-scroll-area').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);

    // Failure remains retryable; changing an unrelated control cannot clear it.
    await retryButton(page).click();
    await expect(retryButton(page)).toBeEnabled();
    await expect(errorPanel(page)).toContainText('simulated history load failure');
    await page.evaluate(() => window.__SIM__!.backend.setHistoryFault({ mode: 'slow', delayMs: 600 }));
    await retryButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(retryButton(page)).toBeDisabled();
    await expect(retryButton(page)).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'Retrying metrics connection…' })).toBeVisible();
    await expect(errorPanel(page)).toContainText('simulated history load failure');
    await expect(errorPanel(page)).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'History time range' })).toBeFocused();
    await expect(page.getByRole('combobox', { name: 'History time range' })).toHaveValue('300');
    await expect(page.getByRole('button', { name: 'Tile', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await readDashboardCardOrder(page)).toEqual(order);
    await page.screenshot({ path: testInfo.outputPath('connection-recovered.png') });
  });
}

test('initial history failure offers recovery without restarting the page', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-13T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-13T00:00:01Z'));
  await page.addInitScript(() => {
    localStorage.setItem('sysmon_sim_session_initial-retry', JSON.stringify({ version: 1, history_fault: { mode: 'fail' }, speed: 0.25 }));
  });
  await page.goto('/?__sim_run=initial-retry');
  await page.clock.runFor(300);
  await expect(errorPanel(page)).toContainText("Couldn't load metrics");
  await expect(page.getByTestId('metric-card-cpu')).toHaveCount(0);
  await page.evaluate(() => window.__SIM__!.backend.setHistoryFault(null));
  await retryButton(page).click();
  await page.clock.runFor(300);
  await expect(errorPanel(page)).toHaveCount(0);
  await waitForFirstMetrics(page);
  await expect(page).toHaveURL(/__sim_run=initial-retry$/);
});

test('successful retry respects moved focus and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForFirstMetrics(page);
  await failRefresh(page);
  await page.evaluate(() => window.__SIM__!.backend.setHistoryFault({ mode: 'slow', delayMs: 1_000 }));
  await retryButton(page).click();
  await expect(retryButton(page)).toBeDisabled();
  expect(await retryButton(page).locator('svg').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  const view = page.getByRole('button', { name: 'List', exact: true });
  await view.focus();
  await expect(errorPanel(page)).toHaveCount(0);
  await expect(view).toBeFocused();
});

test('long connection diagnostics wrap inside the minimum window', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 400, height: 300 });
  await page.goto('/');
  await waitForFirstMetrics(page);
  await page.evaluate(() => {
    window.__SIM__!.backend.getHistory = () => Promise.reject(new Error('ConnectionDiagnostic'.repeat(25)));
  });
  await page.getByRole('combobox').selectOption('300');
  await expect(errorPanel(page)).toContainText('ConnectionDiagnostic');
  await expect(retryButton(page)).toBeEnabled();
  await retryButton(page).scrollIntoViewIfNeeded();
  await expect(retryButton(page)).toBeInViewport();
  expect(await page.getByTestId('dashboard-scroll-area').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('long-connection-error.png') });
});

test('an unanswered history request times out and can be retried', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForFirstMetrics(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
  await page.evaluate(() => {
    const backend = window.__SIM__!.backend;
    const readHistory = backend.getHistory.bind(backend);
    let unanswered = true;
    backend.getHistory = (windowSecs) => {
      if (unanswered) {
        unanswered = false;
        return new Promise(() => {});
      }
      return readHistory(windowSecs);
    };
  });
  await page.getByRole('combobox').selectOption('300');
  await page.clock.fastForward(10_000);
  await expect(errorPanel(page)).toContainText('history request timed out');
  await expect(retryButton(page)).toBeEnabled();
  await retryButton(page).click();
  await expect(errorPanel(page)).toHaveCount(0);
  await expect(page.getByTestId('metric-card-cpu')).toBeVisible();
});
