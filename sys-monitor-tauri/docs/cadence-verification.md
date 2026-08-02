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
   cargo build --bin cadence_probe
   ```
2. **Run the probe** (default 90s; `--secs` can be lowered to 30 for a smoke check)
   ```
   cargo run --bin cadence_probe -- --secs 90 > cadence.jsonl 2> cadence.err
   ```
   The probe streams one JSONL record per emitted snapshot to stdout and
   mirrors production's MTA/COM threading; WMI failure degrades to `wmi_con =
   None` (tolerated) rather than aborting.
3. **Run the checker**
   ```
   cargo run --bin cadence_probe -- --check cadence.jsonl
   ```
   or, to probe + check in one command:
   ```
   cargo run --bin cadence_probe -- --secs 90 --check -
   ```
4. **Read the verdict.** The checker prints `PASS` or `FAIL` plus a metrics
   table (total records, mean interval, on_tick count, final cpu_len, elapsed
   whole seconds) and exits nonzero on any failure.
5. **On PASS, attach the report as evidence** for the absorbed manual task
   (`fix-history-emission-rate` 8.7 / `add-realistic-usage-test-suite` 5.5),
   e.g. paste the checker's metrics table into the task.

## Invariants

- (A) Mean inter-emit interval is sane (liveness — multiple refreshes/sec).
- (B) `on_tick:true` count == `floor(total/4)` ± 1 (the 4:1 ratio).
- (C) History grows +1 per `on_tick:true`, +0 per `on_tick:false` (guards the
  COR-001 ungated-4Hz-history bug class).
- (D) Final history length consistent with the full-tick count (no drift).

The cadence is a fixed ratio, so a bounded 60–120s run establishes the
invariants for any longer window; a full-hour run is not required.

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
cargo run --bin cadence_probe -- --check app-cadence.jsonl
```

Mark this step as optional corroboration, not required for PASS.
