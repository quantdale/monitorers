import type { MetricValue } from './types/metrics';

export interface ChartPoint {
  t: number;
  v: MetricValue;
  v2?: MetricValue;
}

export interface ComputeChartPointsParams {
  history: MetricValue[];
  timestamps?: number[];
  maxPoints: number;
  secondaryHistory?: MetricValue[];
}

function chartValue(value: MetricValue | undefined): MetricValue {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, value);
}

/**
 * Turns a history array into no more than `maxPoints` chart points. Missing
 * samples remain null so Recharts can render a genuine gap; numeric zero is
 * intentionally preserved as zero. The first and newest samples are retained
 * whenever the budget permits both.
 */
export function computeChartPoints({
  history,
  timestamps,
  secondaryHistory,
  maxPoints,
}: ComputeChartPointsParams): ChartPoint[] {
  const budget = Number.isFinite(maxPoints) ? Math.floor(maxPoints) : 0;
  if (history.length === 0 || budget <= 0) return [];
  const ts = timestamps ?? [];
  const hasSecondary = secondaryHistory != null && secondaryHistory.length > 0;
  const addPoint = (index: number): ChartPoint => ({
    t: ts[index] ?? index,
    v: chartValue(history[index]),
    v2: hasSecondary ? chartValue(secondaryHistory?.[index]) : undefined,
  });

  if (history.length <= budget) return history.map((_, index) => addPoint(index));
  if (budget === 1) return [addPoint(history.length - 1)];
  if (budget === 2) return [addPoint(0), addPoint(history.length - 1)];

  // Preserve short-lived extrema instead of selecting one fixed-stride point
  // per bucket. Two extrema per bucket fit the budget and use the same source
  // index for both series, so a narrow spike or a missing-data gap remains
  // visible without an expensive LTTB pass over the 3600-point ring.
  const indices = budget < 4
    ? [0, representativeInteriorIndex(history, secondaryHistory), history.length - 1]
    : extremaIndices(history, secondaryHistory, budget);
  return indices.map(addPoint);
}

function representativeInteriorIndex(
  history: MetricValue[],
  secondaryHistory: MetricValue[] | undefined,
): number {
  const gap = history.slice(1, -1).findIndex((value, index) =>
    chartValue(value) == null || (secondaryHistory != null && chartValue(secondaryHistory[index + 1]) == null)
  );
  return gap >= 0 ? gap + 1 : Math.round((history.length - 1) / 2);
}

function extremaIndices(
  history: MetricValue[],
  secondaryHistory: MetricValue[] | undefined,
  budget: number,
): number[] {
  const bucketCount = Math.floor((budget - 2) / 2);
  const interiorLength = history.length - 2;
  const chosen = new Set<number>([0, history.length - 1]);
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor((bucket * interiorLength) / bucketCount);
    const end = 1 + Math.floor(((bucket + 1) * interiorLength) / bucketCount);
    if (start >= end) continue;
    let minIndex = start;
    let maxIndex = start;
    let minValue = Number.POSITIVE_INFINITY;
    let maxValue = Number.NEGATIVE_INFINITY;
    let hasFinite = false;
    let gapIndex: number | null = null;
    for (let index = start; index < end; index += 1) {
      const value = chartValue(history[index]);
      const secondaryValue = chartValue(secondaryHistory?.[index]);
      if (value == null || (secondaryHistory != null && secondaryValue == null)) {
        gapIndex ??= index;
      }
      if (value == null) continue;
      hasFinite = true;
      if (value < minValue) {
        minValue = value;
        minIndex = index;
      }
      if (value > maxValue) {
        maxValue = value;
        maxIndex = index;
      }
    }
    if (gapIndex != null) {
      // A gap consumes one slot in this bucket. Use the largest finite primary
      // point for the other slot so a short spike remains visible as well.
      chosen.add(gapIndex);
      chosen.add(hasFinite ? maxIndex : start);
    } else if (!hasFinite) {
      chosen.add(start);
    } else {
      chosen.add(minIndex);
      chosen.add(maxIndex);
    }
  }
  return [...chosen].sort((a, b) => a - b).slice(0, budget);
}
