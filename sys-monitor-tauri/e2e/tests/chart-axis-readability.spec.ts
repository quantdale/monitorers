import { test, expect, type Page } from '@playwright/test';
import { waitForFirstMetrics, chartTimeSpanMs } from './helpers';

// The visible time axis is part of the glance path the chart serves. It must be
// a readable scale: tick text in an explicit application color (the chart
// library default gray measured ~2.90:1 on the #1e1e1e card surface — below
// the 4.5:1 text floor), an axis stroke clear of the 3:1 graphical-object
// floor on the rendered card, labels that lie fully inside the chart box, and
// adjacent labels that never overlap at the product's minimum (400×300) and
// normal (900×1100) windows, in Default and Tile view.
//
// The Vite mock seeds a 300-point, one-second-per-point ring, so the widest
// labels this lane can paint are `HH:MM:SS`. The seeded-span case selects the
// 300-second window so the visible span is the whole seed (~299s, still under
// the five-minute cut); the long-span `HH:MM` rule is proven on the pure
// helper in src/cards/chartLabels.test.ts — this lane never selects 30m/1h and
// never pretends that paints an hour-long span.

/** #888 as the browser resolves it in a computed style. */
const TICK_FILL_RGB = 'rgb(136, 136, 136)';

/** The spec's sub-pixel rounding allowance on any chart-box edge. */
const BOX_TOLERANCE_PX = 1;

/** The Default/Tile card surface (MetricCard's #1e1e1e) as the browser resolves it. */
const CARD_SURFACE_RGB = 'rgb(30, 30, 30)';

/** #7a7a7a — the axis stroke — as the browser resolves it in a computed style. */
const AXIS_STROKE_RGB = 'rgb(122, 122, 122)';

/** The mock's seeded ring spans this many milliseconds (300 points, 1s apart). */
const SEEDED_SPAN_MS = 299_000;

interface TickRect {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  visible: boolean;
  fill: string;
}

interface ChartMeasurement {
  id: string;
  surface: { left: number; right: number; top: number; bottom: number } | null;
  cardBackground: string | null;
  axisStroke: string | null;
  ticks: TickRect[];
}

/** Reads every chart's surface box and every tick label rect in one layout
 *  frame, so a 1 Hz commit landing mid-test cannot produce a mixed reading.
 *  Also captures the rendered card background and axis-line stroke, so the
 *  contrast floors are evaluated against the colors actually painted. */
async function measureCharts(page: Page): Promise<ChartMeasurement[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="metric-card-"]')).map((card) => {
      const svg = card.querySelector('svg.recharts-surface');
      const svgBox = svg?.getBoundingClientRect();
      const axisLine = card.querySelector('.recharts-cartesian-axis-line');
      return {
        id: card.getAttribute('data-testid') ?? '',
        surface: svgBox
          ? { left: svgBox.left, right: svgBox.right, top: svgBox.top, bottom: svgBox.bottom }
          : null,
        cardBackground: getComputedStyle(card).backgroundColor,
        axisStroke: axisLine ? getComputedStyle(axisLine).stroke : null,
        ticks: Array.from(card.querySelectorAll('.recharts-cartesian-axis-tick-value')).map((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            text: node.textContent ?? '',
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            visible: style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
            fill: style.fill,
          };
        }),
      };
    })
  );
}

/** Freezes the ring so labels stop advancing while geometry is measured. */
async function freezeRing(page: Page): Promise<void> {
  await page.evaluate(() => window.__SIM__?.backend.stop());
}

async function readChartsForView(
  page: Page,
  view: 'Default' | 'Tile',
  windowSecs: '60' | '30' | '300'
): Promise<ChartMeasurement[]> {
  await page.goto('/');
  await waitForFirstMetrics(page);
  await expect(page.locator('svg.recharts-surface').first()).toBeAttached();
  await page.getByRole('combobox').selectOption(windowSecs);
  await freezeRing(page);
  await page.getByRole('button', { name: view }).click();
  // The chart body is a lazy chunk and ResponsiveContainer re-measures after
  // the view change: poll until tick text exists before measuring, rather
  // than reading one possibly-transient frame.
  await expect
    .poll(
      () => page.locator('.recharts-cartesian-axis-tick-value').count(),
      { timeout: 10_000 }
    )
    .toBeGreaterThan(0);
  return measureCharts(page);
}

