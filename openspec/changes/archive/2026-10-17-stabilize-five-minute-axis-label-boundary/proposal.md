## Why

The `formatAxisTick` helper drops the seconds field when the visible span is
`>= 300_000 ms` ("five minutes or longer"). That boundary is exactly reachable:
the five-minute (300 s) history window can produce a visible span of exactly
300 000 ms whenever its oldest sample lands exactly on the window cutoff — and
in the mock harness (1 s grid-aligned timestamps) that is the steady state the
moment a single live sample is committed after the seed. At that point the
whole axis flips between `HH:MM:SS` and `HH:MM` based on nothing the user can
see (the phase of the sample spacing), and flips back when the phase shifts.

This is not hypothetical: the chart-axis campaign's seeded-span E2E case is
racing on exactly this boundary today. It freezes the mock ring and asserts the
labels keep seconds, while its own span self-check admits `span == 300_000`,
where the spec mandates `HH:MM`. Whether the freeze beats the first post-seed
commit decides which format renders: on this machine the case failed 2 of 3
runs (`e2e/tests/chart-axis-readability.spec.ts`, "the 300s window paints the
mock seed"). The campaign recorded 33 passing E2E on a warm machine — the race
was won there and lost here. The test's expectations are internally
contradictory at the boundary, and the product's format rule is phase-dependent
there.

## What Changes

- The seconds-dropping boundary becomes inclusive on the seconds side: a
  time-axis label SHALL keep `HH:MM:SS` when the visible span is **at most**
  five minutes (including exactly 300 000 ms) and SHALL drop the seconds field
  only when the span is **longer** than five minutes.
- Rationale: the visible span of the 300 s window can never exceed 300 000 ms
  (every included sample is at or after `newest - 300 s`), so the inclusive
  rule makes that window's label precision constant over its whole life
  instead of phase-dependent. Crowding protection for genuinely longer spans
  (600 s / 30 m / 1 h windows) is unchanged: they drop seconds exactly as
  before once they exceed five minutes.
- The `chart-axis-readability` spec requirement and its scenarios are amended
  to the inclusive rule, including an explicit boundary scenario.
- Unit pins flip: `formatAxisTick(t, 300_000)` keeps seconds;
  `300_001` and beyond drop them. The E2E seeded-span case reconciles its
  comments with the reachable mock states and becomes deterministic for both
  of them (299 000 ms seed-only ring and 300 000 ms full window both render
  `HH:MM:SS`), so its widest-label containment proof no longer depends on
  winning a race against the mock's first live commit.
- No chart geometry, contrast, y-domain, collector, IPC, or settings change.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `chart-axis-readability`: the "Label precision follows the visible span"
  requirement moves its boundary to an inclusive five-minute span. Overlap,
  containment, contrast, and hidden-scale requirements are unchanged.

## Impact

- Frontend only: `sys-monitor-tauri/src/cards/chartLabels.ts` (one comparison
  plus doc comment), `src/cards/chartLabels.test.ts` (boundary pins),
  `e2e/tests/chart-axis-readability.spec.ts` (comments/self-check wording),
  `openspec/specs/chart-axis-readability/spec.md` (via the delta), and the
  one-line description in root `AGENTS.md`.
- Not affected: `MetricChart.tsx` geometry (`minTickGap`, margins, colors),
  `SCHEMA_VERSION`, collector cadence, the mock seed length, and every other
  window size's rendered format.
- Verification is the Vite mock lane (unit + full E2E, with the seeded-span
  case re-run repeatedly to prove the race is gone). The packaged lane is not
  required for a formatter-boundary fix; do not claim it was run.
