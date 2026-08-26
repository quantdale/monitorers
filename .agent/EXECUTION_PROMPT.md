# Execution Prompt — Monitorers Dependency Runtime Modernization

**Status: ACTIVE — execute the OpenSpec campaign below.**  
**Planned:** 2026-08-26  
**Planned-From:** `main@46ee499ab934663c4e0807f7ab8e995707b77471`  
**Recommended target branch:** `agent/monitorers-dependency-runtime-modernization`  
**OpenSpec change:** `openspec/changes/dependency-runtime-modernization-and-qualification/`

## Mission

Take the current production-hardened Monitorers baseline and perform one controlled, end-to-end **dependency/runtime modernization and compatibility qualification** campaign.

Do not interpret this as “merge Dependabot.” The live generated dependency queue contains compiler-floor changes, Windows-native API migrations, Tauri cross-language updates, React 19, and major frontend build/test tooling changes. Your job is to modernize what can be safely qualified, explicitly defer what cannot, repair the Dependabot policy that over-couples migrations, and leave the repository with executable proof that the existing product contracts still hold.

You are expected to execute the entire campaign autonomously. Do not stop after planning, compilation, or a partial dependency group. Continue until all mandatory completion gates in `tasks.md` are satisfied, or until a genuine external blocker prevents a required gate; if blocked, exhaust all safe software alternatives and leave exact evidence/action required.

## First actions — do these before editing product code

1. `git fetch --all --prune` and inspect latest `origin/main`.
2. If `origin/main` is still the planned SHA, branch from it. If main advanced, branch from the latest main, record both the planned SHA and actual start SHA in `evidence.md`, inspect intervening commits, and make sure this OpenSpec campaign is still applicable.
3. Read in full:
   - this file;
   - `openspec/changes/dependency-runtime-modernization-and-qualification/audit.md`;
   - `proposal.md`, `design.md`, `tasks.md`, `evidence.md` and every delta spec;
   - root `AGENTS.md`, `progress.md`, `.github/dependabot.yml`;
   - current `sys-monitor-tauri/package.json`, lockfile role, `src-tauri/Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`;
   - the latest archived PR #29 OpenSpec change and its evidence so you understand the behavior that must not regress.
4. Refresh the open dependency PR queue and upstream release/migration notes. Dependabot state may have changed after this prompt was committed.
5. Run and record the baseline qualification before migrating dependencies.

## The campaign decision is already made

The previous audit/report findings are historical and remediated. Do **not** resurrect old findings just because `AUDIT_REPORT.md` mentions them. Current source and current failing evidence win.

The next campaign is specifically:

> **Dependency Runtime Modernization and Qualification** — modernize the Rust/Windows collector stack, Tauri/store boundary, React framework, frontend tooling and remaining dependency queue in reviewable compatibility domains; redesign Dependabot grouping; prove unchanged behavior through unit, E2E, simulation, packaged-app and hosted Windows/release lanes.

Do not substitute a UI redesign, another generic performance sweep, or a new product feature.

## Required workstreams

### Workstream A — baseline + upstream compatibility matrix

Build an execution-time matrix for every open dependency PR/package:

- current version;
- generated target version;
- upstream latest target actually evaluated;
- migration/breaking notes;
- MSRV/Node/peer requirements;
- repository files/APIs affected;
- initial disposition: Adopt / Supersede / Defer.

At minimum research the complete skipped-version migrations for `sysinfo`, `wmi`, `windows`, `nvml-wrapper`, React/React DOM, Vite/plugin-react, TypeScript, jsdom and Tauri v2 packages. Save authoritative source URLs in `evidence.md`.

Known planning-time facts that MUST be rechecked rather than blindly trusted:

- repo Rust pin is 1.93.1;
- sysinfo 0.39.x upstream currently documents Rust 1.95 MSRV;
- current code uses `COMLibrary::new().and_then(WMIConnection::new)` while WMI 0.18's normal documented constructor is `WMIConnection::new()` with connection-managed COM initialization behavior;
- Vite 8 supports Node 24, so Node 24 does not need to move solely for Vite.

### Workstream B — fix Dependabot grouping before accepting the queue

The existing config groups all Cargo dependencies and all frontend dev dependencies into broad groups. Replace that with reviewable compatibility domains as specified in `design.md`.

The result should make future PRs approximately follow these boundaries:

- collector platform/native: sysinfo/WMI/windows/Nvidia bindings;
- Tauri runtime/build/plugins;
- Rust foundation/serialization;
- React framework (React + DOM + matching types together);
- Tauri JS packages;
- build tooling (Vite/plugin-react/TypeScript, with majors isolated when possible);
- test DOM/tooling;
- UI/data libraries.

Do not create excessive update noise just to avoid grouping. The goal is fault isolation, not one PR per transitive patch.

### Workstream C — Rust toolchain + sysinfo

If the selected sysinfo version requires Rust 1.95+, move `rust-toolchain.toml` deliberately and keep CI/docs/cache truth coherent.

Migrate sysinfo across every affected use, not only compiler errors:

- CPU list/brand/vendor projection;
- disk enumeration, kinds, names and stable keys;
- network refresh/delta behavior;
- startup/recovery rate baselines;
- examples/probes/tests;
- startup enumeration de-duplication introduced by the prior optimization campaign.

Compare startup/cadence behavior to baseline. Do not reintroduce per-tick/per-profile fresh OS enumeration.

### Workstream D — WMI migration

Migrate the WMI API while preserving app-owned semantics:

- session-thread ownership;
- no unsafe Send/Sync workaround;
- first core snapshot does not wait for WMI;
- bounded retry/backoff/diagnostics;
- successful connection remains session-local;
- session replacement gets a fresh connection;
- WMI failure still leaves core metrics and conservative PDH GPU identity visible;
- GPU vendor-map/raw-query enrichment remains correct.

Do not blindly preserve the old `COMLibrary` shape if the selected WMI version owns initialization differently. Preserve **behavior**, not obsolete syntax.

### Workstream E — windows-rs / PDH

Upgrade windows-rs only with a full safety review of affected PDH FFI. Check all unsafe blocks, handles, status codes, buffers and counter-array conversions. Preserve the cadence collection count and no-catch-up/rate-baseline semantics.

Clippy `-D warnings`, feature-matrix tests and cadence evidence are mandatory here.

### Workstream F — NVML/NVAPI

Upgrade `nvml-wrapper` and adapt the actual APIs used. Preserve fail-closed per-device telemetry mapping:

- UUID/PCI exact identity first;
- normalized display name only when unique on both sides;
- duplicate names never get telemetry by index/first-match guessing;
- NVAPI single-reading fallback never broadcasts to multiple cards;
- missing NVML/driver remains graceful.

Keep physical identical-dual-GPU validation explicitly unqualified if the execution host lacks qualifying hardware. Fixtures are not physical proof.

### Workstream G — Rust foundation + Tauri/store cross-language boundary

After the low-level collector domain is green, migrate low-risk Rust foundation packages and then align the Tauri stack:

- Rust Tauri + tauri-build + tauri-plugin-store;
- JS `@tauri-apps/api` + plugin-store + CLI.

Prove all critical commands/events and managed-state semantics:

- `get_history`;
- `get_hardware_profile`;
- `get_collector_status`;
- `retry_collection`;
- `sim_store_override`;
- `metrics-update`;
- `collector-status`;
- `collector-error`;
- `hardware-profile-ready`;
- typed StopFlag/RetryRequest independence.

Prove settings schema 2 migration, serialized save queue, future-version fail-closed behavior, isolated packaged simulation store and true restart persistence.

Do not broaden Tauri capabilities because a migration is inconvenient.

### Workstream H — React 19

Migrate React + React DOM + their matching type packages coherently. Do not leave mismatched majors and do not bury this inside Vite/TS work.

Audit/qualify:

- StrictMode effect setup/cleanup;
- Tauri async listener registration/unlisten;
- status bootstrap race fence;
- settings provider singleton behavior;
- simulation backend start/stop;
- retry pending/coalescing UX;
- error boundaries;
- dnd-kit keyboard and pointer reorder;
- Recharts cards/memoization and absence of render loops.

Do not adopt React 19 features just for churn. Compatibility is the goal.

### Workstream I — Vite / plugin-react / TypeScript / jsdom / Node types

Stage these so failures remain attributable. Preferred order, subject to real peer constraints:

1. Vite + plugin-react compatible pair;
2. TypeScript 7 and minimal intentional source/config fixes;
3. jsdom 30 and test-environment fixes;
4. Node types aligned to the actual Node 24 runtime.