// Every visible label: inside its chart box (within the spec's sub-pixel
// tolerance), not overlapping its neighbours, in the explicit application
// color, on the rendered Default/Tile card surface with the explicit stroke.
function assertAxisReadable(charts: ChartMeasurement[], context: string): void {
  expect(charts.length, 'the dashboard renders metric cards').toBeGreaterThan(0);
  let labelledCharts = 0;
  for (const chart of charts) {
    expect(chart.surface, `${chart.id} (${context}) renders a chart surface`).not.toBeNull();
    const box = chart.surface!;
    const labels = chart.ticks.filter((tick) => tick.visible && tick.text.length > 0);

    expect(labels.length, `${chart.id} (${context}) paints time-axis labels`).toBeGreaterThan(1);
    labelledCharts += 1;

    // Rendered surface and stroke — the contrast floors are evaluated against
    // the colors actually painted, not the constants in the source. The ratio
    // itself (3.884:1) is computed in src/cards/chartLabels.test.ts.
    expect(chart.cardBackground, `${chart.id} (${context}) card surface`).toBe(CARD_SURFACE_RGB);
    expect(chart.axisStroke, `${chart.id} (${context}) axis stroke`).toBe(AXIS_STROKE_RGB);

    for (const label of labels) {
      expect(
        label.left,
        `${chart.id} (${context}) label "${label.text}" clipped on the left`
      ).toBeGreaterThanOrEqual(box.left - BOX_TOLERANCE_PX);
      expect(
        label.right,
        `${chart.id} (${context}) label "${label.text}" clipped on the right`
      ).toBeLessThanOrEqual(box.right + BOX_TOLERANCE_PX);
      expect(
        label.top,
        `${chart.id} (${context}) label "${label.text}" clipped on the top`
      ).toBeGreaterThanOrEqual(box.top - BOX_TOLERANCE_PX);
      expect(
        label.bottom,
        `${chart.id} (${context}) label "${label.text}" clipped on the bottom`
      ).toBeLessThanOrEqual(box.bottom + BOX_TOLERANCE_PX);
      expect(label.fill, `${chart.id} (${context}) tick fill is the explicit #888`).toBe(TICK_FILL_RGB);
    }

    const sorted = [...labels].sort((a, b) => a.left - b.left);
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      expect(
        current.left,
        `${chart.id} (${context}) labels "${previous.text}" and "${current.text}" overlap`
      ).toBeGreaterThanOrEqual(previous.right - 0.5);
    }
  }
  expect(labelledCharts, `every chart in ${context} shows a time axis`).toBe(charts.length);
}

test.describe('time-axis readability (default view)', () => {
  for (const viewport of [
    { width: 400, height: 300 },
    { width: 900, height: 1100 },
  ]) {
    for (const windowSecs of ['60', '30'] as const) {
      test(`labels stay inside the chart box and clear of each other at ${viewport.width}×${viewport.height}, ${windowSecs}s window`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        const charts = await readChartsForView(page, 'Default', windowSecs);
        assertAxisReadable(charts, `default ${viewport.width}×${viewport.height} ${windowSecs}s`);
      });
    }
  }
});

test.describe('time-axis readability (tile view)', () => {
  for (const viewport of [
    { width: 400, height: 300 },
    { width: 900, height: 1100 },
  ]) {
    for (const windowSecs of ['60', '30'] as const) {
      test(`labels stay inside the chart box and clear of each other at ${viewport.width}×${viewport.height}, ${windowSecs}s window`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        const charts = await readChartsForView(page, 'Tile', windowSecs);
        assertAxisReadable(charts, `tile ${viewport.width}×${viewport.height} ${windowSecs}s`);
      });
    }
  }
});

test.describe('time-axis readability (seeded span)', () => {
  test('the 300s window paints the mock seed: HH:MM:SS labels stay contained at 400×300', async ({
    page,
  }) => {
    // Design.md Decision 4: the browser lane must cover the span the harness
    // actually seeds (300 one-second points ≈ 299s), not only truncated
    // windows. The 300-second window shows the whole ring, still under the
    // five-minute cut, so labels keep seconds — the widest label text this
    // lane can paint. 30m/1h are deliberately not selected: they would not
    // paint a longer span than the seed.
    await page.setViewportSize({ width: 400, height: 300 });
    const charts = await readChartsForView(page, 'Default', '300');

    // Self-check that the visible span really is the seed, so this case cannot
    // silently degenerate into another truncated window if the mock changes.
    const span = await chartTimeSpanMs(page, 'cpu');
    expect(span, 'the 300s window must show the seeded ring, not a truncation').toBeGreaterThan(
      SEEDED_SPAN_MS - 5_000
    );
    expect(span).toBeLessThanOrEqual(SEEDED_SPAN_MS + 1_000);

    assertAxisReadable(charts, 'default 400x300 300s seeded');

    // A span under five minutes keeps seconds — asserted on rendered labels
    // here as well as on the pure helper, because this is the only browser
    // case that renders the full seed.
    const frames = await page
      .locator('.recharts-cartesian-axis-tick-value')
      .evaluateAll((nodes) => nodes.map((n) => n.textContent ?? '').filter((t) => t.length > 0));
    expect(frames.length).toBeGreaterThan(1);
    for (const text of frames) {
      expect(text, `seeded-span label "${text}" keeps seconds`).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    }
  });
});

test.describe('time-axis readability (list view)', () => {
  for (const viewport of [
    { width: 400, height: 300 },
    { width: 900, height: 1100 },
  ]) {
    test(`draws no time-axis tick text at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await waitForFirstMetrics(page);
      await expect(page.locator('svg.recharts-surface').first()).toBeAttached();
      await page.getByRole('combobox').selectOption('30');
      await freezeRing(page);
      await page.getByRole('button', { name: 'List' }).click();
      await expect
        .poll(() => page.locator('svg.recharts-surface').count(), { timeout: 10_000 })
        .toBeGreaterThan(0);

      const tickCount = await page.locator('.recharts-cartesian-axis-tick-value').count();
      expect(tickCount, 'list view must not draw a time axis').toBe(0);
    });
  }
});
