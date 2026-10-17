## 1. Time injection

- [x] 1.1 In `src-tauri/src/sensor.rs`, add a `now: std::time::Instant` parameter to `SensorRegistry::poll_all` (one sample per call, exactly where the internal `Instant::now()` was sampled). Update the doc comment: the caller owns the time sample so the tick loop and the gate share one sample per tick.
- [x] 1.2 Update the single production call site (`src-tauri/src/collector/run_loop.rs`) to pass `Instant::now()` — identical sampling point, no behavior change.
- [x] 1.3 Rewrite `test_interval_gated_provider_polls_on_time_not_every_call` to drive synthetic instants (`t0`, `t0+250ms` … `t0+1000ms`) and keep the exact five-element pin `[true, false, false, false, true]`. Extend the comment to record why the sleep-accumulation version was unsound (`sleep` overshoot under load made the gate fire early — correctly — and the test failed against correct behavior; observed `[true, false, false, true, false]`).

## 2. Validate

- [x] 2.1 From `sys-monitor-tauri/src-tauri/`, run `cargo fmt -- --check`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test` — all green.
- [x] 2.2 Run the sensor interval test in a loop at least 20 times — 20/20 (it must now be deterministic; no sleeps remain).
- [x] 2.3 Run `npm run verify:fast` from `sys-monitor-tauri/` end-to-end — exit 0 (shared with the cadence-test and worker-bound changes; one green run serves all three).
- [x] 2.4 Run `openspec validate 2026-10-17-make-sensor-interval-gate-time-injectable --type change --strict --no-interactive`.
- [x] 2.5 Write `evidence.md` with the original failure output, the soundness argument, and the repetition results. Do not claim a packaged-lane run.