Search every tsconfig and simulation/E2E config. Do not solve TS 7 diagnostics with broad `any`, `@ts-ignore`, disabled strictness, or skipped files.

Node 24 is the current runtime truth. Change it only if an actually selected dependency requires a different supported runtime.

### Workstream J — remaining UI/data dependencies

Evaluate Recharts, Lucide and every remaining open dependency PR only after the framework/tooling floor is stable. Adopt when behavior is qualified; otherwise record a specific deferral. Do not leave an unexplained generated PR queue.

### Workstream K — CI/action maintenance exposed by the migration

Inspect hosted annotations. If a pinned action (for example artifact download/upload tooling) now uses an unsupported/deprecated Node runtime and a maintained compatible release exists, update it using a **full immutable commit SHA** and re-qualify artifact behavior.

Do not perform broad action churn without evidence. Keep `cargo audit` and npm audits mandatory.

## Behavioral invariants — these are hard acceptance boundaries

Unless you first create an explicit spec migration justified by a real product requirement, preserve all of the following:

1. **Collector cadence** — monotonic 250 ms live target, 4:1 full-poll ratio, ~1 Hz history commits, no catch-up burst.
2. **Time/rate truth** — no fabricated startup/recovery zeros/spikes; elapsed timestamps and rate denominators remain truthful.
3. **Metrics IPC** — schema version 5 and payload meaning unchanged.
4. **Lifecycle IPC** — schema version 1, supervised recovery budget/backoff and manual retry semantics unchanged.
5. **Typed Tauri state** — StopFlag and RetryRequest remain distinct; Retry can never become shutdown again.
6. **Hardware identity** — stable disk/GPU keys, no display-name identity, no silent layout reassignment.
7. **Nvidia association** — ambiguous devices fail closed; no foreign telemetry.
8. **WMI degradation** — WMI remains optional enrichment, not core-liveness dependency.
9. **Settings** — version 2, one shared store, serialized saves, future-version fail closed, corrupt-field fallback, real-store isolation.
10. **Packaged restart** — new process, real IPC/store, settings restore, advancing metrics, no owned orphan.
11. **Accessibility/reorder** — keyboard drag and existing accessible states remain certified.
12. **Security/supply chain** — cargo/npm audit mandatory; GitHub Actions full-SHA pinned.

A dependency upgrade that violates an invariant is not “done.” Fix it, revert that domain, or defer the target with evidence.

## Validation strategy

Run tests progressively rather than stacking ten migrations and discovering the first problem at the end.

### After each coherent stage

Run the cheapest relevant discriminator: Rust targeted tests/fmt/clippy or TS typecheck/Vitest/build. Keep commits coherent enough to bisect.

### After each runtime/framework domain

Run canonical `verify:rust` or `verify:frontend` plus the relevant E2E/simulation/probe set.

### Final local qualification

At final candidate head, from a clean dependency install/build state:

- `npm run verify:full`;
- `npm run verify:packaged`;
- full mock simulation;
- packaged real journeys for healthy metrics, customization roundtrip, sidebar relaunch persistence, restart soak, recovery/lifecycle behavior;
- cadence probe/checker over the documented qualifying interval;
- startup/identity focused probes/tests;
- `cargo audit` + npm audit(s);
- `openspec validate --all --strict --no-interactive` (or repository-equivalent current syntax);
- `git diff --check`.

Do not use a stale built executable. The packaged lane must exercise the final candidate.

### Hosted qualification

Push the branch and obtain final-SHA green results for required Rust/frontend/E2E/mock-sim/build jobs. Then trigger the packaged real-app simulation and MSI/NSIS release qualification when available. Inspect annotations and artifacts, not only green badges.

If you fix anything after hosted qualification, rerun every materially affected required workflow at the new final SHA.

## Open dependency PR handling

At campaign start, refresh the current queue. Planning observed #20–#27 across frontend/Rust domains. Those numbers may change.

Do not merge the broad generated branches wholesale. Recreate desired version changes intentionally on the campaign branch, or selectively adopt a generated diff only after proving it is coherent.

At finalization, record every start-of-campaign dependency PR as one of:

- merged by/through the campaign;
- superseded and should be closed;
- recreated under the new Dependabot grouping;
- intentionally deferred with exact reason/revisit trigger;
- still blocked by a named external condition.

Close/supersede stale PRs through available tooling if authorized. If your environment cannot mutate PR state, put a precise maintainer action list in `evidence.md`.

