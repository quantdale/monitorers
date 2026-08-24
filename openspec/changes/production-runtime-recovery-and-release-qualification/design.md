## Context

The 2026-08-13 hardening campaign left the collector fail-stop on panic by design
(`run_collector_loop` catches, emits `collector-error`, breaks; `main.rs` wraps the
whole background-thread body in `catch_unwind`). All OS-facing state — PDH query +
counters, sysinfo `System/Disks/Networks`, optional NVML/NVAPI init, the
WMI MTA connection, and the sensor registry — lives in `CollectorState` plus
`WmiBootstrap`/`SensorRegistry`, constructed on the collector thread. The shared
`HistoryStore` sits behind a poison-safe Mutex and is independent of session
lifetime. Timestamps are monotonic-projected wall clock; history commits happen
only on every fourth tick. The frontend keeps a never-clearing
`collectorError: string | null` and shows a permanent red banner. CI builds
MSI/NSIS installers for tags/manual dispatch but never installs them; the packaged
simulation lane (`RealAppDriver`) launches the built exe with per-run isolation but
is opt-in with no qualification assertions.

Constraints preserved from prior campaigns: single collector thread owning OS
handles (no Mutex around `CollectorState`), WMI stays on its creating MTA thread,
PDH handles are opened once per session (rate counters need two samples to format
a delta), history writes only on full ticks, IPC payload structs derive
`Serialize` only, shipped configuration carries no remote-debugging flag, and all
CI actions stay pinned by SHA.

## Goals / Non-Goals

**Goals:**

- A supervised collector lifecycle (`starting → healthy → recovering → healthy`,
  escalating to `failed` after a bounded budget, with manual retry) that keeps at
  most one emitting session alive and shuts down cleanly from any state.
- Fresh reconstruction of OS-facing state on every recovery; the poisoned session's
  state is discarded, never resumed.
- Truthful data across restarts: shared history survives, downtime remains a gap,
  rate counters are re-baselined so the first post-recovery commit is a real ~250 ms
  delta rather than a fabricated 0% or an aggregated spike.
- A typed status contract the frontend can render deterministically, with its own
  schema version and fail-closed mismatch handling.
- Deterministic fault injection confined to test builds; an automated lint proves
  the shipped build has no fault trigger.
- Canonical, evidence-producing qualification of the real packaged executable and
  of MSI/NSIS install/run/uninstall on clean Windows machines.

**Non-Goals:**

- Persisting telemetry across process restarts; adding databases, auto-update,
  signing credentials, or new sensor categories.
- Changing cadence (250 ms live / 1 Hz full ticks), identity semantics, settings
  schema, or the simulation platform's assertion policy.
- Making installer qualification a required PR gate (cost/policy decision below).
- Retroactively editing archived OpenSpec changes or rewriting historical claims.

## Decisions

1. **Supervisor owns sessions; the loop stays sink-agnostic.**
   `collector/supervisor.rs` runs on one dedicated supervisor thread. A session =
   fresh `CollectorState` + fresh `WmiBootstrap` + fresh `SensorRegistry` built by
   an injected factory *on the session thread* (COM/WMI affinity respected),
   running the existing `run_collector_loop`. The supervisor `join()`s the previous
   session thread before spawning the next, making concurrent duplicate emitters
   structurally impossible. Session outcomes are `Stopped` or `Panicked(String)`;
   the existing per-tick `catch_unwind` converts a provider panic into a session
   end instead of a process-level failure. `main.rs` shrinks to wiring: manage a
   `SafeCollectorStatus` store, spawn the supervisor, serve the new command.

2. **Recovery is a pure policy, not ad-hoc sleeps.** `RecoveryPolicy { max_attempts,
   base_backoff, max_backoff, healthy_reset_after }` with pure functions
   (`backoff_for(attempt)`, `should_escalate(attempt)`, `streak_reset(elapsed_healthy)`).
   Backoff waits poll the stop/retry flags at 10–50 ms granularity (same pattern as
   `wait_until_deadline`), so shutdown during backoff is prompt and tests inject
   millisecond-scale policies instead of sleeping through seconds. Defaults:
   `max_attempts = 3` automatic attempts per streak, staged exponential backoff
   500 ms → 1 s → 2 s (capped 8 s), healthy streak ≥ 30 s resets the attempt
   counter. Manual retry from `Failed` clears the streak and starts exactly one
   session; retry requests received while not `Failed` are coalesced into a no-op
   (the UI disables the control outside `Failed`; the backend ignores them).

3. **Fresh OS state + explicit re-baselining.** Every session constructs new PDH
   handles, sysinfo instances, registry providers, NVML/NVAPI state, and a new WMI
   bootstrap (existing bounded retry). Before the first tick, the session primes
   rate baselines: one `PdhCollectQueryData` call (`prime_rate_baselines`) so the
   first formatted GPU/disk values are genuine deltas over the first interval, plus
   the existing pre-loop network refresh already in `run_collector_loop`. CPU usage
   is valid because `CollectorState::new()` performs two refreshes separated by
   `MINIMUM_CPU_UPDATE_INTERVAL`. Nothing fabricates continuity: no history pushes
   occur while no session runs, so recovery downtime shows up exactly as missing
   timestamps/gaps.

