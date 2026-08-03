# Domain glossary (frontend)

Terms used consistently across the React frontend. Add a term when a new
module or concept is introduced; check here before naming anything.

## Chart points
A `ChartPoint` (`src/chartPoints.ts`) is `{ t, v, v2? }` — one renderable
sample for a Recharts `AreaChart`. `computeChartPoints` is the single pure
function that turns a history array into chart points (NaN/null → 0,
negatives clamp, stride sampling when over the rendering budget).

## Rendering budget
`MAX_CHART_POINTS` (300) — the most data points a chart renders. History
past the budget is stride-sampled. When a chart's history crosses the budget,
the rendered chart visibly resamples (e.g. 300 → ~151 points), which e2e
chart-fidelity tests must account for.

## Stride sampling
The downsampling strategy in `computeChartPoints`: keep every Nth point
(`N = ceil(length / budget)`) and always include the last point, so the
latest value is always on screen.

## Card content module
`src/cards/` — the pure-ish presentation layer for dashboard cards:
`renderCardContent(id, { metrics, viewMode, hasNvidiaData })` maps a card id
to the `SortableCard` that renders it (or null when the metric is absent),
and `formatters.ts` holds every value formatter and badge style. App.tsx
stays layout/drag/settings glue and never formats values itself.

## Sync words
- Card content is *rendered*, not *composed* — `renderCardContent` decides
  per-id what a card shows.
- The chart *renders* data; history *commits* on 1 Hz `on_tick` events.