## What you may defer

A package target may be deferred when there is **specific evidence**, such as:

- selected target cannot build on a deliberately supported Windows/Rust/Node floor;
- upstream regression breaks a required application contract;
- peer dependency incompatibility has no supported coherent version set;
- migration would require an unrelated architecture replacement outside this campaign.

A deferral must record exact current pin, target evaluated, failure/constraint, upstream reference and revisit trigger. “Too hard” is not evidence.

## Explicitly out of scope

- UI redesign/new product features;
- unrelated refactoring;
- telemetry/analytics;
- cross-platform expansion;
- physical hotplug/lid/power automation fabrication;
- claiming dual-identical-GPU physical qualification without hardware;
- code-signing secret/certificate provisioning;
- weakening tests/security gates to accept a dependency.

The existing real-lane free-roam pointer-drag exploratory gap is not a blocker; keyboard drag remains the certified reorder interaction unless you independently prove pointer behavior without destabilizing the campaign.

## Review discipline

After migrations are green, perform a focused deep review of every changed source/config/test/workflow file plus its immediate behavioral callers/callees. Search for migration residue:

- TODO/FIXME/HACK;
- new `unwrap`/`expect`/panic in runtime paths;
- new/changed `unsafe`;
- TS suppressions/broad `any`;
- disabled/quarantined/skipped tests;
- broadened Tauri capabilities;
- weakened time/identity/assertion thresholds;
- duplicated dependency majors or unexpected lockfile downgrades;
- new audit advisories.

Fix every introduced Critical/High/P1/P2 issue with a regression test before completion.

## Git/commit/reporting requirements

- Work on the campaign branch; do not implement directly on `main`.
- Keep commits coherent by compatibility domain so regressions can be bisected/reverted.
- No force-push, destructive reset, history rewrite, production deploy, secret mutation or database reset.
- Push all work; no local-only evidence.
- Keep `evidence.md` updated during execution rather than reconstructing everything from memory at the end.
- At completion, update `progress.md` and only the tracked docs whose version/test/runtime truth changed.
- Sync/archive OpenSpec through the repository's standard OpenSpec workflow only when tasks and evidence are truthful.

## Completion gates

Do not declare success until all of these are true:

- [ ] actual execution baseline and dependency queue recorded;
- [ ] Dependabot grouping no longer creates unrelated catch-all major migrations;
- [ ] selected Rust toolchain satisfies all adopted Rust dependencies;
- [ ] sysinfo/WMI/windows/NVML migrations preserve collector/time/identity contracts;
- [ ] all Rust feature combinations remain green;
- [ ] Tauri Rust+JS/store/CLI versions are coherent and real IPC/settings/restart are proven;
- [ ] React/DOM/types are coherent and hook/listener/reorder/chart behavior remains green;
- [ ] Vite/TypeScript/jsdom/tooling migration passes type/unit/build/E2E/simulation gates;
- [ ] every remaining dependency PR has Adopt/Supersede/Defer disposition;
- [ ] final clean `verify:full` green;
- [ ] final `verify:packaged` green;
- [ ] final mock + packaged real simulation evidence green;
- [ ] cadence/startup/identity evidence green;
- [ ] cargo/npm security audits green with no hidden skip;
- [ ] hosted required workflows green at the final candidate SHA;
- [ ] MSI/NSIS release qualification green when the mandatory workflow is available;
- [ ] post-migration deep review found no unresolved introduced Critical/High/P1/P2 issue;
- [ ] OpenSpec strict validation + `git diff --check` green;
- [ ] docs/progress/evidence/PR queue tell one final coherent truth;
- [ ] branch clean and fully pushed.

## Final report format

Your final commit/report must be detailed enough for another agent to audit without rerunning your reasoning. Include:

1. planned baseline → actual start SHA → final SHA;
2. before/after dependency + Rust/Node version matrix;
3. Dependabot policy changes;
4. each compatibility-domain migration and important source adaptations;
5. regressions/defects found and how each was fixed/pinned by tests;
6. exact local validation results;
7. hosted workflow run IDs/results/artifacts;
8. packaged real-app/restart/cadence evidence;
9. security audit results;
10. every Dependabot PR disposition;
11. intentional deferrals and exact revisit triggers;
12. physical/external limitations that remain unqualified.

Then push, leave the branch clean, and stop. Do not invent a follow-up feature campaign inside this execution.
