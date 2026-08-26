# Tasks

## 1. Collector supervisor (Rust)

- [x] 1.1 `collector/supervisor.rs`: `CollectorLifecycleState`, `CollectorStatus` (`LIFECYCLE_SCHEMA_VERSION = 1`), `RecoveryPolicy` (production defaults + pure `backoff_for/should_escalate/streak_expired`), session outcomes via `LoopOutcome`, supervised loop that reaps each session before starting the next.
- [x] 1.2 Rate-baseline priming for fresh sessions (`prime_rate_baselines` in `collector/mod.rs`, invoked at loop start; first deadline offset one tick so every committed value is a genuine ~250ms delta).
- [x] 1.3 `SafeCollectorStatus` store + `get_collector_status` command; legacy `collector-error` emission preserved per panic.
- [x] 1.4 Supervisor wired into `main.rs` (`TauriSessionRunner`): status emits, `retry_collection` command (Failed-only, coalesced otherwise), shutdown flag honored from all states, per-session hardware-profile bootstrap inside the session body.
- [x] 1.5 Public exports from `lib.rs`; payload derives remain `Serialize`-only.

## 2. Supervisor tests (deterministic, no wall-clock backoff)

- [x] 2.1 Policy unit tests: staged backoff values/cap, escalation boundary, streak-reset threshold.
- [x] 2.2 Scripted-runner supervision tests: starting→healthy; stop reports Stopping without replacement; single panic → one replacement; structural no-overlap assertion (join-before-respawn); failed carries reason + exhausted count; manual retry leaves Failed and starts exactly one session; stale retry clicks discarded at session start; shutdown during Failed wait starts nothing; shutdown during recovery backoff starts nothing; long healthy period resets streak; status serialization (snake_case fields); responsive-wait semantics. Run-loop tests pin `LoopOutcome::Completed|Stopped|Panicked(payload)`.

## 3. Frontend lifecycle UX

- [x] 3.1 `types/metrics.ts`: `CollectorLifecycleState` + `CollectorStatus` mirrors.
- [x] 3.2 `useMetrics.ts`: `collector-status` listener with `EXPECTED_LIFECYCLE_SCHEMA_VERSION` fail-closed validation, separate lifecycle-mismatch error channel, `lifecycle` exposed, `collectorError` cleared only by a healthy status, browser-mode `retryCollection` branch.
- [x] 3.3 `App.tsx`: recovering banner (`role="status"`, polite) keeps last metrics; failed banner (`role="alert"` + Retry metrics button, disabled while pending); automatic clearing; no zero substitution.
- [x] 3.4 Vitest: transitions healthy→recovering→healthy / →failed, manual retry invocation counting, transient clearing only on recovery proof, retention without zeros, generation-change non-duplication, lifecycle schema mismatch fail-closed + recovery, legacy never-clears-on-metrics-events behavior retained.
- [x] 3.5 Mock backend: `simulateCrashRecovery`/`simulateCrashExhaustion`, `retryCollection()` (returns observed state, mirrors command contract), status listeners, `getStatus`.

## 4. Simulation journeys

- [x] 4.1 `collector-recovery` journey (9 assertions): interruption → recovering UI with retained values → automatic clearing → values resume → post-recovery window-settings interaction persists.
- [x] 4.2 `fault-retry-exhaustion` journey: immediate recovering report → persistent failed alert naming the failure → accessible Retry control → no auto-restart while failed → single click restores live collection.
- [x] 4.3 Legacy `fault-response` replaced by the exhaustion/recovery journeys; zero-assertion/pageerror/console-error policies untouched.
- [x] 4.4 (en route) Fixed pre-existing `layout-persistence` hang: `MetricCard` list branch had lost its `metric-card-*` testid in d24d6a1; restored. Artifact writer retries transient Windows rename locks; matrix timeout raised to a documented 900s for the grown selection.

## 5. Packaged-app qualification

- [x] 5.1 `e2e/sim/qualify.spec.ts`: launches built exe via `RealAppDriver`, asserts real IPC `get_history` (schema 5), advancing real collector data, representative interaction landing in run-isolated settings.json, clean teardown, orphan-process assertion, developer-store isolation self-test.
- [x] 5.2 `npm run verify:packaged`; verify.mjs `packaged` mode (Windows-only guard, build + qualify).

## 6. Installer qualification + release integrity

