## Why

Default and Tile views draw a time axis on every metric chart, and that axis is the remaining glance-path defect the October layout campaign deliberately left untouched. Tick styling sets only `fontSize`, so the label and axis stroke inherit the chart library default — the same `#666` family already measured at 2.90:1 on `#1e1e1e`, below the 3:1 non-text minimum. The formatter always prints hours, minutes, and seconds, so a long history window crowds those labels until they overlap. The number and the shape are already specified; the scale the user reads them against is not.

## What Changes

- Time-axis tick text SHALL meet WCAG AA contrast (at least 4.5:1) against the card surface it is painted on. The axis stroke is a graphical object and SHALL meet at least 3:1 against that same surface. This applies in Default and Tile views, the only views that show the axis.
- Tick labels SHALL NOT overlap or clip inside the chart box at the product's minimum window (400×300) and its normal window (900×1100).
- Label precision SHALL follow the visible span, not a single `HH:MM:SS` string: seconds while the drawn span is under five minutes, hours and minutes once it is five minutes or longer.
- No y-domain change. Percentage charts stay `[0, 100]`; the network chart stays `[0, auto]`. The hidden Y axis stays hidden.
- No palette redesign, no pinned toolbar, no badge-hierarchy restyle, no view-mode rename, no process list, no schema or collector change.

## Capabilities

### New Capabilities

- `chart-axis-readability`: the visible time axis on a metric chart is a readable scale — sufficient contrast, no overlapping or clipped labels — without changing what the chart measures.

### Modified Capabilities

- None. `accessible-ui-feedback` already requires each chart to be a named, non-focusable image; that contract is unchanged. `dashboard-layout-containment` already requires cards and list rows to stay inside their boxes; axis-label collision inside the chart is a new requirement, not a change to those.

## Impact

- Frontend only: `sys-monitor-tauri/src/components/MetricChart.tsx`, and a small pure helper for tick text if the formatter should not live inside the chart component. Tests beside the chart (unit) and in the existing Playwright dashboard specs (rendered contrast and non-overlap).
- Not affected: IPC payload, `SCHEMA_VERSION`, collector, settings schema, card order, view-mode names, the chart-label memo that must not follow 250 ms live scalars, and the hardware sidebar.
- Verification is the Vite mock lane. The packaged lane is not required for an axis-style fix; do not claim it was run.
