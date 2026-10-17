# Evidence — align the cadence regression guard with the deadline grid

Date: 2026-10-17. Machine: Windows (dev host). Commands from
`sys-monitor-tauri/` unless noted.

## The failure (from the red `verify:fast` run)

```
collector::run_loop::tests::test_first_poll_waits_for_initial_deadline_after_rate_priming
panicked at src\collector\run_loop.rs:562:9:
second poll fired 614.7809ms after priming — cadence collapsed
test result: FAILED. 188 passed; 1 failed   (the --no-default-features matrix)
```

The cadence did not collapse. Inferred timeline from the bound arithmetic:
the first emit landed ~430 ms after priming (scheduling load), and the second
at 614.78 ms — a healthy grid tick (`deadline_2 = epoch + 500 ms` plus body
time). The old assertion `second >= first + floor` (617.5 ms for a 430 ms
first) measures spacing from the ACTUAL first emit and therefore double-counts
tick 0's lateness.

## Soundness argument

- The loop schedules on a fixed grid: `deadline_k ≥ epoch + k·250 ms`
  (`rebase_deadline` only ever moves a deadline right), and each emit is at
  or after its deadline (the wait is at the top of the iteration).
- Therefore `second ≥ 2 × TICK_INTERVAL` from priming is a strict lower bound
  at any load (`started` precedes the loop epoch).
- A gap-based bound is UNSOUND in the other direction too: when tick 0 is
  late but lands before its successor's grid point, the second emit
  legitimately closes up behind it (gap → 0 as first → 500 ms).
- `collector-time-fidelity` explicitly disclaims the semantics the old
  assertion encoded: "Work time SHALL NOT be added to the period… the next
  scheduled tick is due at the next 250 ms deadline from the monotonic
  schedule, not 330 ms after the prior start."

## Fix

`second >= TICK_INTERVAL * 2` with a comment recording why the gap-based form
was unsound; the first-poll floor assertion is unchanged (decisive original
regression guard, sound at any load).

## Validation

- `cargo fmt -- --check` clean; `cargo clippy --all-targets --all-features
  -- -D warnings` clean; `cargo test` 208 passed (lib) + 5 (main).
- Repetition batch 1 (after the first partial matrix run): **20/20 pass**.
- Repetition batch 2 (immediately after a full five-matrix `verify:fast`
  pass — the load class that exposed the flake): **20/20 pass**.
- Shared `npm run verify:fast` end-to-end: **exit 0** (frontend lane +
  five-matrix Rust lane + clippy + cargo audit) — also the green run for the
  sensor-gate and worker-bound changes of this session.

Not run, not claimed: the packaged lane (test-assertion change).
