# Domain glossary (frontend)

Terms used consistently across the React frontend. Add a term when a new
module or concept is introduced; check here before naming anything.

## Chart points
A `ChartPoint` (`src/chartPoints.ts`) is `{ t, v, v2? }` — one renderable
sample for a Recharts `AreaChart`. `computeChartPoints` is the single pure
function that turns a history array into chart points. Missing and non-finite
values become `null` gaps, legitimate zero remains zero, negative values are
clamped, and a bounded extrema-preserving sampler is used over the rendering
budget.

## Rendering budget
`MAX_CHART_POINTS` (300) — the most data points a chart renders. History
past the budget is downsampled with first/latest boundary preservation and
bucket extrema, so a short spike remains visible while output stays at or
below the budget.

## Extrema-preserving sampling
The downsampling strategy in `computeChartPoints`: divide source indices into
bounded buckets, retain bucket extrema and the first/latest source points, and
sort by original index. Secondary series and null gaps remain aligned.

## Card content module
`src/cards/` — the pure-ish presentation layer for dashboard cards:
`renderCardContent({ id, metrics, viewMode, hasNvidiaData })` maps a card id
to the `SortableCard` that renders it (or null when the metric is absent),
and `formatters.ts` holds every value formatter and badge style. App.tsx
stays layout/drag/settings glue and never formats values itself.

## Sync words
- Card content is *rendered*, not *composed* — `renderCardContent` decides
  per-id what a card shows.
- The chart *renders* data; history *commits* on 1 Hz `on_tick` events.
- A time-range selector means elapsed timestamp coverage. A missing sample is
  a gap, not a zero-valued observation.

## Collector session / supervision
The backend runs collection as *supervised sessions*
(`src-tauri/src/collector/supervisor.rs`). A panic ends one session; the
supervisor replaces it with a fresh one (bounded attempts, staged backoff,
healthy-period streak reset) and reports transitions as `CollectorStatus`
(`starting | healthy | recovering | failed | stopping`). The frontend calls
this the *lifecycle*. A *generation* is one supervised session's ordinal.

## Retry metrics
The user-facing control for an exhausted recovery budget: invokes
`retry_collection` (honored only while `failed`, coalesced otherwise). Success
clears the failure UI automatically — never by restarting the process.
