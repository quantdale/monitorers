## 1. Baseline & guardrails

- [ ] 1.1 Confirm current baselines before touching anything: from `sys-monitor-tauri/src-tauri/` run `cargo test` (expect 88), `cargo fmt -- --check` (clean), `cargo clippy --all-targets -- -D warnings` (clean); from `sys-monitor-tauri/` run `npm test -- --run` (expect ≥83). Record the exact counts in this task before proceeding, so the extraction can be proven behavior-preserving.
- [ ] 1.2 Read `main.rs:452–499` (the tick loop), `state.rs` (`CollectorState`, `SafeHistoryStore`, `HistoryStore`), and `collector/mod.rs` (`poll`, `commit_*`, `push_history`) together and note every value the loop closes over (`app_handle`, `collector_state`, `wmi_con`, `registry`) and every `app_handle` use inside it (`.state::<SafeHistoryStore>()`, `.emit("metrics-update")`, `.emit("collector-error")`). This inventory is the extraction contract.

## 2. Rust: extract the tick loop behind sinks (behavior-preserving)

- [ ] 2.1 Introduce `run_collector_loop(state: &mut CollectorState, wmi_con: Option<&WMIConnection>, registry: &mut SensorRegistry, store: &SafeHistoryStore, ticks: Option<u32>, mut emit: impl FnMut(&MetricsSnapshot), mut on_error: impl FnMut(&str))` — a small `collector`-level module (e.g. `collector/run_loop.rs`, re-exported from `collector/mod.rs`) reachable from both `main.rs` and a future `bin`. Move the existing loop body verbatim: same `catch_unwind`, same `is_full_poll_tick`/`poll`/`commit_*`/`push_timestamp`/`registry.commit_all`/`build_snapshot` sequence, same 250ms sleep, same panic → emit-once-then-break. Replace `app_handle.state::<SafeHistoryStore>()` with the passed `store`; replace the two `app_handle.emit(...)` calls with `emit(&snapshot)` / `on_error(msg)`. When `ticks` is `Some(n)`, return after `n` iterations (or after a panic-break); `None` loops forever as today.
- [ ] 2.2 Rewrite `main.rs`'s `setup()` to call `run_collector_loop(..., None, |snap| { app_handle.emit("metrics-update", snap).ok(); }, |msg| { app_handle.emit("collector-error", msg).ok(); })`. The store handle passed in is the same `app_handle.state::<SafeHistoryStore>()` resolved once before the loop. Confirm the `hardware-profile-ready` emit and all pre-loop startup (WMI retry, profile detect, `registry.register`) stay exactly where they are — only the loop moves.
- [ ] 2.3 Add a unit test (in the new module) that drives `run_collector_loop` with `ticks: Some(8)`, a real-or-stub `CollectorState` following the precedent in `collector/nvidia.rs`/`5.7`, a fresh `SafeHistoryStore`, a counting emit sink, and a recording error sink; assert exactly 8 emits, zero errors, and that `on_tick` was true on exactly ticks 0/4 (2 of 8) — pinning that the extraction preserved the 4:1 cadence gate.
- [ ] 2.4 Run `cargo test`, `cargo fmt -- --check`, `cargo clippy --all-targets -- -D warnings`. Test count must be ≥ 89 (baseline + ≥1 new). Fix any `clippy::items_after_test_module` by placing the test module after the code it tests (repo convention — see `collector/gpu.rs`). No behavior change to production is permitted; if any existing test's expectation shifts, stop and investigate — the extraction was supposed to be inert.

## 3. Rust: headless cadence probe binary

