## Why

The dashboard's visual language is a 2026-era rough draft: flat `#1e1e1e`
boxes with `#444` hairlines on a flat `#141414` page, 13px monospace title
chips and value chips bordered like form fields, `#888`-on-dark micro-text
everywhere, default-weight Recharts lines on empty boxes, and toolbar
controls that look like unstyled HTML (a native `<select>`, bordered square
buttons). Nothing communicates hierarchy: the live number — the single most
important glance value on a system monitor — renders at the same 13px
monospace size as its own label. Refero research (Polar's dark admin
dashboard, steel.dev's usage console, chargetrip's dark analytics grid)
shows the modern standard for exactly this product class: a deep charcoal
canvas with hairline-bordered elevated cards, huge tight metric numerals over
small muted labels, faint dotted chart gridlines with soft gradient fills,
compact segmented/pill controls, and consistent accent discipline.

The product deserves that. The behavioral contracts (contrast floors,
containment, landmarks, named charts, drag semantics, lifecycle UX) are all
kept — this change is the visual system, not the behavior.

## What Changes

- A single token module (`src/design/tokens.ts`) becomes the design system:
  surfaces, text tiers, accent/status colors, per-series chart colors,
  typography stack + scale, radii, borders, shadows. Every component reads
  its styling from tokens instead of 20+ ad-hoc hex literals.
- New visual language (grounded in the Refero reference lock below):
  deep charcoal page (`#0A0C10`) with elevated hairline-bordered cards
  (`#15181E`, radius 12, translucent borders), a real type hierarchy —
  30px tight metric numerals over 12px muted labels — modern pill/segmented
  controls, refined banners with tinted surfaces, and gradient-filled charts
  with faint dotted gridlines.
- The toolbar becomes a designed control cluster: segmented View-mode
  control (Default/Tile/List), a styled time-range select, a pill Metrics
  trigger with count, and an icon sidebar toggle; a compact status pill
  surfaces collector health beside the title.
- Charts gain per-series gradient area fills (React `useId`-scoped SVG
  gradients — identity-stable for the render fan-out guard), faint dotted
  gridlines, and axis colors re-pinned from the tokens with fresh contrast
  proofs.
- All existing test contracts are preserved: testids, ARIA, landmarks,
  containment geometry (equal tile tracks, collapse at 400px, growing list
  rows), named charts, per-card drag handles, banner semantics. Unit/E2E
  pins that assert literal colors are re-pinned to the token values with
  contrast re-proofed (4.5:1 tick text, 3:1 axis stroke, AA status text).

## Reference lock (Refero)

- Primary: **Polar** dark admin dashboard (`79903407-…`): near-black canvas,
  hairline-bordered charcoal cards (radius ~12, 16–24px padding), huge tight
  metric numbers (36–48px/600-700) over small muted labels, compact segmented
  time control, pill buttons, faint dotted chart grid, subtle hover elevation.
- Borrowed details: **steel.dev** (`d499ba7e-…`) — the metric summary row
  (small muted label above larger value) and chart-card header with
  right-aligned annotation; **chargetrip** (`4abd4a1b-…`) — per-card
  accent-colored series on soft dark cards with faint dotted gridlines and
  corner micro-labels.
- Rejected: light themes (the product is a dark system monitor), purple brand
  identity (chargetrip's brand), external fonts (CSP blocks all external
  network — system font stack only: Segoe UI Variable / Cascadia Mono).
- Constraint adaptation: inline React styles + global `styles.css` only (CSP
  `style-src 'unsafe-inline'`), chart contrast floors preserved with new
  explicit token colors.

## Capabilities

### New Capabilities

- None. This change is the visual system; every behavioral contract lives in
  the existing specs and is preserved verbatim.

### Modified Capabilities

- None. `chart-axis-readability`'s contrast/geometry requirements, and
  `accessible-ui-feedback`, `dashboard-layout-containment`,
  `keyboard-accessible-drag-reorder` contracts are unchanged — their tests
  re-pin to the new token values and must pass unmodified in meaning.

## Impact

- Frontend only: `src/design/` (new), `src/styles.css`, `App.tsx`,
  `MetricCard.tsx`, `MetricChart.tsx`, `HardwareSidebar.tsx`,
  `renderCardContent.tsx`, `formatters.ts`, `TimeRangeSelector.tsx`,
  `ViewModeSelector.tsx`, `MetricCardSelector.tsx`, `ErrorBoundary.tsx`.
- Tests re-pinned: `chartLabels.test.ts` (contrast proofs read tokens),
  `MetricChart.test.tsx` (axis colors/gap/margin), `e2e/tests/accessibility.spec.ts`
  + `chart-axis-readability.spec.ts` (rendered rgb pins).
- Not affected: IPC schema, `SCHEMA_VERSION`, collector, settings schema and
  persistence, mock backend behavior, sim/e2e platforms' logic.
- Verification: both typechecks, lint, full unit suite, build, full E2E,
  mock sim lane, plus rendered screenshots at 400×300 and 900×1100 in all
  three views as visual evidence. Packaged lane not required for a styling
  change; do not claim it was run.
