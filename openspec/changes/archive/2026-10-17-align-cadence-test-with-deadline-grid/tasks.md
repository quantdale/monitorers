## 1. Cadence regression guard

- [x] 1.1 In `src-tauri/src/collector/run_loop.rs`'s `test_first_poll_waits_for_initial_deadline_after_rate_priming`, replace the gap-based `second >= first + floor` assertion with the grid bound `second >= TICK_INTERVAL * 2` (measured from priming), and extend the comment to record why a gap-based bound is unsound (the deadline grid gives `deadline_k ≥ epoch + k·250 ms`, but the gap between actual emits can be arbitrarily small when an earlier tick was delayed by load — `collector-time-fidelity` explicitly disclaims period-after-prior-start scheduling).
- [x] 1.2 Leave the first-poll floor assertion unchanged; it is the decisive guard for the original regression and is sound at any load.

## 2. Validate

- [x] 2.1 From `sys-monitor-tauri/src-tauri/`, run `cargo fmt -- --check`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test` — all green.
- [x] 2.2 Run the cadence test in a loop at least 20 times (`cargo test test_first_poll_waits -- --repeat` or equivalent shell loop), including at least one batch immediately after a full five-matrix `cargo test` pass so the run happens under the load that exposed the flake. Record the pass count.
- [x] 2.3 Run `npm run verify:fast` from `sys-monitor-tauri/` end-to-end — exit 0 (the gate that was red).
- [x] 2.4 Run `openspec validate 2026-10-17-align-cadence-test-with-deadline-grid --type change --strict --no-interactive`.
- [x] 2.5 Write `evidence.md` with the original failure output, the soundness argument, and the repetition results. Do not claim a packaged-lane run.
