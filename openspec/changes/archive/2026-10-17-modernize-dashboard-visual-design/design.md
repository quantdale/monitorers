# Design — modernize the dashboard visual system

## Context

The dashboard renders from 20+ ad-hoc hex literals scattered through
components (`#141414` page, `#1e1e1e` cards, `#444` borders, `#888` micro
text, `#4699e8` accent …). Hierarchy is flat: the live metric value renders
at the same 13px monospace size as its own label inside bordered "chips".
Refero research (screens `79903407…` Polar, `d499ba7e…` steel.dev,
`4abd4a1b…` chargetrip) establishes the modern standard for dark monitoring
consoles and is captured as the reference lock in the proposal.

Hard constraints (unchanged): inline React styles + global `styles.css`
(CSP `style-src 'unsafe-inline'`, no external fonts — system stacks only),
identity-stable chart props (render fan-out guard), and every behavioral
contract in `accessible-ui-feedback`, `chart-axis-readability`,
`dashboard-layout-containment`, `keyboard-accessible-drag-reorder`.

## Options considered

### A. Token module + full restyle (chosen)

`src/design/tokens.ts` owns palette/typography/radii/elevation; components
import fragments. Tests assert against tokens (contrast proofs computed from
the token values), so the design system and its verification cannot drift.
The restyle follows the reference lock's proportions (big numerals, muted
labels, hairline cards, faint grid, pill/segmented controls).

### B. Global CSS classes only

Faster but conflicts with the repo's inline-style convention and makes
per-card accent colors awkward (they are dynamic per series). Rejected.

### C. Component library (shadcn/MUI)

CSP-compatible at runtime but imports a design system with its own opinions
and dependency tree into a deliberately small app; the repo's convention is
hand-rolled inline styles. Rejected.

## Decisions

1. **Surfaces**: page `#0A0C10`; cards `#15181E` with hairline
   `rgba(255,255,255,0.08)` borders and radius 12; inner wells (chart plots,
   list rows' chart pane) `#101319`. Hover elevation via a soft shadow.
2. **Type**: `Segoe UI Variable / Segoe UI / system-ui` sans,
   `Cascadia Mono / Consolas` for numerals. Metric value 30px/600 with
   tight tracking over a 12px muted uppercase-ish label; metadata 11px.
3. **Accent discipline**: one interactive blue `#4D8DFF` (buttons, active
   segment, focus ring); status colors (green/amber/red) reserved for
   health; per-series chart colors are the only other chroma (CPU blue,
   memory green, network cyan/amber, disks/gpus rotated palettes).
4. **Charts**: series-colored stroke with a vertical gradient fill
   (`useId`-scoped `<linearGradient>`; stable across ticks), faint dotted
   horizontal gridlines `rgba(255,255,255,0.05)`, axis tick text
   `#9CA3AF` and stroke `#6B7280` — both re-proven against the new card
   surface by the existing contrast tests (4.5:1 / 3:1 floors).
5. **Controls**: View-mode becomes a segmented control (active segment
   filled with the accent tint); time-range select keeps native semantics
   (`aria-label="History time range"` contract) with token chrome; Metrics
   trigger and sidebar toggle become pills; the Metrics panel gets the
   elevated surface treatment.
6. **Status pill** (new, additive): a compact pill next to the title
   showing collector state (Starting/Healthy/Recovering/Failed) with a
   status dot — the glance-layer counterpart to the existing banners, whose
   testids/semantics are untouched.

## Consequences

- One module owns the look; a palette change is a one-file edit and the
  contrast proofs re-run in unit tests.
- Every existing E2E contract (testids, ARIA, geometry, landmarks) is
  preserved; only literal rgb pins move to the new token values.
- Charts are slightly heavier per render (gradient defs) but memoized with
  the same identity discipline — the fan-out guard test still passes.