- [x] 6.1 `scripts/installer-manifest.mjs`: version, commit SHA, timestamp, filenames/sizes/SHA-256/type, truthful unsigned status, qualification result.
- [x] 6.2 `.github/workflows/release-qualification.yml` (dispatch/tag): shared installer build → independent MSI/NSIS Windows jobs (silent install, registry location/version verification, installed-exe smoke via `verify:packaged`, silent uninstall, removal/orphan assertions; NSIS user-data retention asserted as documented product behavior) → manifest job gated on both results.
- [x] 6.3 Shipped-config lint extended (`simulation.yml`): `[features]` allow-list + env-var/fault-seam grep over backend sources.

## 7. Documentation

- [x] 7.1 AGENTS.md / CLAUDE.md / .cursorrules: supervisor lifecycle, policy constants, status contract versions, retry semantics, gap/re-baseline rules, packaged/installer commands, artifact locations; fail-stop claims removed everywhere.
- [x] 7.2 CONTEXT.md glossary terms (session/supervision/lifecycle/generation/Retry metrics); README commands + notes; workflow comments.
- [x] 7.3 progress.md rewritten as a truthful campaign snapshot; dual-GPU hardware limitation carried forward explicitly; AUDIT_REPORT annotated (ARC-002 resolved); main-spec contradiction handled via MODIFIED delta on `realistic-usage-testing` (syncs at archive time).

## 8. Verification gates

- [x] 8.1 `npm run verify:fast` green end-to-end (audits 0 vulns; tsc; vitest 216/216; build; fmt; cargo test ×5 feature lanes — 194/194/175/188/186 lib tests plus probe/main suites; clippy `-D warnings`; cargo audit exit 0). A load-sensitive supervisor-test race was caught by repeated runs and fixed (see §2 note).
- [x] 8.2 `npm run verify:e2e` 12/12; `npm run verify:sim` matrix 16/16 journey runs (~5.4 min) incl. both new recovery journeys; `npm run sim:typecheck` clean.
- [x] 8.3 `npm run verify:version`; `openspec validate --all --strict --no-interactive` (16 passed, 0 failed); `git diff --check` clean.
- [x] 8.4 `npm run verify:tauri` exit 0; local `npx tauri build` produced both installers (`System Monitor_0.1.4_x64_en-US.msi`, `System Monitor_0.1.4_x64-setup.exe`) and the manifest script generated a clean current-version manifest locally (no machine-mutating steps locally).
- [x] 8.5 `npm run verify:packaged` PASS against the built exe: real IPC `get_history` (schema 5), advancing collector data, viewMode write landed in per-run isolated settings store, representative interaction, clean exit, no orphan app/webview processes, developer settings untouched.

## 9. Hosted CI

- [x] 9.1 Push branch; open PR.
- [x] 9.2 Watch hosted runs; fix failures; capture run IDs/job outcomes/artifacts as evidence below.
- [x] 9.3 Dispatch release-qualification workflow when permissions permit; attach MSI/NSIS qualification evidence.

## 10. Safety closure (2026-08-26 — reopened by fresh audit + PR review threads)

A planner audit and the hosted review bots found live defects at head `31f190c` despite
sections 1–9 being checked; the checks below track their actual closure.
Historical green runs above remain valid evidence FOR THE HEADS THEY RAN AGAINST only.

- [x] 10.1 CRITICAL: retry/stop managed-state collision. Two raw `Arc<AtomicBool>` values were
      passed to `app.manage()`; Tauri keys state by type, so the second registration was refused
      silently and BOTH `retry_collection` and the exit path resolved the STOP flag — a Retry
      click from Failed could stop collection permanently. Fixed with distinct newtype managed
      state (`StopFlag`, `RetryRequest`) plus a loud-failing `register_lifecycle_flags` seam;
      regression tests exercise the real MockRuntime command/state seam (distinct resolution,
      registration-order independence, honored-vs-coalesced contract, and the full Failed → Retry
      → exactly one replacement generation → first data → Healthy path with stop-flag-stays-false
      and no Stopping transition).
- [x] 10.2 P1: frontend mount/reload now bootstraps the CURRENT managed status via
      `get_collector_status` (dispatched after the status listener attaches), fenced against
      stale-fetch-overwrites-newer-event races via an applied-status sequence counter; malformed
      bootstrapped lifecycle payloads fail closed/visibly; cleanup covers unmount-during-bootstrap;
      remount re-bootstraps. Nine hook-level regression cases added (healthy/failed/recovering
      before mount, event during bootstrap, stale fetch, schema mismatch + later valid recovery,
      unmount during bootstrap, remount after failure, rejected fetch degradation).
