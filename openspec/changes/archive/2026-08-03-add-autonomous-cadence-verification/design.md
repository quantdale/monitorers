## Context

The remaining checkbox on two otherwise-complete changes is one manual test: run `npm run tauri dev`, watch that the "1 hour" window tracks real time 1:1 and that CPU/GPU numbers update multiple times per second. It was deferred as "not automatable" from a Linux sandbox with no Win32 sensors.

Two facts change the calculus:

1. **The signal is already machine-readable.** `fix-history-emission-rate` added `on_tick: bool` to every `metrics-update` snapshot (schema v3). That flag *is* the ground truth the manual test was eyeballing — "was this a history-committing tick." A checker reading the event stream needs nothing more to distinguish the 1 Hz history commits from the 4 Hz liveness emits.

2. **The cadence is a fixed ratio, so the check is scale-invariant.** The tick loop sleeps 250 ms and commits history on every 4th tick — forever, unconditionally. If the 4:1 ratio and the +1-history-per-full-tick relationship hold over 60–120 seconds, they hold over an hour by construction. The *only* thing a real hour additionally exercises is the `MAX_HISTORY = 3600` ring-buffer wrap — and that is already unit-tested (`add-realistic-usage-test-suite` 6.1/6.2). So a short real-hardware run plus the existing unit tests cover everything the manual hour was meant to catch.

The current tick loop (`main.rs:452–499`) is inlined inside the `setup()` closure and closes over `app_handle`, `collector_state`, `wmi_con`, `registry`. It resolves the history store via `app_handle.state::<SafeHistoryStore>()` and delivers snapshots via `app_handle.emit("metrics-update", …)`. Both couplings are what make it un-runnable outside a live Tauri app. Neither is essential to the collection logic.

```
BEFORE (coupled to AppHandle):                 AFTER (sink-agnostic):

setup(|app| {                                  fn run_collector_loop(
  loop {                                          state, wmi, registry,
    catch_unwind(|| {                             store: &SafeHistoryStore,
      poll / commit / build_snapshot            ticks: Option<u32>,
    })                                            emit:  impl FnMut(&MetricsSnapshot),
    match { Ok => app.emit("metrics-update")      on_err: impl FnMut(&str),
            Err => app.emit("collector-error")  )
                  break }                       ── production: emit = |s| app.emit("metrics-update", s)
    sleep(250ms)                                             on_err = |m| app.emit("collector-error", m)
  }                                             ── probe:      emit = |s| record_jsonl(s, &store)
})                                                            ticks = Some(n)
```

## Goals / Non-Goals

**Goals:**
- An AI agent (or self-hosted Windows CI) can verify the runtime 1 Hz/4 Hz cadence against real hardware and get PASS/FAIL, with no human watching a GUI.
- The extraction is strictly behavior-preserving for production — no cadence, I/O, panic-semantics, or emission changes.
- The probe exercises the *real* code path (default features, real PDH/WMI/NVML), not a mock, so it guards the actual COR-001 bug class.
- The two absorbed manual tasks (8.7 / 5.5) gain a documented automated fulfilling procedure.

**Non-Goals:**
- No browser/webview driver (`tauri-driver`/WebDriver). Asserting the literal rendered number or DOM chart point count is Layer 3, deferred to `add-e2e-verification-harness`.
- No change to `MetricsSnapshot` shape, `SCHEMA_VERSION`, the 250 ms poll cadence, or the 4-tick ratio.
- No auto-restart of the collector (ARC-002) — out of scope.
- Not re-testing the frontend `shouldCommitHistory` gating or the ring-buffer wrap here; those keep their existing unit coverage.

## Decisions

**Decision: extract the tick loop behind an emit sink + error sink, taking `&SafeHistoryStore` as a parameter — rather than making the probe a thin copy-paste of the loop, or driving verification through a real Tauri app only.**

| Option | Description | Verdict |
|---|---|---|
| (a) Copy the loop into the probe | Duplicate the tick-loop body in `cadence_probe.rs` | Rejected — the probe would drift from production; a cadence bug fixed in one copy could persist in the other, defeating the regression-guard purpose |
| (b) Verify only via a running Tauri app | Launch `tauri dev`, scrape stderr/logs | Rejected as the *primary* path — heavier to run unattended, couples the check to the webview/build, and still needs the same emit-tap; kept as an *optional* Layer-2 confirmation |
| (c) **Chosen**: one extracted, sink-parameterized loop | Production and probe call the same function; only the sinks and the tick bound differ | The probe exercises the exact production loop; a cadence regression fails the checker because it runs the real code, not a replica |

**Decision: the probe is a `src/bin/` binary; the checker is an `#[ignore]`-gated Rust integration test plus a standalone runnable entry.**

The probe must construct a real `CollectorState` (hardware detect + PDH open + WMI connect) — the same startup production does. A `bin` target builds with the crate's default features (`nvapi`, `nvml`), so it hits the real Nvidia paths. The checker lives as an `#[ignore]`d test so it never runs in the default `cargo test` (which may execute on a runner without sensors, and would otherwise burn 60–120 s), but can be invoked explicitly (`cargo test --ignored cadence`) on a sensor-equipped machine. A thin standalone entry (the bin can also self-check, or a tiny `checker` sub-mode) lets the agent run probe+check in one command and read a report. Rejected alternative: a non-ignored test that always runs the 90 s probe — it would make every CI run 90 s slower and fail on sensorless runners, violating the "no silent caps / don't break the default gate" posture.

