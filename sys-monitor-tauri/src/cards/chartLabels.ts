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

/** A visible span at or above this drops the seconds field from tick labels. */
const SECONDS_SPAN_CUTOFF_MS = 300_000;

function zeroPad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Time-axis tick text for a chart, keyed on the **visible span** so label
 * width stays predictable: `HH:MM:SS` while the span is under five minutes,
 * `HH:MM` once it is five minutes or longer (the long form is half as wide,
 * so a long window no longer crowds labels into each other).
 *
 * A missing span (no data) or a single-sample span (zero elapsed time) counts
 * as short — there is nothing long to compress, and `HH:MM:SS` is still a
 * truthful local clock reading.
 *
 * Local `Date` fields, zero-padded, on purpose: `toLocaleTimeString` emits
 * locale-dependent width (e.g. `AM/PM`), which makes both the overlap budget
 * and the unit test unknowable. The chart's accessible name (built above)
 * carries the value, not the axis text, so a 24-hour clock here is not a
 * regression.
 *
 * Pure and cheap: callers pass timestamps already in the chart's point array,
 * so this can run inside MetricChart's memoized body without turning a 250 ms
 * scalar tick into a chart rebuild.
 */
export function formatAxisTick(ms: number, spanMs?: number): string {
  const date = new Date(ms);
  const hh = zeroPad(date.getHours());
  const mm = zeroPad(date.getMinutes());
  if (spanMs != null && spanMs >= SECONDS_SPAN_CUTOFF_MS) {
    return `${hh}:${mm}`;
  }
  return `${hh}:${mm}:${zeroPad(date.getSeconds())}`;
}
