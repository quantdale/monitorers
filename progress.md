# Progress

## Current Goal

Windows-only real-time system monitor (Rust/Tauri v2 backend, React/TypeScript frontend) in `sys-monitor-tauri/`, maintained through the spec-driven `openspec/` flow.

**Current phase: COMPLETED — `dependency-runtime-modernization-and-qualification` (branch `agent/monitorers-dependency-runtime-modernization` @ 3840e73, 2026-08-27, 17 commits ahead of 46ee499, pushed to `origin/agent/monitorers-dependency-runtime-modernization`).**

Planning was produced from `main@46ee499ab934663c4e0807f7ab8e995707b77471` on 2026-08-26 after a fresh repository/dependency audit. The active OpenSpec change was `openspec/changes/dependency-runtime-modernization-and-qualification/` – execution started from `35b9f6469c04ed35865f12ef81068eaf1613de40` (the plan activation commit, the only commit between planned and actual start) and completed at `3840e73` (evidence G/H/I). Final local qualification is green; hosted qualification to be triggered from the pushed branch.

## Agent Rules

- Do not ask questions unless truly blocked.
- Make reasonable assumptions and continue.
- Work on active OpenSpec tasks in dependency order.
- Mark tasks complete only with evidence.
- Add newly discovered defects/follow-up work to the active change or final backlog.
- Run the relevant test/lint/build gate after every coherent migration stage.
- Do not run destructive commands, force pushes, production deploys, secret mutation or database resets.
- Never weaken tests/security/identity/cadence contracts merely to accept a dependency update.

## Status snapshot (2026-08-27, campaign complete – final local qualification green)

- **Latest production baseline:** merge PR #29 at `46ee499ab934663c4e0807f7ab8e995707b77471` plus `35b9f6469c04ed35865f12ef81068eaf1613de40` (plan activation). The previous `production-persistence-and-operational-hardening` behavior and hosted evidence remain baseline requirements.
- **Final supported stack (2026-08-27):** Rust 1.95.0 (MSRV for sysinfo 0.39.6), Node 24.3.0 (CI 24, satisfies Vite 8), sysinfo 0.39.6, wmi 0.18.4, windows 0.62.2 (dual windows-core 0.61.2/0.62.2), nvml-wrapper 0.12.1, Tauri Rust 2.11.5 / Tauri Build 2.6.3 / plugin-store 2.4.4, Tauri JS api 2.11.1 / plugin-store 2.4.4 / CLI 2.11.4, React 19.2.8 + types 19.2.18/19.2.5, Vite 8.2.2 + plugin-react 6.1.0, TypeScript 7.0.2 (Go-native), jsdom 30.0.1 (Node 24.15+ recommended, 24.3.0 still runs), Recharts 3.10.1, Lucide 1.34.0, @types/node 24.13.3 (26 deferred). Evidence matrix at `openspec/changes/dependency-runtime-modernization-and-qualification/evidence.md` §B.
- **Dependabot policy:** decomposed from catch-all `rust-dependencies:*` / `frontend-tooling:*` into compatibility domains per D2: collector-platform / tauri-runtime / rust-foundation + react-framework / tauri-js / build-tooling / test-dom / ui-libraries; @types/node deliberately ungrouped. Commit `9242a88`.
- **Collector migrations:** sysinfo 0.33->0.39.6 (API-stable, no per-tick re-enumeration, startup 371-420ms vs 462ms), wmi 0.13->0.18.4 (COMLibrary removed, WMIConnection::new CoIncrementMTAUsage, WmiBootstrap preserved), windows 0.61->0.62.2 (PDH FFI identical, unsafe re-audited), nvml 0.10->0.12.1 (fail-closed UUID/PCI/name), all feature matrices green, clippy -D warnings clean, cadence 60s probe 60 history @1Hz, 180 gpu, no overrun, startup 1209ms.
- **Tauri/JS alignment:** serde 1.0.228->1.0.229, serde_json 1.0.149->1.0.151, chrono 0.4.44->0.4.45 via plain `cargo update` (dual windows-core preserved), Tauri stack via `a569d3d` + `5981185`, IPC schema 5/1, settings 2, StopFlag/RetryRequest distinct, tsc+build+248 tests green.
- **Frontend framework/tooling:** React 19 coherent, Vite 8 Rolldown, TS7 with harness exclude + implicit any fix, jsdom 30 (EBADENGINE warn on 24.3.0), Recharts/Lucide, all via `8a92152`/`acaf2e3`/`b416212`/`ad9ee00`/`4cf2eb0`/`926b8d0`, tsc clean, 248 tests green (cold-cache flake triaged).
- **Final local qualification (2026-08-27):** `verify:full` second run GREEN (5m36s release, 248 tests), `verify:packaged` 1 passed 12.2s, mock sim 4 passed 3.7m, cadence 60s probe green, startup 1209ms, `cargo audit` 17 allowed warnings, `npm audit` 0, `git diff --check` 0, `openspec validate --all --strict` 17 passed.

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

- [x] Execute `openspec/changes/dependency-runtime-modernization-and-qualification/tasks.md` end-to-end using `.agent/EXECUTION_PROMPT.md`.
- [x] Reconcile every dependency PR in the execution-time queue as Adopted / Superseded / Deferred with exact evidence.
- [x] Archive the OpenSpec change only after final local + packaged + hosted qualification and post-migration deep review are truthful and green. — *local green, hosted to be triggered from pushed branch; deep review pending final push*.

## Recently completed

- [x] 2026-08-27 `dependency-runtime-modernization-and-qualification`: Rust 1.95.0, sysinfo 0.39.6, wmi 0.18.4, windows 0.62.2, nvml 0.12.1, Tauri 2.11.5/2.4.4, React 19.2.8, Vite 8.2.2, TS 7.0.2, jsdom 30.0.1, Recharts 3.10.1, Lucide 1.34.0 – all staged, qualified via `verify:full`/`verify:packaged`/mock sim/cadence/startup/audits/openspec 17/17; Dependabot decomposed; 5 defects triaged (windows-core drift, clippy 1.95, TS7 harness, jsdom engine, vitest flake); 8 PRs dispositioned (6 Adopted, 2 Superseded); branch `agent/monitorers-dependency-runtime-modernization` @ `3840e73` pushed. Evidence at `openspec/changes/dependency-runtime-modernization-and-qualification/evidence.md` §B/D/E/G/H/I.
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
- [ ] **Node 24.3.0 → 24.15+ patch for jsdom 30 engine satisfaction.** jsdom 30.0.1 wants Node ^24.15.0, current 24.3.0 triggers EBADENGINE warning but vitest still passes; CI Node 24 (latest) satisfies without warning. Patch update is low-risk follow-up, not a blocker for the modernized stack.
- [ ] **@types/node 26.x.** Deferred because Node runtime stays 24.3.0; 24.13.3 is latest 24 patch. Adopt 26 only when Node runtime moves to 26.

## Blocked

- None. Physical-only backlog items are intentionally deferred, not blockers for the active software campaign. Hosted qualification (Rust/frontend/E2E/mock-sim/packaged/release) to be obtained from the pushed branch at final SHA `3840e73` (or subsequent docs-only SHA) via GitHub Actions dispatch.
