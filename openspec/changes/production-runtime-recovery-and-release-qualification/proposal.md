# Production Runtime Recovery and Release Qualification

## Why

The collector is fail-stop by design: any unexpected panic in `run_collector_loop`
(or in the background-thread bootstrap around it) emits
`"metrics collection stopped — restart the app"` and permanently ends metrics for
that process. The user must restart the whole application to recover from what is
usually a transient fault in one OS query. That was an accepted limitation of the
2026-08-13 reliability campaign; it is no longer acceptable for a production
runtime.

The second gap is release-boundary confidence. The mock E2E lane and mock
simulation lane run as required gates, but the real packaged-app lane is opt-in
and unasserted beyond "it launches", and nothing verifies that the generated MSI
and NSIS installers can actually be installed, launched, exercised, and
uninstalled on a clean Windows machine. Release artifacts are uploaded without
hashes or qualification evidence.

## What Changes

- Replace the fail-stop collector with a **supervised collector lifecycle**: a
  supervisor owns exactly one collector session at a time; on session panic it
  performs bounded automatic recovery (fresh OS-facing state, staged backoff,
  healthy-streak reset), escalates to a persistent `Failed` state when the budget
  is exhausted, and exposes a manual **Retry metrics** path that starts a new
  session without restarting the process. Shutdown remains responsive from every
  state.
- Introduce a **typed collector status contract** (`collector-status` event +
  `get_collector_status` command) with its own schema version, serialized state
  machine (`starting | healthy | recovering | failed | stopping`), attempt/generation
  metadata, and reason; keep the legacy `collector-error` string event for terminal
  messages.
- Preserve metric/history correctness across restarts: shared `HistoryStore`
  survives sessions; downtime stays a truthful timestamp gap; PDH/sysinfo rate
  counters are re-baselined before the first committed post-recovery tick so
  recovery introduces neither fabricated zeros nor counter spikes; history commit
  cadence (4 Hz live / 1 Hz full ticks) is unchanged.
- Update the frontend: recovering shows an accessible transient banner while
  keeping last-known metrics visible; failed shows an accessible alert with a
  working Retry button; successful recovery clears both automatically. No blanked
  dashboards, no fabricated zeros.
- Add **deterministic fault-injection seams** that exist only in test builds
  (`#[cfg(test)]` synthetic providers/policies); production builds expose no fault
  trigger, proven by an automated shipped-config lint.
- Extend Rust unit coverage for every supervisor transition (16 required
  behaviors), with injected policies so tests never sleep through real backoff.
- Extend Vitest coverage and add two simulation journeys: automatic recovery with
  continued usability, and retry exhaustion + manual retry.
- Promote the real packaged lane to a canonical `verify:packaged` qualification:
  build → launch the built exe via the existing CDP driver → assert real IPC,
  isolated real settings store, live collector data, UI interaction, clean exit,
  no orphan processes. CI policy: manual/tag dispatch (explicitly documented).
- Add **MSI/NSIS installation qualification** jobs that silently install the built
  installers on fresh Windows runners, verify product/version metadata from the
  registry, launch and smoke-test the *installed* executable, uninstall silently,
  and assert clean removal — plus a signed-hash artifact manifest recording
  version, commit, sizes, SHA-256 hashes, installer type, and result.
- Reconcile all instruction/documentation files with the final implementation.

## Capabilities

### New Capabilities

- `collector-supervision`: Bounded supervised recovery of the collector session
  with single-session ownership, fresh OS-state reconstruction, truthful history
  semantics, manual retry, and shutdown safety from every state.

### Modified Capabilities

- `metrics-history-streaming`: Add the typed collector-status contract and its
  schema-safety rules alongside the existing snapshot/history payloads.
- `frontend-data-load-resilience`: Collector failure becomes recoverable UX
  (recovering/failed states, retry action, automatic clearing) instead of a
  permanent dead end; last-known data retention and no-fabrication rules extend to
  the recovery path.
- `accessible-ui-feedback`: Accessible recovering/failed announcements, retry
  control naming, focus behavior.
- `user-simulation-platform`: Recovery and retry-exhaustion journeys join the mock
  lane matrix with meaningful assertions intact.
- `ci-pipeline-efficiency-and-coverage`: Packaged-app and installer qualification
  jobs, artifact manifest/hashes, shipped-config fault-surface lint, explicit
  manual/tag policy for expensive qualification lanes.
- `project-documentation-accuracy`: Document supervisor lifecycle, recovery
  policy, status contract, qualification commands, artifact locations, signing
  status, and known external limitations truthfully.

## Impact

- **Code:** `src-tauri/src/collector/supervisor.rs` (new), `collector/mod.rs`,
  `collector/run_loop.rs`, `state.rs` (status store), `lib.rs`, `main.rs`
  (supervisor wiring, new commands), `pdh.rs` (baseline priming helper),
  `hooks/useMetrics.ts`, `types/metrics.ts`, `App.tsx`, `sim/mockBackend.ts`.
- **Tests:** co-located Rust supervisor tests; Vitest hook/App tests; sim journeys;
  Playwright E2E additions if banner states are drivable in the mock harness.
- **CI/workflows:** `.github/workflows/rust.yml` / `simulation.yml` updates and a
  new `.github/workflows/release-qualification.yml`; pinned-action policy
  preserved; no remote-debugging flags added to shipped configuration.
- **Scripts:** `scripts/verify.mjs` (`packaged` mode), `scripts/qualify-packaged.mjs`,
  `scripts/installer-manifest.mjs`.
- **Docs:** root instruction files, `CONTEXT.md`, `progress.md`,
  `sys-monitor-tauri/README.md`.
- **Compatibility:** existing payloads keep `SCHEMA_VERSION = 5` (no shape change);
  the status contract carries its own `LIFECYCLE_SCHEMA_VERSION = 1`. Settings,
  identity, cadence, accessibility, and simulation-isolation behavior are preserved.
