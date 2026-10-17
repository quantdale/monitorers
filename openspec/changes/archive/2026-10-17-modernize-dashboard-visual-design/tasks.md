## 1. Design tokens

- [x] 1.1 Create `src/design/tokens.ts`: surfaces, text tiers, accent/status colors, per-series chart palettes (CPU/memory/network/disks/GPUs), chart axis colors, font stacks, type scale, radii, borders, shadows. Named exports only.
- [x] 1.2 Add contrast proofs in `src/cards/chartLabels.test.ts` reading the token values: tick text ≥4.5:1 and axis stroke ≥3:1 against the card surface token (existing floors, new colors), plus the status-text AA floor used by banners.

## 2. Restyle (behavior preserved)

- [x] 2.1 `src/styles.css`: global base (page background, font stacks, focus ring token, scrollbar, reduced-motion) without touching the `.drag-handle`/`.metric-card:hover` contracts.
- [x] 2.2 `MetricCard.tsx`: all three view modes on the new card shell (hairline border, radius 12, surface tokens); Default/Tile gains the type hierarchy — small muted title, 30px tight metric value, chip-style badges; List row restyled but keeping `minHeight` growth, panel overflow containment, and every `data-testid`.
- [x] 2.3 `MetricChart.tsx`: gradient area fills (`useId`-scoped), faint dotted horizontal gridlines, token axis colors; keep `minTickGap` 80, the 16px time-axis margin, `isAnimationActive={false}`, and identity-stable props.
- [x] 2.4 `App.tsx`: shell + toolbar cluster (segmented ViewModeSelector, styled TimeRangeSelector, pill Metrics trigger, icon sidebar toggle), status pill, restyled banners/loading/empty states — all testids and landmark structure unchanged.
- [x] 2.5 `HardwareSidebar.tsx`, `MetricCardSelector.tsx`, `TimeRangeSelector.tsx`, `ViewModeSelector.tsx`, `ErrorBoundary.tsx`, `formatters.ts` badge chips: token chrome throughout.
- [x] 2.6 `renderCardContent.tsx`: new per-series token colors and chip badges; numeric texts unchanged.

## 3. Re-pin tests and verify

- [x] 3.1 Update literal color pins: `MetricChart.test.tsx` (tick fill/stroke/margin), `e2e/tests/chart-axis-readability.spec.ts` and `e2e/tests/accessibility.spec.ts` (rendered rgb values) to the token values. Geometry/ARIA assertions must pass unmodified in meaning.
- [x] 3.2 Gates from `sys-monitor-tauri/`: `npx tsc --noEmit`, `npm run typecheck:test`, `npm run lint`, `npm test -- --run`, `npm run build` — all green.
- [x] 3.3 `npm run e2e` — 33 passed; `npm run sim` — mock lane green.
- [x] 3.4 Rendered evidence: screenshots at 400×300 and 900×1100 in Default, Tile and List views (Vite mock harness) recorded under `e2e-results/qa/visual-overhaul/` (gitignored) and reviewed against the reference lock.
- [x] 3.5 `openspec validate 2026-10-17-modernize-dashboard-visual-design --type change --strict --no-interactive`; write `evidence.md` (reference lock, token table, contrast proofs, gate results). Do not claim a packaged-lane run.
