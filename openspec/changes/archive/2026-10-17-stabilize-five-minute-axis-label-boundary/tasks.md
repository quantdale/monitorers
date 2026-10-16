## 1. Formatter boundary

- [x] 1.1 In `src/cards/chartLabels.ts`, change the seconds-dropping rule to `spanMs > 300_000` (keep `HH:MM:SS` at spans up to and including exactly five minutes). Update the doc comment: the boundary is inclusive on the seconds side because the 300 s history window can produce a visible span of exactly 300 000 ms, and label precision must not depend on the phase of the sample spacing.
- [x] 1.2 In `src/cards/chartLabels.test.ts`, flip the boundary pins: `formatAxisTick(t, 300_000)` returns `HH:MM:SS`; add `300_001` and keep the one-hour pin dropping seconds. Rename the boundary test so the inclusive rule is what its name says.

## 2. Spec and rendered proof

- [x] 2.1 Write the `chart-axis-readability` delta: MODIFIED requirement "Label precision follows the visible span" (seconds at five minutes or less, dropped only beyond) with an explicit boundary scenario for a full five-minute window.
- [x] 2.2 In `e2e/tests/chart-axis-readability.spec.ts`, reconcile the seeded-span case's comments with the two reachable mock spans (seed-only 299 000 ms and full-window 300 000 ms) and state that both keep seconds under the inclusive rule. No assertion changes should be needed; if one is, the delta in 2.1 is wrong — fix the delta first.
- [x] 2.3 Run the seeded-span case alone at least five times and record that it passes every run (the pre-change failure was 2 of 3 runs on this machine).

## 3. Docs and validation

- [x] 3.1 Update the `formatAxisTick` behavior description in root `progress.md` ("keeps `HH:MM:SS` under a five-minute span and drops seconds above it") to the inclusive rule when the campaign record is rewritten at archive time. (Audit note: no other doc surface restates the boundary — `AGENTS.md`, `CLAUDE.md`, and `.cursorrules` do not mention `formatAxisTick`.)
- [x] 3.2 From `sys-monitor-tauri/`, run `npx tsc --noEmit`, `npm run typecheck:test`, `npm test -- --run`, `npm run build`, and `npm run e2e` — all green.
- [x] 3.3 Run `openspec validate --change 2026-10-17-stabilize-five-minute-axis-label-boundary --strict --no-interactive`.
- [x] 3.4 Write `evidence.md` with the pre-change failure reproduction (2/3 runs), the post-change repetition result, and the gates actually run. Do not claim a packaged-lane run.
