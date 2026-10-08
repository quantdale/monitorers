# Harden dashboard layout containment and semantic accessibility

## Why

A visual and accessibility pass was run against the running application (Vite
mock lane, screenshot + accessibility-tree evidence at 390×844, 400×300,
900×1100 and 1280×720; see `evidence.md`). It found user-visible defects, not
aesthetic opinions:

1. **A percentage the UI can display is negative.** In List view the CPU card
   renders `Min: -9.9%  Max: 69.9%`. The current value is safe
   (`formatPercent` clamps to 0–100) but the List row's min/max is formatted
   inline with `toFixed(1)` and is not. The trigger is mock fidelity: the mock
   backend's CPU series is `30 + 40·sin(t)` → −10…70, while the production
   collector's percentage counters can never be negative (and its disk/GPU
   series in the same file *are* clamped, so the file contradicts itself).
2. **The Tile grid breaks at the product's own minimum window size.** The window
   is 400×300 (`tauri.conf.json`), and at a 390 px viewport the Tile grid's
   `gridTemplateColumns: '1fr 1fr'` resolves to `406.234px 180.703px` — the first
   column is wider than its own container (358 px), because `1fr` is
   `minmax(auto, 1fr)` and card content has a large min-content width. Cards are
   misaligned and their content overflows them.
3. **List rows clip information.** Rows are `height: 50` with `overflow: hidden`.
   The Network card's range pills wrap at narrow widths: measured
   `scrollHeight 72 > clientHeight 50`, so its min/max range is cut off. The same
   row's title is ellipsized (`Netwo…`, `D_:`, `RTX 4050`) because the value pill
   takes the remaining space of a 30 %-wide label column.
4. **The interface has no landmarks and no headings** — `header`, `main`, `nav`,
   `h1`–`h3` are all 0 on the rendered page, and the product name is a `<span>`.
   Screen-reader users cannot navigate the page at all.
5. **Every chart is an unnamed, focusable `role="application"` widget.** Recharts
   3 defaults `accessibilityLayer` on, which renders
   `<svg role="application" tabindex="0"><title></title><desc></desc>…` — 7 extra
   tab stops per dashboard that announce nothing (WCAG 4.1.2 / 2.4.3).
6. **The collapsed hardware sidebar stays in the accessibility tree and the tab
   order.** It is hidden with `width: 0; overflow: hidden`, which removes it
   visually but not from assistive technology.
7. **Seven drag handles share the accessible name "Drag to reorder"**, so a screen
   reader cannot tell which card a handle belongs to.
8. **The drag handle glyph is `#666` on `#1e1e1e`** — 2.90:1, below the 3:1
   minimum for a non-text UI component.

The dashboard's job is "glance at live resource state, then drill in"; every item
above either corrupts a number, hides information, or removes the page from
assistive-technology navigation.

## What Changes

- **Correctness**: clamp percentage min/max at the display boundary (one shared
  formatter) and make the mock backend produce physically valid utilizations
  (0–100) for CPU, memory, disk and GPU alike, so the mock lane stops diverging
  from the production payload.
- **Layout containment**: Tile view uses an `auto-fit`/`minmax` grid that keeps
  equal columns and collapses to one column below the track minimum; List rows
  grow instead of clipping, and the label column gets a flexible basis with a
  minimum so titles stop being ellipsized away.
- **Semantics**: `header` + `main` landmarks and an `h1` product title; each chart
  becomes a non-focusable `role="img"` with a real accessible name that carries the
  current value and the visible min/max; per-card drag-handle names; the collapsed
  sidebar leaves the accessibility tree and the tab order; the drag handle glyph
  contrast is raised above 3:1.
- **Regression coverage**: unit tests for the new formatter/utility, and
  Playwright tests for the narrow-viewport grid, list-row containment, chart
  image semantics and landmark structure.

Not in scope: the y-domain policy of the charts, the product's dark palette, view
modes, persistence, or any backend/collector change.

## Capabilities

### New Capabilities
- `dashboard-layout-containment`: the tile grid and list rows must keep every card
  and every rendered number inside its container at the product's minimum window
  size (400×300) and above, without clipping information or producing unequal
  grid columns.

### Modified Capabilities
- `accessible-ui-feedback`: charts, the collapsed sidebar and the drag handles
  gain correct semantics (named non-focusable images, landmarks, per-card handle
  names, hidden-when-collapsed), and the accessible name of a metric card
  includes its identity.
- `frontend-code-deduplication`: the percentage-range formatting that was inline
  in `MetricCard` becomes one shared, tested formatter used by every card, so the
  clamping rule cannot drift per call site again.
- `realistic-usage-testing`: the mock backend's utilization series must match the
  production payload's valid range, so a defect visible in the mock lane is a real
  defect rather than a mock artifact.

## Impact

- **Frontend only**: `src/App.tsx`, `src/components/MetricCard.tsx`,
  `src/components/MetricChart.tsx`, `src/components/HardwareSidebar.tsx`,
  `src/components/MetricCardSelector.tsx`, `src/components/SortableCard.tsx`,
  `src/cards/renderCardContent.tsx`, `src/cards/formatters.ts`,
  `src/utils.ts` (or a sibling utility), `src/styles.css`,
  `src/sim/mockBackend.ts`, plus tests.
- **Not affected**: `src-tauri/**`, the IPC contract and schema versions, settings
  persistence and schema, the collector, the simulation platform's drivers, and
  every existing test's intent (the drag-handle accessible name changes, so
  `e2e/tests/accessibility.spec.ts` is updated to assert the stronger name).
- **Design reference**: Refero MCP was consulted for real-product dashboard
  patterns before the layout decisions were made (W&B system-metrics dashboard,
  Chargetrip analytics, Polar). The pattern that drove the tile fix is the
  uniformly-sized equal-column card grid with uniform 16–24 px spacing; the pattern
  that drove the header structure is the separation of a fixed app header from a
  scrollable card canvas behind a navigation rail. See `evidence.md` §Refero.
