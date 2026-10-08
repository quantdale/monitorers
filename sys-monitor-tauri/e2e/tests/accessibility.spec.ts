import { test, expect } from '@playwright/test';
import { waitForFirstMetrics } from './helpers';

const CARD = '[data-testid^="metric-card-"]';

// Regression guards for the layout/semantics campaign: a Tile grid whose bare
// `1fr 1fr` tracks were widened by one card's min-content width (measured
// 406px/180px inside a 358px container at the product's 400px minimum window),
// List rows that clipped wrapped metadata behind a fixed 50px height, a page
// with no landmarks/heading, and charts exposed as unnamed focusable
// `role="application"` widgets.
test.describe('dashboard layout containment', () => {
  test('tile view keeps equal tracks at the normal window width', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1100 });
    await page.goto('/');
    await waitForFirstMetrics(page);
    await page.getByRole('button', { name: 'Tile' }).click();
    await expect(page.locator('[data-testid="dashboard-card-list"]')).toHaveCSS('display', 'grid');

    const { tracks, cardWidths, containerWidth } = await page
      .getByTestId('dashboard-card-list')
      .evaluate((list) => ({
        tracks: getComputedStyle(list).gridTemplateColumns.split(' ').map((v) => Number.parseFloat(v)),
        cardWidths: Array.from(list.children).map((c) => Math.round(c.getBoundingClientRect().width)),
        containerWidth: Math.round(list.getBoundingClientRect().width),
      }));

    expect(tracks).toHaveLength(2);
    expect(Math.abs(tracks[0] - tracks[1])).toBeLessThanOrEqual(1);
    const maxCard = Math.max(...cardWidths);
    expect(maxCard).toBeLessThanOrEqual(containerWidth + 1);
  });

  test('tile view collapses to one column and never overflows at the minimum window', async ({ page }) => {
    // The product's window minimum is 400x300 (tauri.conf.json).
    await page.setViewportSize({ width: 400, height: 300 });
    await page.goto('/');
    await waitForFirstMetrics(page);
    await page.getByRole('button', { name: 'Tile' }).click();

      const measurement = await page.getByTestId('dashboard-card-list').evaluate((list) => {
        const tracks = getComputedStyle(list).gridTemplateColumns.split(' ').map((v) => Number.parseFloat(v));
        const containerWidth = Math.round(list.getBoundingClientRect().width);
        return { tracks, containerWidth };
      });

    expect(measurement.tracks).toHaveLength(1);
    for (const track of measurement.tracks) expect(track).toBeLessThanOrEqual(measurement.containerWidth + 1);
    // Recharts' ResponsiveContainer re-measures asynchronously after the grid
    // change, so poll until the layout has settled rather than reading one
    // possibly-transient frame.
    await expect
      .poll(
        () =>
          page
            .locator(CARD)
            .evaluateAll((cards) => cards.filter((card) => card.scrollWidth > card.clientWidth + 1).length),
        { timeout: 5_000 }
      )
      .toBe(0);
    // The document itself must not scroll sideways.
    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(docOverflow).toBeLessThanOrEqual(1);
  });

  test('list rows never clip their metadata at narrow or normal widths', async ({ page }) => {
    for (const viewport of [
      { width: 400, height: 300 },
      { width: 900, height: 1100 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await waitForFirstMetrics(page);
      await page.getByRole('button', { name: 'List' }).click();

      const clipped = await page.locator(CARD).evaluateAll((cards) =>
        cards
          .filter((card) => card.scrollHeight > card.clientHeight + 1)
          .map((card) => card.getAttribute('data-testid'))
      );
      expect(clipped, `clipped list rows at ${viewport.width}px`).toEqual([]);
    }
  });
});

test.describe('dashboard semantics', () => {
  test('exposes a heading, header and main landmark around the dashboard', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    await expect(page.getByRole('heading', { level: 1, name: 'System Monitor' })).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('main').getByTestId('dashboard-card-list')).toBeVisible();

    // Exactly one top-level heading: no competing <h1> per card.
    expect(await page.locator('h1').count()).toBe(1);
  });

  test('every chart is a named, non-focusable image', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);
    // The chart body is a lazily-loaded chunk: wait for the first surface to
    // mount before asserting on all of them.
    await expect(page.locator('svg.recharts-surface').first()).toBeAttached();

    const charts = await page.locator('svg.recharts-surface').evaluateAll((nodes) =>
      nodes.map((node) => ({
        role: node.getAttribute('role'),
        tabindex: node.getAttribute('tabindex'),
        label: node.getAttribute('aria-label'),
      }))
    );

    expect(charts.length).toBeGreaterThan(0);
    for (const chart of charts) {
      expect(chart.role).toBe('img');
      expect(chart.tabindex).toBe('-1');
      expect(chart.label).not.toBeNull();
      expect((chart.label ?? '').length).toBeGreaterThan(0);
    }

    // No chart may be a keyboard stop: tab order must contain only controls.
    const focusableCharts = await page
      .locator('svg.recharts-surface[tabindex="0"]')
      .count();
    expect(focusableCharts).toBe(0);
  });

  test('renders no negative percentage anywhere on the dashboard', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);
    await page.getByRole('button', { name: 'List' }).click();

    const texts = await page.locator(CARD).allInnerTexts();
    const joined = texts.join('\n');
    // Min/max ranges and live values are the only rendered percentages besides
    // timestamps; a negative one means the clamping contract regressed.
    expect(joined).not.toMatch(/-\d+(\.\d+)?%/);
  });
});

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

  test('names each drag handle after its card and keeps a visible focus ring', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    // A shared "Drag to reorder" name made all seven handles indistinguishable
    // to assistive technology; the handle must now identify its card.
    const handle = page.locator('[data-testid="drag-handle-cpu"]');
    await handle.focus();
    await expect(handle).toBeFocused();
    await expect(handle).toHaveAttribute('aria-label', /^Reorder .+ card$/);
    const outlineStyle = await handle.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outlineStyle).toBe('solid');
  });
});
