# Deep Audit — Dependency Runtime Modernization and Qualification

**Audit date:** 2026-08-26  
**Repository:** `quantdale/monitorers`  
**Pinned planning baseline:** `main@46ee499ab934663c4e0807f7ab8e995707b77471` (merge of PR #29)  
**Planning outcome:** activate `dependency-runtime-modernization-and-qualification`

## 1. Executive conclusion

The repository is not in need of another generic reliability or performance sweep. The last two production campaigns already established supervised collector recovery, typed lifecycle IPC, real packaged-app automation, restart/settings durability, stronger hardware identity handling, CI supply-chain hardening, and measured performance improvements. The historical root `AUDIT_REPORT.md` explicitly marks its July findings as remediated and warns future agents to verify current source before reopening them.

The next high-value software campaign is **dependency/runtime modernization with compatibility qualification**.

The reason is concrete and current: `progress.md` says no actionable software TODO remains, while the repository has a live queue of open Dependabot PRs spanning the exact layers that carry the app's hardest correctness contracts. The present dependency automation groups unrelated upgrades into broad PRs, including major or API-changing updates. Some of those PRs are already non-mergeable. Treating them as routine lockfile maintenance would put recently hardened runtime behavior at unnecessary risk.

This campaign is therefore not “upgrade everything because newer exists.” It is a controlled migration program whose success criterion is preservation of the existing product contracts under a modern supported toolchain and dependency set.

## 2. Audit method and coverage

The audit was anchored to the exact `main` tree rather than to stale audit prose. The full recursive Git tree was inventoried first, then the unique functional surfaces were read and cross-checked against current OpenSpec requirements, recent merged campaign evidence, and the live Dependabot queue.

Coverage included:

- root operational truth and agent instructions: `.agent/`, `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `CONTEXT.md`, `GEMINI.md`, `progress.md`, historical audit/remediation records;
- OpenSpec configuration, current capability specifications, every active/archive boundary, and the two latest archived campaigns;
- GitHub Actions workflows, Dependabot policy, hooks, package manifests, lockfile roles, release/build configuration;
- frontend application entrypoint, settings state/persistence, metrics/history/lifecycle state, hardware-profile state, card identity/reorder logic, components, simulation bridge, E2E and simulation architecture;
- Rust/Tauri entrypoint and managed state, collector loop/scheduling, supervisor lifecycle, history store, snapshots, hardware detection, PDH layer, disk/network/CPU/GPU collectors, WMI bootstrap, NVML/NVAPI reconciliation, probes/tests, Tauri configuration/capabilities;
- current open dependency PRs and the compatibility implications of their target versions.

Repository copies of agent/OpenSpec skill files that have identical Git tree/blob SHAs were audited by **hash equivalence** rather than pretending repeated byte-identical boilerplate was independently different code. Generated lockfiles and binary/icon assets were audited as dependency/build/release surfaces; they do not contain application control flow to line-review. This preserves full repository coverage without inflating the audit with duplicate reads.

## 3. Current system map

### 3.1 Runtime

The product is a Windows-only Tauri v2 desktop monitor. The Rust side owns OS-facing collection through PDH, WMI, sysinfo, NVML/NVAPI and windows-rs. A supervised session model recreates all OS-facing state after a panic, keeps persistent in-process history across session replacement, and exposes lifecycle state/retry semantics through typed Tauri managed state and IPC.

The real collector loop runs at a monotonic 250 ms live cadence with a 4:1 live/full-poll ratio. History commits occur only on full ticks, yielding the 1 Hz history contract. WMI enrichment is deliberately optional/non-blocking, and the first core snapshot must not wait behind WMI startup.

### 3.2 Frontend

React 18 currently mounts through `createRoot` under `StrictMode`, a shared `SettingsProvider`, and an error boundary. `useMetrics` owns schema validation, live/history reconciliation, lifecycle bootstrap fencing, collector failure/recovery UX state, and 4 Hz scalar versus 1 Hz committed-history semantics. `useSettings` owns settings schema version 2, plugin-store loading, validation/migration, serialized saves, and the simulation-only isolated store override.

### 3.3 Qualification infrastructure

The repository has three materially different browser/runtime verification layers:

1. plain Playwright against the Vite mock-data harness;
2. a deterministic simulation lane with scripted faults;
3. a packaged-app CDP lane that drives the built WebView2 app with real Tauri IPC, real plugin-store persistence, real sensors and true process relaunch under per-run isolation.

Windows CI also compiles/tests the Rust feature matrix, audits dependencies, builds the production executable, and supports MSI/NSIS release qualification on dispatch/tag flows. This is strong enough to qualify a dependency migration without weakening gates.

## 4. Findings

### F-01 — Actionable dependency work exists even though repository status says “none”

**Planning priority: High**

`progress.md` truthfully closed PR #29, but its “no active actionable software TODO” statement now misses the live dependency queue. At audit time the open queue includes:

- Rust dependency group PR #27: `tauri-plugin-store`, `serde`, `serde_json`, `sysinfo`, `wmi`, `chrono`, `nvml-wrapper`, `windows`, `tauri-build`;
- frontend tooling PR #20: Tauri CLI, Node types, Vite React plugin, jsdom, TypeScript, Vite;
- React PR #23 and React DOM PR #24 for React 19;
- JS Tauri API/plugin-store, Recharts and Lucide updates in separate PRs (#22, #26, #21, #25 at planning time).

This is a real maintenance backlog because several packages sit directly on collector, IPC, persistence and test/build boundaries. The correct response is to activate a bounded migration campaign, not to pretend the queue is irrelevant or to merge it wholesale.

### F-02 — The grouped Rust PR crosses a toolchain floor and a WMI API boundary

**Planning priority: High**

The repository pins Rust `1.93.1`. The target `sysinfo 0.39.x` line documents an MSRV of Rust 1.95. This means the proposed Rust group cannot be treated as a dependency-only lockfile refresh: the supported compiler declaration and every cache/CI assumption that keys on it must move coherently if `sysinfo 0.39.x` is adopted.

The current `WmiBootstrap` constructs WMI with `COMLibrary::new().and_then(WMIConnection::new)`. Current WMI 0.18 documentation exposes `WMIConnection::new()` as the normal constructor and documents COM initialization behavior in the connection itself. Therefore WMI migration requires source adaptation and a deliberate decision about who owns COM initialization. The existing invariants — connection stays on the collector thread, startup does not block core metrics, retries remain bounded — must be preserved.

### F-03 — Rust dependency upgrades touch hardware identity, not just compilation

**Planning priority: High**

`sysinfo`, `wmi`, `windows` and `nvml-wrapper` are not peripheral libraries here:

- `sysinfo` supplies CPU brand/list refresh, physical disk enumeration/kind, network refresh and baseline behavior;
- WMI supplies GPU vendor/caption enrichment and other Windows metadata after non-blocking bootstrap;
- windows-rs underpins the PDH FFI layer and its safety boundaries;
- NVML readings are reconciled to collector GPU keys through UUID/PCI/name logic designed specifically to avoid assigning telemetry to the wrong identical GPU.

A migration can compile and still regress device keys, startup behavior, counter baselines, WMI fallback, or per-GPU association. Qualification must therefore assert behavior and identity contracts, not only typecheck/build success.

### F-04 — Frontend tooling upgrades are over-coupled and some are already non-mergeable

**Planning priority: High**

The current frontend-tooling Dependabot PR combines Vite 8, plugin-react 6, TypeScript 7, jsdom 30, Node type 26 and Tauri CLI updates. Several are major migrations with their own configuration/peer constraints. The PR was non-mergeable at audit time.

Vite 8 itself supports the repository's Node 24 CI baseline, so Node is not an inherent blocker. The risk is the combined blast radius: a TypeScript diagnostic change, a jsdom behavior change and a build-plugin change can all fail in one PR with poor fault isolation.

### F-05 — React 19 must be treated as one framework migration

**Planning priority: Medium-High**

The app already uses `createRoot`, but React 19 is still a semantic framework migration. React and React DOM plus their matching type packages must move coherently. The app has several areas where framework timing/StrictMode behavior matters:

- async Tauri event listener registration and cleanup;
- lifecycle bootstrap race fencing;
- settings load and serialized save state;
- dnd-kit pointer/keyboard interactions;
- Recharts memo/render behavior;
- error boundaries and dynamic card trees.

React 19 should be qualified independently from the Vite/TypeScript/jsdom migration so regressions can be attributed.

### F-06 — Dependabot grouping policy is the process root cause

**Planning priority: High**

`.github/dependabot.yml` groups every Cargo dependency into `rust-dependencies` and every frontend development dependency into `frontend-tooling`. That policy is reasonable for low-risk patch churn but unsafe for this repository's major/API-changing runtime dependencies. It couples unrelated migrations, obscures the dependency graph, makes rollback coarse, and creates PRs that are harder to qualify.

The policy should be changed before or as part of the migration so future queues are divided by compatibility domain and majors are not swallowed into broad “everything” groups.

### F-07 — Existing gates are sufficient, but dependency migrations must actually use the strongest lanes

**Planning priority: Medium-High**

The current canonical gates are strong and should not be redesigned. The migration must explicitly require them in ascending cost:

- Rust formatting, feature-matrix tests, clippy and cargo audit;
- npm audit, TypeScript, Vitest and production frontend build;
- Playwright E2E and mock simulation;
- Windows production executable build;
- packaged-app real lane for IPC/store/relaunch/sensor behavior;
- release qualification for MSI/NSIS where hosted dispatch is available;
- cadence/startup probes when collector dependencies or toolchain move.

A dependency change is not complete because unit tests compile. For runtime-layer upgrades, the packaged lane is part of the acceptance boundary.

### F-08 — Two visible gaps remain deliberately outside this campaign

**Planning priority: Deferred / external**

- Dual identical-GPU runtime mapping remains physically unqualified without qualifying hardware. Deterministic identity fixtures exist and must remain green, but the campaign must not fabricate hardware evidence.
- Installers are unsigned because no code-signing certificate is configured. Dependency modernization must not invent signing credentials/secrets or turn signing into a blocker unless the repository is separately provisioned for it.

The real-lane free-roam pointer-drag proof also remains a registered exploratory item; keyboard drag is the certified persistence interaction. It is not a reason to delay dependency modernization.

## 5. Why this campaign wins over alternatives

### Rejected: another generic “deep hardening” sweep

The last campaigns already did exactly that, including a focused post-implementation re-audit. Repeating it without a new risk driver would create churn and reopen historical findings that current source has already fixed.

### Rejected: another performance campaign

The repository recently measured and shipped concrete frontend, startup and release-build improvements, while explicitly evaluating and declining smaller optimizations. There is no stronger current evidence that another performance sweep beats dependency risk reduction.

### Rejected: physical hardware qualification campaign

The remaining identical-GPU/hotplug/power gaps require hardware not guaranteed to be available. They remain valid exploratory work but are not a software campaign an autonomous agent can finish reliably in one shot.

### Selected: dependency/runtime modernization and compatibility qualification

This has a live, bounded backlog; touches production-critical surfaces; can be fully driven by the existing test/simulation/release infrastructure; and also fixes the Dependabot policy that created unsafe coupling in the first place.

## 6. Campaign dependency graph

The executor should preserve this order unless real compatibility evidence forces a documented variation:

1. **Baseline and upstream compatibility research.** Pin the starting SHA, record open PRs, confirm target versions, MSRV/Node/peer constraints and breaking changes.
2. **Dependabot policy decomposition.** Stop future bulk coupling before generating more noise.
3. **Rust toolchain + low-level collector runtime.** Toolchain, sysinfo, WMI, windows-rs, NVML with focused tests/probes.
4. **Tauri/store cross-language alignment.** Rust Tauri/build/plugin-store plus JS Tauri API/store/CLI as one compatibility boundary.
5. **React 19 framework migration.** React/DOM/types together, independently qualified.
6. **Frontend build/test tooling.** Vite/plugin-react/TypeScript/jsdom/Node types staged according to actual peer constraints.
7. **UI/data libraries.** Recharts/Lucide and other low-risk updates only after the framework/tooling floor is stable.
8. **Full packaged/release qualification and post-migration audit.** Fix introduced Critical/High/P1/P2 defects with regression tests.
9. **Repository truth + dependency PR disposition.** Update docs/status/spec evidence and record which Dependabot PRs are superseded, recreated, rebased, closed or still intentionally deferred.

## 7. Guardrails for the executor

- Do not merge the current grouped Dependabot PRs wholesale merely because they are generated automatically.
- Do not use `--force`, skip tests, weaken assertions, remove feature-matrix coverage, or reduce audit severity to get green.
- Do not change IPC schema version 5, lifecycle schema version 1, or settings version 2 unless the serialized contract actually changes. If a contract changes, migrate it explicitly with tests and docs.
- Preserve stable disk/GPU keys, 4 Hz live / 1 Hz history cadence, monotonic scheduling, non-catch-up behavior, WMI-degraded operation, supervisor retry/stop separation, settings isolation, and true-relaunch persistence.
- Do not conflate “latest” with “qualified.” A target version may be deferred when upstream compatibility or regression evidence says it is unsafe; document the reason and keep the best supported version.
- No unrelated UI redesign, new feature work, architecture rewrite, telemetry addition, cross-platform expansion, or secret/certificate provisioning.
- Physical-only scenarios stay explicitly unqualified unless qualifying hardware is actually present and evidence is captured.

## 8. Definition of a successful next campaign

The campaign is complete only when:

- dependency/toolchain changes are intentionally staged and the repository builds on its declared supported Node/Rust versions;
- every canonical local gate is green with no gate weakening;
- packaged real-app qualification proves real IPC, settings, restart and sensor behavior after the migration;
- collector cadence/identity contracts are unchanged or an intentional spec migration is fully documented and tested;
- Dependabot no longer creates giant unrelated major-migration groups;
- every open dependency PR has a documented disposition;
- strict OpenSpec validation and `git diff --check` pass;
- hosted Windows/release evidence is green when available;
- a final focused audit finds no unresolved introduced Critical/High/P1/P2 issue;
- `progress.md`, agent prompt, OpenSpec specs/tasks/evidence and repository docs tell one coherent final truth.
