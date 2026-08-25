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

- [ ] 8.1 `npm run verify:fast` locally green (frontend + full Rust matrix incl. clippy `-D warnings`).
- [ ] 8.2 `npm run verify:e2e` (12/12), `npm run verify:sim` (16/16 runs), `npm run sim:typecheck` green — recorded during the campaign.
- [ ] 8.3 `npm run verify:version`; `openspec validate --all --strict --no-interactive`; `git diff --check`.
- [ ] 8.4 `npm run verify:tauri` production executable; local MSI/NSIS build + manifest generation sanity (no machine-mutating steps locally).
- [ ] 8.5 `npm run verify:packaged` executed against the built exe; record evidence or document blocker.

## 9. Hosted CI

- [ ] 9.1 Push branch; open PR.
- [ ] 9.2 Watch hosted runs; fix failures; capture run IDs/job outcomes/artifacts as evidence below.
- [ ] 9.3 Dispatch release-qualification workflow when permissions permit; attach MSI/NSIS qualification evidence.

## Evidence

(Append run IDs, job outcomes, and artifact names here as hosted validation completes.)
