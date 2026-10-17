# Evidence — make the sensor interval gate's time injectable

Date: 2026-10-17. Machine: Windows (dev host). Commands from
`sys-monitor-tauri/` unless noted.

## The failure (from the red `verify:fast` run)

```
sensor::tests::test_interval_gated_provider_polls_on_time_not_every_call
assertion `left == right` failed
  left: [true, false, false, true, false]
 right: [true, false, false, false, true]
test result: FAILED. 207 passed; 1 failed   (the default-features matrix)
```

The gate behaved CORRECTLY. `poll_all` fires when `now − last_polled ≥
interval`; the test drove it with four real `sleep(250ms)` calls, and `sleep`
guarantees only a lower bound — under host load the sleeps overshot, 1000 ms
had genuinely elapsed by call 4, and `[true, false, false, true, false]` is a
valid gating trace for those elapsed times. The test failed against behavior
that was right, pinning a sleep-accumulation timing pattern `sleep()` never
promised — the same defect class as the run_loop cadence guard fixed alongside
this change.

## Fix

- `SensorRegistry::poll_all` now takes `now: std::time::Instant` — one
  caller-supplied time sample per pass, exactly where the internal
  `Instant::now()` was sampled (behavior unchanged).
- `run_collector_loop` passes `Instant::now()` at the same sampling point
  (the only production call site; verified by grep — `poll_all` had exactly
  two callers: the loop and this test).
- The test drives synthetic instants (`t0 + k·250 ms`, k = 0…4) and keeps its
  exact five-element pin `[true, false, false, false, true]` — now pure
  arithmetic, deterministic at any load, zero sleeps. The comment records why
  the sleep-based version was unsound.

## Validation

- `cargo fmt -- --check` clean (one `cargo fmt` pass applied to the new test
  call's wrapping); `cargo clippy --all-targets --all-features -- -D
  warnings` clean.
- `cargo test` 208 passed (lib) + 5 (main) — twice (before and after the
  shared full-gate run).
- Determinism batch: **20/20 pass** running the sensor test in a loop (it
  contains no sleeps and no wall-clock assertions — this batch is a
  regression canary, not a race hunt).
- Shared `npm run verify:fast` end-to-end: **exit 0** — the same run is the
  green evidence for the cadence-guard and worker-bound changes.

Not run, not claimed: the packaged lane (testability refactor, internal
signature only — no IPC or payload surface is touched).
