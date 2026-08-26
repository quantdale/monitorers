# Progress

## Current Goal

Windows-only real-time system monitor (Rust/Tauri v2 backend, React/TypeScript frontend) in `sys-monitor-tauri/`, maintained through the spec-driven `openspec/` flow.

**Current phase: ACTIVE — `dependency-runtime-modernization-and-qualification`.**

Planning was produced from `main@46ee499ab934663c4e0807f7ab8e995707b77471` on 2026-08-26 after a fresh repository/dependency audit. The active OpenSpec change is:

`openspec/changes/dependency-runtime-modernization-and-qualification/`

The implementation agent should execute `.agent/EXECUTION_PROMPT.md` on branch `agent/monitorers-dependency-runtime-modernization` (rebasing the start onto the latest `origin/main` if main advanced, with the actual start SHA recorded in evidence).

## Agent Rules

- Do not ask questions unless truly blocked.
- Make reasonable assumptions and continue.
- Work on active OpenSpec tasks in dependency order.
- Mark tasks complete only with evidence.
- Add newly discovered defects/follow-up work to the active change or final backlog.
- Run the relevant test/lint/build gate after every coherent migration stage.
- Do not run destructive commands, force pushes, production deploys, secret mutation or database resets.
- Never weaken tests/security/identity/cadence contracts merely to accept a dependency update.

## Status snapshot (2026-08-26, next campaign planned)

- **Latest production baseline:** merge PR #29 at `46ee499ab934663c4e0807f7ab8e995707b77471`. The previous `production-persistence-and-operational-hardening` change is complete/archived; its behavior and hosted evidence are baseline requirements, not active implementation work.
- **Why work is active again:** the live dependency queue contains broad and/or major upgrades across sysinfo/WMI/windows/NVML/Tauri, React 19, Vite 8, TypeScript 7, jsdom 30 and related tooling. Several generated PRs are non-mergeable, and current Dependabot grouping combines unrelated compatibility domains. This is actionable software maintenance even though the prior campaign had no remaining product-hardening TODO.
- **Next-campaign decision:** perform controlled dependency/runtime modernization, fix Dependabot grouping, preserve collector/identity/IPC/settings contracts, and qualify through unit/E2E/mock simulation/packaged real-app/hosted Windows release lanes. Do not merge grouped Dependabot PRs wholesale.
- **Toolchain planning signal:** repository currently pins Rust 1.93.1; the target sysinfo 0.39.x line documents Rust 1.95 MSRV. Execution must re-check the actual selected versions and move the toolchain coherently if adopted.
- **WMI planning signal:** current collector bootstrap uses the older `COMLibrary` construction path; WMI 0.18 documents `WMIConnection::new()` with connection-managed COM initialization behavior. Migration must preserve collector-thread ownership, non-blocking core startup, bounded retry/backoff and degraded operation.
- **Frontend planning signal:** React already uses `createRoot`, but React 19/DOM/types must migrate coherently and be qualified separately from Vite/TypeScript/jsdom majors so failures stay attributable.
- **Dependabot process signal:** current all-Cargo and all-frontend-dev grouping is part of the problem; the active campaign must split future updates by compatibility/risk domain.

### Production contracts that remain mandatory

- Metrics schema 5 and lifecycle schema 1 unless an intentional serialized-contract migration is separately specified/tested.
- Settings schema 2, one shared store, serialized saves, future-version fail-closed behavior and isolated packaged-simulation store.
- Supervised collector sessions with typed `StopFlag`/`RetryRequest`, bounded automatic recovery and manual retry from failed state.
- 250 ms monotonic live schedule, 4:1 full-poll ratio, approximately 1 Hz history commits, elapsed-time rate fidelity and no catch-up burst.
- Stable disk/GPU identity across history/cards/sidebar/persisted layout; ambiguous Nvidia telemetry remains unavailable instead of guessed.
- WMI remains optional enrichment; core metrics stay live during WMI failure.
- Packaged CDP lane proves real Tauri IPC/store/sensors/restart with per-run isolation and orphan-process checks.
- GitHub Actions remain immutable-SHA pinned; cargo/npm security audits remain mandatory.

## Active TODO

- [ ] Execute `openspec/changes/dependency-runtime-modernization-and-qualification/tasks.md` end-to-end using `.agent/EXECUTION_PROMPT.md`.
- [ ] Reconcile every dependency PR in the execution-time queue as Adopted / Superseded / Deferred with exact evidence.
- [ ] Archive the OpenSpec change only after final local + packaged + hosted qualification and post-migration deep review are truthful and green.

## Recently completed

- [x] 2026-08-25 supervised collector recovery + typed lifecycle contract + recovery UX.
- [x] 2026-08-25 packaged qualification lane + MSI/NSIS release-qualification CI.
- [x] 2026-08-26 PR #28 safety closure: typed stop/retry managed state, race-fenced status bootstrap, initial-deadline wait, mock first-emit parity/teardown, artifact workflow fixes, WebView2 policy cleanup and retry-doc reconciliation; hosted/release qualification green.
- [x] 2026-08-26 deep-audit remediation/reconciliation: stale schema/probe docs fixed, duplicate helper/test code consolidated, dead code removed, executable schema contracts rechecked.
- [x] 2026-08-26 performance campaign: prebuilt SHA-pinned cargo-audit install, Playwright Chromium caching, MetricChart memoization/render-fanout reduction, measured release LTO decision, startup enumeration de-duplication and collector snapshot allocation cleanup.
- [x] 2026-08-26 simulation journey robustness: seeded misdrag outcome modeled truthfully so customization roundtrip no longer fails on an intentional simulated canceled drag.
- [x] 2026-08-26 PR #29 `production-persistence-and-operational-hardening`: real sidebar persistence across true relaunch, repeated restart soak, destructive sidebar persistence bug fix, drag-time ghost-drop fix, real-app orphan guard, CI efficiency evidence, repository-truth convergence and final hosted MSI/NSIS qualification.

Detailed command/run/performance history for completed campaigns is intentionally owned by their archived `openspec/changes/archive/.../evidence.md` plus git history rather than duplicated indefinitely in this live progress file.

## Backlog / deliberately deferred

- [ ] **Dual identical-GPU runtime mapping — physical proof.** Deterministic fixtures cover identity logic, but a qualifying machine with two identical physical GPUs is still required before claiming physical runtime qualification. A single iGPU exposing multiple PDH LUID nodes does not qualify.
- [ ] **Free-roam real-lane pointer-drag reorder.** Keyboard drag is the certified deterministic interaction used by persistence journeys. Pointer drag remains registered exploratory behavior and is not a blocker for the active dependency campaign.
- [ ] **Code signing.** MSI/NSIS installers remain unsigned because no signing certificate/secret is configured. Do not invent credentials inside the dependency campaign.

## Blocked

- None at planning time. Physical-only backlog items are intentionally deferred, not blockers for the active software campaign.
