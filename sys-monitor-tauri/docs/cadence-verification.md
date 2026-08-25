# Cadence Verification Runbook

Verifies the runtime emission cadence of the real collector loop against real
hardware — the automated replacement for the manual stopwatch check that used
to gate `fix-history-emission-rate` task 8.7 / `add-realistic-usage-test-suite`
task 5.5.

## When to run

On a **sensor-equipped Windows host** (real PDH/WMI/NVML hardware). The probe
only proves anything when the real collector loop runs against real sensors;
on a bare VM or CI agent without the hardware counters the history channel
stays flat and the checker will (correctly) FAIL. This is a hardware test, not
a logic test.

## Procedure (AI agent)

All commands run from `sys-monitor-tauri/src-tauri/`.

1. **Build the probe**
   ```
   cargo build --example cadence_probe
   ```
2. **Run the probe** (default 90s; real `--secs` runs must be at least 60s)
   ```
   cargo run --example cadence_probe -- --secs 90 > cadence.jsonl 2> cadence.err
   ```
   The probe streams one JSONL record per emitted snapshot to stdout and
   mirrors production's MTA/COM threading. WMI enrichment retries in the
   background without delaying core metrics; a short `--ticks N` run is
   available only as an explicit diagnostic mode and is not a cadence PASS.
3. **Run the checker**
   ```
   cargo run --example cadence_probe -- --check cadence.jsonl
   ```
   or, to probe + check in one command:
   ```
   cargo run --example cadence_probe -- --secs 90 --check -
   ```
4. **Read the verdict.** The checker prints `PASS` or `FAIL` plus a metrics
   table containing event/full-tick p50/p95/max intervals, observation length,
   on_tick count, aligned history lengths, timestamp coverage, and elapsed
   whole seconds. It exits nonzero on any failure.
5. **On PASS, attach the report as evidence** for the absorbed manual task
   (`fix-history-emission-rate` 8.7 / `add-realistic-usage-test-suite` 5.5),
   e.g. paste the checker's metrics table into the task.

## Invariants

- (A) Event p50 is 200–350ms, p95 is at most 500ms, no event is below 150ms,
  and no event exceeds 1500ms; full-tick p50 is 800–1200ms, p95 is at most
  1800ms, and max is at most 2500ms.
- (B) `on_tick:true` count == `floor(total/4)` ± 1 (the 4:1 ratio).
- (C) History grows +1 per `on_tick:true`, +0 per `on_tick:false` (guards the
  COR-001 ungated-4Hz-history bug class).
- (D) CPU and timestamp histories remain aligned; GPU histories advance by the
  active GPU count only on full ticks.
- (E) The run observes at least 60,000ms and final history/timestamp span tracks
  real elapsed time. This rejects a slow loop with a superficially correct 4:1
  ratio.

A 60–90s run establishes the SLOs without requiring a full-hour run.

## Optional Layer-2 corroboration (full app)

The headless probe exercises the real collector loop but not the frontend
`shouldCommitHistory` gating. To corroborate at the assembled-app layer:

```
SYSMON_CADENCE_LOG=1 npm run tauri dev 2> app-cadence.err
# let it run ~90s, then Ctrl+C. The production emit sink streams one JSONL
# cadence record per emit to stderr; extract just those lines (each starts
# with {"elapsed_ms":):
Select-String -Path app-cadence.err -Pattern '^\{"elapsed_ms"' |
  ForEach-Object { $_.Line } > app-cadence.jsonl
# then check with the same checker:
cargo run --example cadence_probe -- --check app-cadence.jsonl
```

Mark this step as optional corroboration, not required for PASS.