4. **Typed status contract with its own version.**
   `collector-status` event + `get_collector_status` command return
   `CollectorStatus { schema_version: LIFECYCLE_SCHEMA_VERSION(=1),
   state: starting|healthy|recovering|failed|stopping, generation, attempt,
   max_attempts, reason, timestamp_ms }` (serde snake_case; Serialize only).
   Status transitions are written under the short lock of a managed
   `SafeCollectorStatus` and emitted best-effort; a failed status emit is logged
   once and never kills supervision (mirrors existing emit-error handling). The
   legacy `collector-error` string event continues to fire for terminal messages;
   `MetricsSnapshot`/`HistoryPayload` keep `SCHEMA_VERSION = 5` unchanged because
   their shapes do not change.

5. **Frontend treats lifecycle as first-class state.** `useMetrics` listens to
   `collector-status`, validates `LIFECYCLE_SCHEMA_VERSION` fail-closed (mismatch →
   actionable error, payload ignored, listener stays attached — same discipline as
   metric payloads), and exposes `lifecycle` plus derived banner state.
   `collectorError` now clears when a `healthy` status arrives (the pinned
   "never auto-clears" behavior is updated: it still survives unrelated
   `metrics-update` events, which was the regression being pinned).
   `App.tsx` renders: recovering → `role="status"` amber banner "Metrics collection
   interrupted. Recovering…" keeping last metrics; failed → `role="alert"` red
   banner with reason and a `Retry metrics` button invoking `retry_collection`
   (browser mode: mock backend method); healthy → nothing. No zeros are injected;
   charts keep last-known values until new events arrive.

6. **Fault injection is test-build-only.** Synthetic panicking providers and
   tiny-backoff policies live exclusively in `#[cfg(test)]` modules (repo
   precedent: the existing `PanicProvider` test). No fault cargo feature, no env
   var, no debug command exists in non-test code. An automated CI lint asserts
   `[features]` contains only `{custom-protocol, nvml, nvapi}` and greps
   non-test Rust sources for env-based fault triggers
   (`SYSMON_(CRASH|FAULT|PANIC)`), mirroring the existing remote-debugging lint.

7. **Packaged qualification is a canonical lane, not a new framework.**
   `scripts/qualify-packaged.mjs` drives the existing `RealAppDriver` against the
   built exe and asserts, via CDP: `get_history` returns real IPC payloads,
   snapshots arrive (chart advances), the settings write lands in the run-isolated
   app-data dir (real settings.json untouched), a representative interaction
   works, and teardown leaves zero orphaned app/webview processes. Wired as
   `npm run verify:packaged` (verify.mjs mode `packaged`). CI runs it only on
   workflow_dispatch/tag in the release-qualification workflow — documented as an
   explicit cost policy, not hidden behind `continue-on-error`.

8. **Installer qualification runs on clean runners, one format each.** The
   release-qualification workflow builds both installers once, uploads them, then
   two independent Windows jobs (MSI job, NSIS job — no shared machine state):
   silent install (`msiexec /i … /qn /norestart`; NSIS `/S`), locate the installed
   exe via the uninstall registry key (DisplayName/InstallLocation — no hardcoded
   developer paths), verify DisplayVersion equals the package version, launch the
   installed exe under the driver's isolation env, smoke it through CDP where the
   harness permits, verify the process survived startup, uninstall silently, then
   assert the install directory/exe registration is gone and no orphan processes
   remain. Retained user data after uninstall is asserted as *documented product
   behavior*, not failure.

9. **Evidence artifacts are generated, hashed, uploaded.**
   `scripts/installer-manifest.mjs` emits `release-manifest.json` recording app
   version, commit SHA, build timestamp, per-installer filename/size/SHA-256/type,
   unsigned status, and qualification result; the workflow uploads installers +
   manifest. Installers remain unsigned (no certificate exists); workflows and docs
   say so plainly, and the pipeline leaves a natural slot (a later signed-step) for
   adding signing without redesign.

10. **Version consistency extends to built artifacts.** The existing
    `check-version.mjs` gate (package.json/Cargo.toml/tauri.conf.json) is preserved;
    installer qualification additionally compares the registry-reported installed
    version against the package version, catching metadata drift at the release
    boundary. Product version stays 0.1.4 — this campaign does not bump it.

## Risks / Trade-offs

- **Supervisor complexity vs. fail-stop simplicity:** mitigated by keeping the
  tick loop untouched; supervision lives entirely around session construction/
  joining, so the proven cadence path is unchanged.
- **Retry storms:** bounded budget + escalation + healthy-streak reset prevents
  infinite crash loops; backoff is shutdown-responsive.
- **First-tick value semantics after recovery:** priming adds one extra
  `PdhCollectQueryData` per session start (~once per recovery, microseconds-to-ms)
  — negligible, and it removes the fabricated-zero window.
- **CI cost of installer jobs:** contained in dispatch/tag-only workflow with
  explicit policy documentation.
- **Local dev machine safety:** installer install/uninstall steps run only in CI
  clean jobs; local lanes stop at build/hash/metadata inspection.

## Migration Plan

Additive: new module, new event/command, new scripts/workflow, doc updates. The
only behavior change to existing contracts is `collectorError` clearing on
`healthy` status (covered by updated/new Vitest cases) and the mock backend's
`collector-error` fault gaining lifecycle semantics (journey updated
intentionally). Rollback = revert commits; no persisted-format changes.

## Open Questions

None blocking. Two hardware/credential limitations carry forward explicitly:
physical dual-identical-GPU runtime mapping remains unvalidated without qualifying
hardware, and installers remain unsigned without a certificate.
