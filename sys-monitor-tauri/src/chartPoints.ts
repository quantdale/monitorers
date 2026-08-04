export interface ChartPoint {
  t: number;
  v: number;
  v2?: number;
}

export interface ComputeChartPointsParams {
  history: number[];
  timestamps?: number[];
  maxPoints: number;
  secondaryHistory?: number[];
}

/**
 * Turns a history array into at most maxPoints chart-ready points.
 * Stride-samples when over the limit but always includes the last element,
 * so the chart always shows the latest value. NaN/null values become 0 and
 * negatives clamp to 0 (Recharts cannot draw them). When a secondary history
 * is provided its values ride along on v2 (dual-line charts, no fill).
 */
export function computeChartPoints({
  history,
  timestamps,
  secondaryHistory,
  maxPoints,
}: ComputeChartPointsParams): ChartPoint[] {
  if (history.length === 0) return [];
  const ts = timestamps ?? [];
  const hasSecondary = secondaryHistory != null && secondaryHistory.length > 0;
  const addPoint = (idx: number): ChartPoint => {
    const rawV = history[idx];
    const v = Math.max(0, rawV == null || Number.isNaN(rawV) ? 0 : rawV);
    let v2: number | undefined;
    if (hasSecondary && secondaryHistory) {
      const rawV2 = secondaryHistory[idx];
      v2 = Math.max(0, rawV2 == null || Number.isNaN(rawV2) ? 0 : rawV2);
    }
    return { t: ts[idx] ?? idx, v, v2 };
  };
  if (history.length === 1) return [addPoint(0)];
  if (history.length <= maxPoints) return history.map((_, i) => addPoint(i));
  const stride = Math.ceil(history.length / maxPoints);
  const data: ChartPoint[] = [];
  // Track the last index actually sampled instead of comparing timestamps:
  // duplicate timestamps (two points in the same ms) would make a t-based
  // check incorrectly treat the last point as already included.
  let lastSampledIndex = -1;
  for (let i = 0; i < history.length; i += stride) {
    data.push(addPoint(i));
    lastSampledIndex = i;
  }
  if (lastSampledIndex !== history.length - 1) {
    data.push(addPoint(history.length - 1));
  }
  return data;
}
