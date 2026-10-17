## Why

The canonical `verify:fast` gate is intermittently red on a healthy tree:
`collector::run_loop::tests::test_first_poll_waits_for_initial_deadline_after_rate_priming`
failed in the `--no-default-features` matrix under load with

```
second poll fired 614.7809ms after priming — cadence collapsed
```

The cadence did not collapse. The loop schedules on a fixed deadline grid —
`deadline_k ≥ epoch + k·250 ms`, and `rebase_deadline` only ever pushes a
deadline later — so when tick 0 is delayed by scheduling load but finishes
before its successor's deadline, the second tick lands close behind it. The
test's `second >= first + floor` assertion measures spacing from the ACTUAL
first emit and therefore double-counts tick 0's lateness: with the first emit
at ~430 ms and a perfectly healthy grid, the second lands at ~615 ms and
trips the 617.5 ms threshold.

This is not just flaky — it asserts semantics the spec explicitly disclaims.
`collector-time-fidelity`'s "Collector scheduling is monotonic and
non-catching-up" requirement says: "Work time SHALL NOT be added to the
period… the next scheduled tick is due at the next 250 ms deadline from the
monotonic schedule, not 330 ms after the prior start." The gap between
consecutive actual emits is not bounded below; the grid is.

## What Changes

- The cadence-regression test's second assertion moves from a gap-based bound
  (`second >= first + floor`) to the sound grid bound
  (`second >= 2 × TICK_INTERVAL`, measured from priming): `deadline_2` is at
  least two full periods after the loop epoch under every rebase path, so
  this bound holds at any load and still fails the pre-fix loop (whose two
  polls both landed inside one period) and any real cadence collapse between
  the first two ticks.
- The first assertion (`first >= floor`) is unchanged — it is sound at any
  load (the loop waits at the top of the iteration) and is the decisive
  guard for the original first-poll regression.
- The test comment records WHY a gap-based bound is unsound, so a later
  cleanup cannot reintroduce it.
- No production code changes: the loop already implements the spec'd grid
  scheduling, and the failing run's behavior (first ~430 ms, second ~615 ms)
  is exactly the spec'd "next tick at the next grid deadline" semantics.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- None. `collector-time-fidelity`'s scheduling requirement is already correct
  and unchanged; this change aligns a regression guard with it.

## Impact

- `sys-monitor-tauri/src-tauri/src/collector/run_loop.rs` (test module only).
- Verification: the test module run repeatedly (including immediately after
  a full five-matrix lane, i.e. under the same load that exposed the flake),
  plus the full `npm run verify:fast` gate green end-to-end. Not run, not
  claimed: the packaged lane (test-only change).
