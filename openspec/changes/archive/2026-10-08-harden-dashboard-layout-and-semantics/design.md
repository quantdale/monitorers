# Design — Harden dashboard layout containment and semantic accessibility

## D1. Where the clamping belongs

The production collector reports percentages that cannot be negative; the mock
backend does not honour that for CPU (`30 + 40·sin`) or for GPU utilizations whose
wave range is `base 10–59 ± amp 25–44` (i.e. −34…103), while the *same file* clamps
disk and network series with `Math.max(0, …)`. Two independent guards are needed,
each with a distinct job:

1. **Fidelity guard (mock backend)** — a single `clampUtilization(v)` used by every
   utilization the mock emits (CPU, memory, disk active-time, GPU). This is the
   root cause: without it the mock lane advertises values production cannot produce.
2. **Display guard (frontend formatter)** — `formatPercentRange(min, max)` in
   `cards/formatters.ts`, the one place that renders a percentage range. It clamps
   to 0–100 and formats, so the rule cannot drift per call site (the network card's
   range, which currently hand-rolls `Math.max(0, …)` twice, uses the same helper).

`formatPercent` already clamps; min/max was the only unclamped percentage path.

## D2. Tile grid containment

`gridTemplateColumns: '1fr 1fr'` is `minmax(auto, 1fr)` per track, so any item
whose min-content width exceeds half the container widens *its* track. Measured at
a 390 px viewport: `406.234px 180.703px` inside a 358 px container.

Replacement: `repeat(auto-fit, minmax(300px, 1fr))`.

- at 868 px content width → 2 columns of 430 px (identical to today, verified);
- at 358 px → 1 column, so nothing is squeezed and nothing overflows;
- the track minimum (300 px) is below the narrowest card that still renders its
  header row and badges legibly, and above the point where a chart becomes a smear.

This keeps the product's existing 2-up Tile design at its real window sizes and
only changes behaviour where today's layout is broken. `min-width: 0` is added to
the sortable wrapper so grid items can shrink instead of forcing their track.

## D3. List rows: grow, never clip

Today: `height: 50` + `overflow: hidden` on the row, `width: 30%` label column,
`width: 70%` chart column, and the label column's meta rows wrap.

Change: `min-height: 50` (row auto-grows), drop the row's `overflow: hidden`
(the title keeps its own ellipsis), and give the label column
`flex: 1 1 55%; min-width: 0; max-width: 65%` with the chart column
`flex: 1 1 45%; min-width: 140px`.

Consequences, all verified by re-render: at 900 px the rows stay two lines (the
label fits, the range sits under it), and at 390 px the Network card's range pills
wrap onto additional lines instead of being cut off — information is preserved,
which is the point of the metric. The drag handle, title, value and chart all keep
their existing DOM/test hooks.

## D4. Semantics

- **Landmarks/heading**: `App.tsx` renders `<header>` (product title as `h1` +
  toolbar) inside `<main>`. No CSS change; the existing inline styles carry over.
- **Charts**: `MetricChart` passes `role="img"`, `tabIndex={-1}` and an
  `aria-label` to `AreaChart`. Recharts forwards `role`, `tabIndex` and `aria-*`
  to the surface `<svg>` (verified in `node_modules/recharts`:
  `svgPropertiesNoEvents` keeps `role`, `tabIndex`, `aria-label`; `CategoricalChart`
  derives `tabIndex`/`role` from `accessibilityLayer` only when the prop is not
  given). The label is built by `MetricCard` from data it already has —
  `"<title> trend, now <value>, <min> to <max> over the selected window"` — so the
  chart stops being an unnamed tab stop and starts conveying the trend summary a
  sighted user gets from the shape.
- **Collapsed sidebar**: `visibility` is added to the existing width transition
  (`transition: width 250ms ease, visibility 250ms ease`), which per CSS
  interpolation keeps it visible for the whole collapse and removes it from the
  accessibility tree and tab order once closed.
- **Drag handles**: `aria-label`/`title` become `Reorder <card> card`, using the
  `title` the card already renders. `e2e/tests/accessibility.spec.ts` asserts the
  stronger name.
- **Selector popover**: focus moves into the panel on open (and Escape still
  returns it to the trigger), so a keyboard user is not left outside the dialog
  they just opened.
- **Contrast**: drag-handle glyph `#666` → `#7a7a7a` (2.90:1 → 3.88:1 on `#1e1e1e`).

## D5. Verification surface

- Unit: `cards/formatters.test.ts` (range clamping/formatting), the mock-backend
  suites (`src/sim/mockBackend.test.ts`) asserting every emitted utilization is in
  0–100 across a full simulated window, and `renderCardContent` tests for the new
  props.
- E2E (new assertions in existing specs where they belong):
  - tile grid has equal column tracks and no card exceeds its container at a
    390 px viewport, and still two equal tracks at 900 px;
  - list rows never clip content (`scrollHeight <= clientHeight + 1`) at 390 px
    and 900 px;
  - every chart is `role="img"` with a non-empty accessible name and
    `tabindex="-1"`, and the page exposes `banner`/`main`/`heading` landmarks;
  - no card renders a negative percentage.
- Lane: `npx tsc --noEmit`, `npm run typecheck:test`, `npm test -- --run`,
  `npm run build`, `npm run e2e`, `npm run sim:typecheck`, and the mock simulation
  lane (`npm run sim`) because the mock payload changed.
- Visual: screenshots at 390×844, 400×300, 900×1100 and 1280×720 in Default, Tile
  and List modes, before and after, stored under `e2e-results/qa/`.