- [ ] 3.1 Add `src-tauri/src/bin/cadence_probe.rs`. Parse a `--secs <N>` arg (default 90, min 30) and an optional `--ticks <N>`; `secs` maps to `ticks = secs * 4`. Build with default features so `nvapi`/`nvml` are active.
- [ ] 3.2 In the probe, spawn a background thread (mirroring production's MTA/COM threading) that: constructs `CollectorState::new(...)`, detects the hardware profile, connects WMI with the same tolerance production uses (fall back to `wmi_con = None` on failure — do not abort), registers the same sensor providers, creates a fresh `SafeHistoryStore`, then calls `run_collector_loop` with `ticks: Some(...)` and a recording emit sink. Capture a monotonic start instant *before* the loop; the sink computes `elapsed_ms` from it.
- [ ] 3.3 The recording sink writes one JSONL line per snapshot to stdout: `{"elapsed_ms":<u64>,"on_tick":<bool>,"cpu_len":<usize>,"gpu_total_len":<usize>,"ts_len":<usize>}`. Read the lengths by briefly locking `store` inside the sink (the loop has already released its lock at emit time). Flush stdout per line so a killed/backgrounded run still yields a usable partial log.
- [ ] 3.4 Manually smoke the probe on the real Windows machine: `cargo run --bin cadence_probe -- --secs 30 > "$SCRATCH/cadence.jsonl"`; confirm ~120 lines, `on_tick:true` on roughly every 4th, and `cpu_len` incrementing only on `on_tick:true` lines.

## 4. Rust: cadence checker

- [ ] 4.1 Add a checker that reads JSONL (from a path arg or stdin) and computes: total records; mean inter-record `elapsed_ms` delta; count and cadence of `on_tick:true`; per-record history-length delta partitioned by `on_tick`; final `cpu_len` vs. elapsed whole seconds. Expose it both as an `#[ignore]`-gated integration test (`cargo test --ignored cadence_real_hardware`) that shells the probe for ~90s then asserts, and as a plain function the probe bin can call in a `--check <file>` sub-mode so the agent runs probe+check in one command.
- [ ] 4.2 Assertions (tolerances from design.md, printed on both PASS and FAIL): (A) mean interval ∈ [210, 290] ms; (B) `on_tick:true` count == `floor(total/4)` ± 1; (C) history grows +1 on every `on_tick:true` and +0 on every `on_tick:false`; (D) `|final cpu_len − elapsed_whole_seconds| ≤ 2`. Emit a one-line `PASS`/`FAIL` verdict plus a metrics table; exit nonzero on any failure.
- [ ] 4.3 Negative test (fast, no hardware): feed the checker a synthetic JSONL fixture that violates each invariant (4 Hz history growth; missing full ticks; drift > 2) and assert the checker returns FAIL with the correct reason for each. This runs in the default `cargo test` (it's pure parsing/asserting, no sensors) and guards the checker itself.
- [ ] 4.4 Run the real end-to-end on Windows: `cargo test --ignored cadence_real_hardware` (or `cargo run --bin cadence_probe -- --secs 90 --check -`) and confirm PASS. Save the report to the change as evidence.

## 5. Optional Layer-2 dev tap (full-app confirmation)

- [ ] 5.1 In `main.rs`'s production emit sink, read `SYSMON_CADENCE_LOG` once at startup; when set, have the sink also `eprintln!` the same JSONL record per emit. Zero cost and zero output when unset. Keep it minimal — reuse the same serialization as the probe if practical.
- [ ] 5.2 Document (in the runbook, task 6) the full-app confirmation: `SYSMON_CADENCE_LOG=1 npm run tauri dev` for ~90s with stderr captured, then run the checker against the captured lines — confirming the assembled app (real webview + real `shouldCommitHistory` gating) agrees with the headless probe. Mark this as optional corroboration, not required for PASS.

## 6. Agent runbook & superseding the manual gate

- [ ] 6.1 Write a short runbook (`sys-monitor-tauri/docs/cadence-verification.md` or a section the change links) with the exact commands an AI agent runs: build, run probe (`--secs 90`), run checker, read the PASS/FAIL verdict, and — on PASS — attach the report as evidence. Include the sensor-equipped-host caveat and the optional Layer-2 step.
- [ ] 6.2 Update `openspec/changes/fix-history-emission-rate/tasks.md` task 8.7: note it is now fulfilled by this change's automated procedure (probe + checker PASS), with the manual stopwatch run downgraded to optional corroboration. Do not delete the task; add a pointer.
- [ ] 6.3 Update `openspec/changes/add-realistic-usage-test-suite/tasks.md` task 5.5 the same way, cross-referencing this change and 8.7.

## 7. Verify

- [ ] 7.1 Rust: `cargo test` (≥ 89, including the extraction unit test and the checker negative test; the real-hardware test stays `#[ignore]`d), `cargo fmt -- --check` clean, `cargo clippy --all-targets -- -D warnings` clean, `cargo audit` (no new advisories vs. baseline).
- [ ] 7.2 Frontend: unchanged by this change — confirm `npm test -- --run` and `npx tsc --noEmit` still pass at baseline (this change touches no `src/` frontend code; if it does, that's a scope error).
- [ ] 7.3 Real-hardware acceptance: run the probe+checker on the Windows dev machine and confirm PASS; paste the checker's metrics table into task 4.4 / 6.1 as the durable evidence that closes 8.7 / 5.5.
- [ ] 7.4 `openspec validate add-autonomous-cadence-verification --strict` passes.
