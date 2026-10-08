# Tasks — Harden dashboard layout containment and semantic accessibility

> Executor rule: every visual claim must be backed by a re-render measurement or a
> screenshot at a named viewport; every semantic claim by a rendered-DOM assertion.

## 1. Record the defects with evidence

- [x] 1.1 Render the app (Vite mock lane) and capture screenshots at 390×844, 400×300, 900×1100 and 1280×720 in Default, Tile and List modes; store them under `e2e-results/qa/`.
- [x] 1.2 Measure the Tile grid tracks and card widths at 390 px and 900 px; record the unequal `406.234px 180.703px` split inside a 358 px container.
- [x] 1.3 Measure every List row's `scrollHeight` vs `clientHeight` at 390 px; record the Network row clipping (72 > 50).
- [x] 1.4 Record the rendered landmark/heading counts (0/0/0/0) and the chart surface markup (`<svg role="application" tabindex="0"><title></title>…` ×7).
- [x] 1.5 Record the negative rendered percentage (`Min: -9.9%`) and trace it to the mock's unclamped series.

## 2. Fix percentage validity

- [x] 2.1 Add `clampUtilization` to the mock backend and apply it to every utilization it emits (CPU, memory, disk active time, GPU util), so the mock payload matches the production range.
- [x] 2.2 Add `formatPercentRange` to `cards/formatters.ts` and use it in `MetricCard`'s List view, replacing the inline `toFixed(1)` min/max; route the network card's hand-rolled `Math.max(0, …)` ranges through the same helper.
- [x] 2.3 Unit-test both: the formatter clamps and formats, and a full simulated window of mock history contains no utilization outside 0–100.

## 3. Contain the layout

- [x] 3.1 Replace the Tile grid's `1fr 1fr` with `repeat(auto-fit, minmax(300px, 1fr))` and add `min-width: 0` to the sortable wrapper so items shrink instead of forcing their track.
- [x] 3.2 Convert List rows to `min-height` with no outer `overflow: hidden`, and give the label/chart columns flexible bases with minimums.
- [x] 3.3 Re-measure after the change: equal grid tracks at 900 px, one column at 390 px, no card wider than its container, and no List row clipping at either width.

## 4. Give the page real semantics

- [x] 4.1 Add `header`/`main` landmarks and render the product title as an `h1`.
- [x] 4.2 Make each chart a named, non-focusable image: `role="img"`, `tabIndex={-1}` and an `aria-label` carrying the card's current value and visible min/max.
- [x] 4.3 Name each drag handle `Reorder <card> card` and update `e2e/tests/accessibility.spec.ts` to assert the stronger name.
- [x] 4.4 Remove the collapsed hardware sidebar from the accessibility tree and tab order via `visibility` in the existing width transition.
- [x] 4.5 Move focus into the metric-selector panel when it opens (Escape still returns it to the trigger).
- [x] 4.6 Raise the drag-handle glyph contrast above 3:1 (`#666` → `#7a7a7a`).

## 5. Prove it

- [x] 5.1 Run `npx tsc --noEmit`, `npm run typecheck:test`, `npm test -- --run` and `npm run build`.
- [x] 5.2 Run `npm run e2e` plus the new narrow-viewport/landmark/chart assertions.
- [x] 5.3 Run `npm run sim:typecheck` and `npm run sim` (the mock payload changed).
- [x] 5.4 Re-render and re-screenshot every affected viewport/mode and compare against §1; confirm each §1 defect is gone.
- [x] 5.5 Run `npx openspec validate --strict` for this change and `git diff --check`.
- [x] 5.6 Update `progress.md` with the campaign record and store the before/after evidence in this change's `evidence.md`.
