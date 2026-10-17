## Why

`verify:fast` failed a third time today on a healthy tree, this time with

```
sensor::tests::test_interval_gated_provider_polls_on_time_not_every_call
assertion `left == right` failed
  left: [true, false, false, true, false]
 right: [true, false, false, false, true]
```

The interval gate behaved **correctly**: `poll_all` fires a provider when
`now − last_polled ≥ interval`, and under host load the test's four
`sleep(250ms)` calls overshot (`sleep` guarantees a lower bound only), so
1000 ms had genuinely elapsed by call 4 — `[true, false, false, true, false]`
is a valid gating trace for those elapsed times. The test pins a
sleep-accumulation timing pattern that `std::thread::sleep` never promised,
and the pattern it asserts is exactly the one this session already found
unsound in `run_loop`'s cadence test (gap-based timing measured through real
scheduling).

The root enabler is that `SensorRegistry::poll_all` samples `Instant::now()`
internally: there is no way to unit-test the gating arithmetic without real
time passing. The repo's established answer to exactly this (the tick loop's
cadence was extracted "so the 1Hz history-commit cadence is unit-testable in
isolation from the I/O it gates") is to inject the time sample.

## What Changes

- `SensorRegistry::poll_all` gains a `now: std::time::Instant` parameter —
  ONE time sample per call, exactly as the internal `Instant::now()` was
  sampled once per call, so behavior is unchanged. `run_collector_loop`
  passes `Instant::now()` at the call site (same sampling point); no other
  production caller exists.
- The interval-gate unit test drives synthetic instants (`t0`, `t0+250ms`,
  …, `t0+1000ms`) and keeps its exact five-element expectation — the pin it
  always meant to be, now deterministic at any load and provably immune to
  scheduling jitter. The test comment records why the sleep-based version
  was unsound.
- No scheduling, cadence, history, or IPC behavior changes.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- None. `collector-time-fidelity` and the provider-cadence contracts are
  unchanged; this makes the existing gate arithmetic testable.

## Impact

- `sys-monitor-tauri/src-tauri/src/sensor.rs` (signature + test),
  `src-tauri/src/collector/run_loop.rs` (one call site).
- Verification: `cargo fmt -- --check`, `cargo clippy --all-targets
  --all-features -- -D warnings`, the five-matrix `cargo test` lane inside a
  green `npm run verify:fast`, plus a repetition batch for the sensor test.
  Not run, not claimed: the packaged lane (testability refactor).
