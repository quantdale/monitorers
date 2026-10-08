import { formatPercent, formatPercentRange, formatThroughput } from './formatters';

/**
 * Accessible names for metric charts.
 *
 * A chart is a graphic, not a control, so its accessible name has to carry what
 * a sighted user reads off its shape: which metric, what it is doing now, and
 * the visible range. Recharts 3 would otherwise render every chart as
 * `<svg role="application" tabindex="0">` with an empty `<title>` — one
 * meaningless tab stop per card (see MetricChart.tsx).
 *
 * Both builders take the **latest committed chart point**, never a live scalar:
 * live scalars merge on every ~250 ms tick, so a caller that passes one would
 * change the chart's `aria-label` four times a second and defeat MetricChart's
 * memo — re-mounting the Recharts subtree every tick is the largest main-thread
 * cost this app has (see the fan-out guard in MetricChart.test.tsx).
 */
export function buildSingleSeriesChartLabel(
  title: string,
  latestValue: number | null,
  min: number,
  max: number
): string {
  return `${title} trend, now ${formatPercent(latestValue)}, ${formatPercentRange(min, max)} over the selected window`;
}

/** Same contract for a two-series chart (network download/upload). */
export function buildDualSeriesChartLabel(
  title: string,
  latestDown: number | null,
  latestUp: number | null
): string {
  return `${title}, now down ${formatThroughput(latestDown)} and up ${formatThroughput(latestUp)} over the selected window`;
}
