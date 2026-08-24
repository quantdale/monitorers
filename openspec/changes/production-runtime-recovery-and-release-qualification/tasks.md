# Tasks

## 1. Collector supervisor (Rust)

- [ ] 1.1 Add `collector/supervisor.rs`: `CollectorLifecycleState`, `CollectorStatus` (`LIFECYCLE_SCHEMA_VERSION = 1`), `RecoveryPolicy` with named defaults + pure `backoff_for/should_escalate/streak_expired`, session outcome type, and the supervised run loop (spawn factory-built sessions, join before respawn, status callback under short lock).
- [ ] 1.2 Add rate-baseline priming for fresh sessions (`prime_rate_baselines`: one `PdhCollectQueryData` + existing network refresh) wired into every session start.
- [ ] 1.3 Add `SafeCollectorStatus` store + `get_collector_status` command; keep `collector-error` legacy emission on terminal transitions.
- [ ] 1.4 Wire supervisor into `main.rs` (replace fail-stop thread body): status emits, retry command `retry_collection`, shutdown flag honored from all states, hardware-profile bootstrap moved into the session factory.
- [ ] 1.5 Export new public items from `lib.rs`; keep payload derives `Serialize`-only.

## 2. Supervisor tests (deterministic, no wall-clock backoff)

- [ ] 2.1 Policy unit tests: staged backoff values, escalation boundary, healthy-streak reset math.
- [ ] 2.2 Session tests with `#[cfg(test)]` synthetic providers: healthy bounded run; stop exits without recovery; panic surfaces one outcome; replacement after single panic; no concurrent duplicate emission (join-before-spawn); history preserved across replacement with truthful timestamp gap; primed first commit is a real delta (no fabricated 0%/spike); backoff bounded via injected tiny policies; repeated failures escalate to `failed`; manual retry leaves `failed` and starts exactly one session; retry coalesced outside `failed`; shutdown during backoff starts nothing; healthy period resets streak; status serialization round-trip; status-emission failure does not crash supervision.

## 3. Frontend lifecycle UX

- [ ] 3.1 `types/metrics.ts`: mirror `CollectorStatus` (+ state union) manually.
- [ ] 3.2 `useMetrics.ts`: listen `collector-status`, validate `EXPECTED_LIFECYCLE_SCHEMA_VERSION` fail-closed, expose `lifecycle`; clear `collectorError` on `healthy`; browser-mode branch through mock backend (`getStatus`, `retryCollection`).
- [ ] 3.3 `App.tsx`: recovering banner (`role="status"`, polite, amber, keeps metrics), failed banner (`role="alert"` + Retry metrics button invoking retry once per activation), automatic clearing; no zero substitution anywhere.
- [ ] 3.4 Vitest: hook tests for healthy→recovering→healthy, →failed, manual retry, transient clearing, retention without zeros, generation-change non-duplication, lifecycle schema mismatch fail-closed, retry-button behavior; update pinned "collectorError never auto-clears" test to the new contract (still survives unrelated metrics events).
- [ ] 3.5 Mock backend: lifecycle fault synthesis (`crash-recover`, crash-exhausted sequences), `retryCollection()`, status plumbing — browser-mode only.

## 4. Simulation journeys

- [ ] 4.1 Journey `collector-recovery`: monitor → interruption → recovering UI retained values → automatic restoration → post-recovery window/settings interaction.
- [ ] 4.2 Journey `collector-retry-exhaustion`: budget exhaustion → failed UI → Retry metrics click → restoration.
- [ ] 4.3 Update legacy `fault-response` journey to the recovery reality (banner text no longer permanent "restart the app"); keep assertion strength and error policies.

## 5. Packaged-app qualification

- [ ] 5.1 `scripts/qualify-packaged.mjs`: build exe, launch via `RealAppDriver` isolation, assert real IPC history response, advancing real collector data, isolated settings write, representative interaction, clean exit, zero orphan app/webview processes; nonzero exit on failure.
- [ ] 5.2 Package scripts: `verify:packaged`; verify.mjs `packaged` mode (Windows-only guard).

## 6. Installer qualification + release integrity

- [ ] 6.1 `scripts/installer-manifest.mjs`: manifest with version, commit SHA, timestamp, filenames/sizes/SHA-256/type, signing status, qualification result.
- [ ] 6.2 `.github/workflows/release-qualification.yml` (workflow_dispatch + v-tags): build installers once → upload artifacts; independent MSI and NSIS Windows jobs: silent install, registry-based location/version verification, installed-exe launch + smoke (driver reuse where permitted), silent uninstall, removal/orphan assertions; upload manifest + logs.
- [ ] 6.3 Extend shipped-config lint: cargo `[features]` allow-list (`custom-protocol`, `nvml`, `nvapi`) + grep for env-var collector-fault triggers in non-test Rust sources.

## 7. Documentation

- [ ] 7.1 Update AGENTS.md / CLAUDE.md / .cursorrules: supervisor lifecycle, policy constants, status contract + version, retry semantics, gap/re-baseline rules, packaged/installer commands, artifact locations; remove fail-stop claims everywhere.
- [ ] 7.2 CONTEXT.md glossary terms (session/generation/recovering/failed/retry); README commands; workflow comments.
- [ ] 7.3 progress.md: truthful campaign snapshot; note dual-GPU hardware limitation carried forward unchanged.

## 8. Verification gates

- [ ] 8.1 `npm run verify:fast` locally green (frontend + full Rust matrix incl. clippy `-D warnings`).
- [ ] 8.2 `npm run verify:e2e`, `npm run verify:sim`, `npm run sim:typecheck` green.
- [ ] 8.3 `npm run verify:version`; `openspec validate --all --strict --no-interactive`; `git diff --check`.
- [ ] 8.4 `npm run verify:tauri` (production executable); local installer build + manifest generation sanity check (no machine-mutating steps locally).
- [ ] 8.5 `npm run verify:packaged` executed against the built exe if environment permits; record evidence or document blocker.

## 9. Hosted CI

- [ ] 9.1 Commit in coherent phases; push branch; open PR.
- [ ] 9.2 Watch hosted runs; fix failures; capture run IDs/job outcomes/artifacts as OpenSpec evidence.
- [ ] 9.3 Dispatch release-qualification workflow when permissions permit; attach MSI/NSIS qualification evidence to this change.