- [x] 10.3 P2: `run_collector_loop` now waits until the initial tick deadline BEFORE the first
      poll/commit (fresh/recovered sessions produced near-zero-delta first readings); regression
      test fails on pre-fix code (~60–70 ms to first emit) and passes post-fix (≥ 3/4 tick);
      shutdown responsiveness, rebasing, cadence and telemetry preserved.
- [x] 10.4 P2: mock backend parity — `healthy` is emitted only AFTER a generation's first
      successful snapshot (timer-scheduled != healthy), for initial start, automatic recovery and
      manual retry alike; a dead/non-emitting replacement can never reach healthy; mid-tick fault
      injection no longer emits a frame through the dead session.
- [x] 10.5 HIGH: mock singleton teardown — `stop()` cancels the active interval AND all staged
      crash/recovery timers, and bumps a run token that invalidates any stale callback
      (defense-in-depth); covered by tests for stop during recovery, stop during exhaustion
      staging, remount after stop, stale-timeout-after-remount generation ownership.
- [x] 10.6 P1: release workflow `download-artifact` steps use the supported `name:` input
      (unsupported `artifact-name:` ignored by the action and only worked by accident of layout).
- [x] 10.7 SECURITY/HIGH: RealAppDriver HKLM WebView2 debug-policy removal is now unconditional —
      close() aggregates process-close/work-dir/policy-removal failures instead of letting an
      earlier failure skip the security cleanup; policy write result is logged (access-denied vs
      applied diagnosable); injected `HklmPolicyOps` seam enables hive-free unit coverage of write
      success/access-denied/spawn-failure-after-policy/process-close failure/work-dir deletion
      failure/normal success. Journey runner surfaces aggregated close failures as run failures.
- [x] 10.8 DOC: `retryMetrics` contract comment reversed honored/coalesced semantics — corrected;
      UX/tests audited for inherited assumptions (none found; App.tsx ignores the return value).
- [x] 10.9 Recovery journeys strengthened with in-page lifecycle probes proving healthy follows
      actual replacement emission on both the automatic and manual-retry paths.
- [x] 10.10 Hygiene: tracked raw CI diagnostic dumps removed from the repository root after
      durable findings were recorded in evidence.md; untracked `msi-rc5.log` deleted.
- [ ] 10.11 Full local canonical validation green at the fix head (all gates, not a subset).
- [ ] 10.12 Hosted PR CI green at the final head; full release qualification (MSI + NSIS +
      manifest) dispatched and green at the final SHA; final run IDs/hashes recorded in evidence.md.
- [ ] 10.13 PR #28 review threads re-verified at final head and closed against real code/evidence;
      change archived/synced only after all gates pass.

## Evidence

Local (2026-08-25, this machine):
- `verify:fast`: all five Rust test lanes pass (194 default / 194 all-features / 175 no-default / 188 nvml-only / 186 nvapi-only lib tests + probe + main suites); clippy `-D warnings` exit 0; cargo audit exit 0 (21 allowed advisories); frontend audits/typecheck/tests/build green.
- `verify:e2e`: 12 passed. `verify:sim`: matrix green, 16 journey runs in ~5.4 min. `verify:packaged`: PASS (see 8.5). `verify:tauri`: exit 0. Installers built locally and hashed via manifest script (2 artifacts, version-filtered).

Hosted CI:
- PR **#28** open (`agent/monitorers-comprehensive-remediation` → `main`).
- All PR lanes green at head `aa36e2f`: E2E Verification Harness ✓ (run 32867729073), Simulation ✓ incl. shipped-config lint (run 32867729164), Rust and release ✓ (run 32867729506).
- Release qualification (tag `v0.1.4-rc1` lane, the designed trigger while the file is not yet on the default branch): **run 32867950233 success** at `aa36e2f` — Build installers ✓, Qualify MSI ✓ (silent install, real-IPC smoke over CDP against the installed binary, clean removal), Qualify NSIS ✓, artifact-integrity manifest ✓ with qualification result `passed`.
- Qualify failures on earlier candidates were diagnosed as environment regressions and fixed harness-side: WebView2 Runtime ≥150 ignores `WEBVIEW2_*` env vars on elevated hosts (hosted Windows runners run elevated) — fixed via the HKLM `AdditionalBrowserArguments` policy channel written before spawn (`22961a3`, then a spawn-order race fixed in `aa36e2f`); manifest job expected a flat msi//nsis layout that download-artifact does not produce — fixed with a recursive scan. Full narrative in evidence.md.
