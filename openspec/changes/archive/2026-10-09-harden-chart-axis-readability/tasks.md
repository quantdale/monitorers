## 1. Tick formatter

- [x] 1.1 Add a pure `formatAxisTick(ms, spanMs)` helper next to the chart-label helpers. Local time, zero-padded `HH:MM:SS` when `spanMs` is under 300000, `HH:MM` otherwise. A missing or single-sample span counts as short.
- [x] 1.2 Unit-test the helper for a short span, a span of exactly five minutes, a one-hour span, and a single sample. Assert the strings from the same local `Date` fields, not from `toLocaleTimeString`.
- [x] 1.3 Unit-test the contrast floors: `#888` on `#1e1e1e` is at least 4.5:1, and `#7a7a7a` on `#1e1e1e` is at least 3:1.

## 2. Chart axis

- [x] 2.1 In `MetricChart`, set the time-axis tick fill to `#888`, the axis stroke to `#7a7a7a`, `minTickGap` to at least 80, and the time-axis bottom margin to 16. Format ticks with the helper, using `latest.t - first.t` from the points already passed in.
- [x] 2.2 Do not show the y-axis, do not change either y-domain, do not draw a time axis in List view, and do not add a prop through `renderCardContent`.
- [x] 2.3 Extend `MetricChart.test.tsx` so the tick fill, stroke, gap, and bottom margin are the values from 2.1, and the existing fan-out guard still proves a 250 ms scalar tick does not rebuild the chart body.

## 3. Rendered proof

- [x] 3.1 Add Playwright coverage on the Vite mock lane: at 400×300 and 900×1100, in Default and Tile, every visible time-axis label lies inside its chart box and adjacent labels do not overlap. Assert the computed tick fill is the explicit `#888`, not the library default.
- [x] 3.2 In the same spec, assert List view renders no visible time-axis tick text. Cover the seeded span and the 30-second window. Do not select 30m or 1h and do not lengthen the mock seed.

## 4. Validate

- [x] 4.1 From `sys-monitor-tauri/`, run `npx tsc --noEmit`, `npm run typecheck:test`, `npm test -- --run`, and `npm run build`.
- [x] 4.2 Run `npm run e2e` and confirm the new axis assertions pass with the existing chart-fidelity and layout specs.
- [x] 4.3 Run `openspec validate --change harden-chart-axis-readability --strict --no-interactive`.
- [x] 4.4 Write this change's `evidence.md` with the contrast numbers and the rendered overlap measurements. Do not claim a packaged-lane run.