**Decision: JSONL over stdout as the probe↔checker interface.**

One record per emitted snapshot: `{ "elapsed_ms", "on_tick", "cpu_len", "gpu_total_len", "ts_len" }`. Line-delimited JSON is trivially parseable by the checker, by the agent directly, and by a human reading the captured file. `elapsed_ms` is measured from loop start using a monotonic clock captured *inside* the probe (not `Utc::now`), so the checker measures true wall-clock spacing. The store lengths are read by the recording sink re-locking the store briefly *after* the loop released its lock (production emits post-unlock too), so the probe adds no lock contention to the hot path.

**Decision: tolerances — calibrated against real WMI/PDH polling overhead (first run, RTX 4050 host, 2026-08-02).**

The 250 ms sleep plus per-tick I/O means individual intervals jitter; asserting on the *mean* interval (not each interval) absorbs that. The full/registry gate is deterministic (`is_multiple_of(4)`), so the count of `on_tick:true` records SHALL be exactly `floor(total_records / 4)` (±1 for run-boundary alignment). After calibration on the first real run (mean interval 755 ms — per-poll WMI `build_gpu_vendor_map` overhead ~500 ms/tick):
- (A) Liveness sanity: mean inter-emit interval ∈ [150, 1000] ms (lower catches spinning, upper catches >1s refresh).
- (B) Unchanged: `on_tick:true` count == `floor(total/4)` ± 1.
- (C) Unchanged: history grows +1 per full tick, +0 otherwise (the COR-001 regression guard).
- (D) Speed-relative: `final_cpu_len == on_tick_count` (history length equals the full-tick count — valid at any tick speed; replaces the absolute drift ≤ ±2 which assumed 250ms ticks). Elapsed whole seconds is still printed in the metrics table for reference.

**Decision: optional dev tap is env-gated (`SYSMON_CADENCE_LOG=1`), off by default.**

The Layer-2 confirmation (run the *full* app and check the same cadence) needs a tap in the production emit sink. Gating it behind an env var keeps the hot path untouched in normal runs (one branch on an env read at emit time is negligible, but even that is skippable by reading the var once at startup). Off by default means no stderr noise and no behavior change for users.

## Risks / Trade-offs

- **[Risk] WMI/COM apartment in a standalone binary.** Production connects WMI on a spawned MTA thread (winit leaves the main thread STA). A `bin` main thread's COM apartment is undefined for our purposes. → **Mitigation:** the probe spawns a background thread and runs `CollectorState::new()` + the loop there, mirroring production's threading exactly; if WMI still fails to connect, the probe proceeds with `wmi_con = None` (the collector already tolerates this — see `add-realistic-usage-test-suite` 5.7) and the checker's cadence assertions still hold, since cadence is independent of thermal availability.
- **[Risk] The extraction accidentally changes production behavior.** → **Mitigation:** keep the refactor mechanical (move body, thread two closures + a `store` param + an `Option<u32>` tick bound); add a unit test that the production-shaped call with an unbounded/`None` tick count and a counting sink produces the same emit-per-tick pattern; run the full existing Rust suite (must stay ≥88) plus `fmt`/`clippy` clean.
- **[Risk] Sensorless CI misreads the `#[ignore]`d checker as "covered."** → **Mitigation:** document explicitly (runbook + tasks) that the cadence checker only proves anything when run on a sensor-equipped Windows host; CI keeps its existing unit gates and the ignored test is opt-in.
- **[Risk] Probe run length vs. agent patience.** A 90 s probe is a long single tool call. → **Mitigation:** make duration a CLI arg (default 90 s), allow as low as ~30 s for a quick smoke check (still ≥120 full-tick samples), and run it as a backgroundable command so the agent isn't blocked.
- **[Trade-off] This proves emission cadence, not rendered output.** Accepted — the frontend gating and ring-buffer wrap are already unit-covered, and true rendered-output verification is the explicitly phased `add-e2e-verification-harness`.

## Migration Plan

Pure addition plus a behavior-preserving refactor; no schema, dependency, or persisted-state change. Rollback is a plain revert. The two manual tasks are updated to point at the new procedure but are not deleted, so history/traceability is preserved.

## Open Questions

- Should the checker also be wired into a self-hosted Windows CI job (a fourth, sensor-equipped job) now, or left as an agent-run/local procedure until a self-hosted runner exists? (Recommendation: land the probe+checker + runbook first; add the CI job only once a self-hosted Windows runner with a GPU is actually available, to avoid a job that can only ever be skipped.)
- Exact home for the extracted loop: a `pub fn` in `main.rs` reachable from the bin via a `lib` target, or a new `collector::run_loop` module. (Recommendation: a small `collector`-level module so both `main` and the bin depend on it without `main.rs` needing to become a library facade — resolve during implementation against the crate's current bin/lib shape.)
