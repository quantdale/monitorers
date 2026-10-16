# Design — stabilize the five-minute axis-label boundary

## Context

`formatAxisTick(ms, spanMs)` chooses `HH:MM:SS` vs `HH:MM` from the visible
span. The archived chart-axis campaign pinned the rule as "seconds under five
minutes, dropped at or above", i.e. `spanMs >= 300_000` drops seconds. Two
facts make that boundary wrong:

1. **The boundary is reachable, not asymptotic.** For a window of W seconds,
   the visible span is `newest - oldest_in_window`, and every included sample
   is at or after `newest - W*1000`, so the span is at most exactly `W*1000`.
   For the 300 s window the span therefore lands exactly on 300 000 ms
   whenever the oldest sample sits exactly on the cutoff. The mock harness
   timestamps live on a 1 s grid (`historyAnchorMs + k*1000`), so once one
   live full-tick is committed after the seed, the full-window span is exactly
   300 000 ms — deterministically.
2. **The format must not depend on phase.** Under `>=`, the same 300 s window
   renders `HH:MM:SS` at span 299 000 (seed-only ring) and `HH:MM` at span
   exactly 300 000 (ring with ≥1 live commit). Nothing user-visible differs
   between those states; only the sampling phase does. The seeded-span E2E
   case sits precisely on this fault line: its self-check allows
   `span <= 300_000` while its format assertion demands `HH:MM:SS`, which the
   spec forbids at exactly 300 000. Observed: 2 of 3 local runs failed.

## Options considered

### A. Product fix: inclusive boundary (`spanMs > 300_000` drops seconds)

The 300 s window's span can never exceed 300 000 ms, so an inclusive-keep rule
makes that window's precision constant over its whole life. Longer windows
(600 s / 30 m / 1 h) still drop seconds once they exceed five minutes, so the
crowding protection is unchanged. Both reachable mock states render
`HH:MM:SS`, making the existing E2E case deterministic without touching its
assertions.

### B. Test-only fix: assert format-matches-span

Race-free but it forfeits the campaign's stated purpose — the widest-label
(`HH:MM:SS`) containment proof over the longest span the lane can paint would
only run when the freeze happens to beat the first live commit. The product's
phase-dependent format at a first-class window size would remain.

### C. Hysteresis on the cutoff

Correct for arbitrary cutoffs but far more machinery than a display-format
choice warrants; the reachable boundary is a single, known value.

## Decision

**Option A**, with the spec amended in the same change so the requirement, the
helper, the unit pins, and the rendered proof tell one story: seconds at spans
of five minutes or less, dropped strictly beyond. The boundary scenario is
added to the spec so a later refactor cannot silently re-flip the comparison
direction.

## Consequences

- `formatAxisTick(t, 300_000)` → `HH:MM:SS` (was `HH:MM`); `300_001` → `HH:MM`
  (unchanged). A one-sample or empty span still counts short (unchanged).
- The 300 s window keeps seconds at every point of its life; the 600 s+ windows
  transition once, monotonically, as their span grows past five minutes.
- The seeded-span E2E case is deterministic for both reachable mock spans and
  keeps asserting the widest label text against containment/overlap at 400×300.
