# Design — Dependency Runtime Modernization and Qualification

## Context

`main@46ee499ab934663c4e0807f7ab8e995707b77471` is a strong production baseline. PR #29 proved real settings persistence/relaunch, added a restart soak, fixed destructive sidebar-order persistence, improved CI cost, and re-converged repository truth. The next campaign must preserve those gains while moving a dependency stack that is beginning to age and whose automated update policy now produces overly broad migrations.

This design intentionally separates **compatibility domains**. The central rule is: move one behaviorally coherent boundary at a time, run the cheapest discriminating gates immediately, and run the expensive packaged/release qualification only after the stack is coherent.

## Goals

- Modernize runtime/framework/tooling dependencies to intentionally supported versions.
- Preserve all existing collector, identity, IPC, persistence, simulation and accessibility contracts.
- Make future dependency PRs smaller and easier to attribute/rollback.
- Produce executable evidence at real seams, not only compile success.
- Allow evidence-based deferral when an upstream target is incompatible or unjustified.

## Non-Goals

- Feature work, UI redesign, telemetry, cross-platform expansion or architecture replacement.
- Unrelated cleanup solely because a touched file is nearby.
- Faking physical hardware validation.
- Provisioning signing certificates/secrets.

## D1. Baseline is immutable evidence

Before changing dependencies, record:

- exact base SHA and current package/toolchain versions;
- current open Dependabot PR number → package/version mapping and mergeability;
- current canonical local gate result;
- current packaged-app result on a qualifying Windows host when available;
- cadence/startup probe baseline for collector-facing changes.

If the base branch moves before execution begins, rebase the campaign branch onto the latest `origin/main`, record both the originally planned SHA and adopted execution SHA, and rerun baseline gates. Do not silently execute against an unknown base.

## D2. Dependabot groups follow compatibility domains

The current broad groups are replaced with smaller domains. Exact YAML syntax may vary with Dependabot capabilities, but the resulting behavior SHALL be equivalent to this intent:

### Cargo

- **collector-platform:** `sysinfo`, `wmi`, `windows`, `nvml-wrapper`, `nvapi-sys` — packages whose API/behavior directly affects Windows collection and hardware identity. Major/minor jumps with migration notes should remain isolated when practical rather than being hidden in one group.
- **tauri-runtime:** `tauri`, `tauri-build`, `tauri-plugin-*` — framework packages that should be reviewed against matching JS packages.
- **rust-foundation:** `serde`, `serde_json`, `chrono` and similarly low-risk foundation packages — may be grouped when they do not require an API migration.

### npm app

- **react-framework:** `react`, `react-dom`, `@types/react`, `@types/react-dom` — move coherently.
- **tauri-js:** `@tauri-apps/api`, `@tauri-apps/plugin-*`, `@tauri-apps/cli` where peer compatibility requires coordination.
- **build-tooling:** Vite/plugin-react/TypeScript — major migrations should be isolated or tightly grouped only when peer requirements make them inseparable.
- **test-dom-tooling:** jsdom and test-only packages — keep separate from production build framework majors.
- **ui-libraries:** Recharts/Lucide/dnd-kit family — group only when peer-compatible and behaviorally independent of a framework major.

Dependabot grouping is a maintenance aid, not an excuse to merge incompatible majors together. The executor may use `groups`, `patterns`, `exclude-patterns`, and update-type filters to achieve the smallest practical review units.

## D3. Rust toolchain floor is deliberate

The repository currently pins Rust 1.93.1. The selected target `sysinfo 0.39.x` documents Rust 1.95 as its MSRV. If `sysinfo 0.39.x` is adopted, update `rust-toolchain.toml` to at least the required supported version and keep CI/local docs/cache behavior coherent.

Do not independently add an arbitrary `rust-version` floor to Cargo.toml unless the executor decides the project needs a separate compiler floor policy and documents why. For this application repository, the pinned toolchain is the build truth today; avoid inventing a second conflicting source of truth.

If another selected dependency requires a higher Rust version than sysinfo, choose the highest actually required floor, document it, and prove the full feature matrix on that version.

## D4. WMI migration preserves thread/boot semantics

Current code constructs WMI through `COMLibrary` inside `WmiBootstrap`. WMI 0.18's normal path is `WMIConnection::new()`, which can initialize COM itself. The migration SHALL preserve these app-level invariants regardless of the exact upstream API:

- construction happens on the collector session thread;
- the `WMIConnection` never crosses threads (`!Send`/`!Sync` is an intentional constraint, not something to work around unsafely);
- core PDH/sysinfo emission begins before optional WMI enrichment;
- failed initialization retries remain bounded with exponential backoff and diagnostic logging;
- successful connection stays session-owned and is rebuilt after supervised session replacement;
- WMI failure leaves PDH-discovered devices visible with conservative metadata.

Preferred implementation: adapt `WmiBootstrap::poll()` to the supported 0.18 constructor and retain the existing scheduling/backoff wrapper. Do not add unsafe COM shims unless upstream behavior genuinely requires it and the safety contract is documented/tested.

## D5. sysinfo migration is behavior-tested, not type-fixed

The migration must inspect the upstream migration guide across every skipped version from 0.33 to the chosen target. Adapt APIs with the smallest semantic delta.

Behavior to pin with focused tests/probes:

- CPU brand/vendor projection remains equivalent;
- disk physical keys/names/kinds remain stable enough for persisted card/sidebar identity;
- network delta baselines do not aggregate startup/recovery downtime into spikes;
- refresh intervals remain compatible with sysinfo minimum CPU update requirements;
- no fresh `System`/`Disks` enumeration is reintroduced on each tick/session path after the prior startup optimization;
- empty/unavailable platform data degrades safely.

When upstream behavior intentionally changes and exact equivalence is impossible, update the stable-identity/time-fidelity spec first and prove the new invariant rather than silently accepting drift.

## D6. windows-rs and PDH remain a safety boundary

The windows-rs upgrade must preserve:

- feature flags required by the PDH wrapper;
- all raw handle lifetime/return-code checks;
- documented unsafe blocks and buffer sizing;
- the one-collection-per-relevant-tick assumptions already enforced by cadence tests;
- no new unchecked conversions or pointer lifetime assumptions.

Run clippy with all features and the PDH/cadence tests immediately after this migration, before stacking frontend work.

## D7. NVML/NVAPI telemetry remains fail-closed

`nvml-wrapper` migration must preserve exact/unique device association:

- UUID/PCI identity wins;
- normalized display-name fallback is accepted only when unique on both sides;
- duplicate/ambiguous Nvidia adapters receive unavailable telemetry rather than another card's values;
- NVAPI fallback never broadcasts a single reading to multiple adapters;
- missing driver/library remains a graceful `None`, not a crash.

Do not weaken the duplicate-device tests just because only one physical GPU is available on the execution machine.

## D8. Tauri is a cross-language compatibility boundary

Treat these as one compatibility domain even if commits are staged:

- Rust `tauri`, `tauri-build`, `tauri-plugin-store`;
- JS `@tauri-apps/api`, `@tauri-apps/plugin-store`, `@tauri-apps/cli`.

Required behavioral seams:

- `get_history`, `get_hardware_profile`, `get_collector_status`, `retry_collection`, `sim_store_override` command invocation;
- `metrics-update`, `collector-status`, `collector-error`, `hardware-profile-ready` event delivery and cleanup;
- typed Tauri managed-state resolution for StopFlag/RetryRequest;
- store load/migrate/save queue/future-version failure;
- absolute simulation store override and developer-store byte isolation;
- build/no-bundle and MSI/NSIS bundling.

If upstream Tauri introduces config schema changes, update `tauri.conf.json`, capabilities and docs minimally and verify the same security boundary. Do not broaden capabilities for convenience.

## D9. React 19 is isolated from build-tooling migration

React + React DOM + matching types move together in a dedicated step before or after Tauri alignment, but not buried inside Vite/TypeScript work.

Qualification focuses on:

- StrictMode effect setup/cleanup does not duplicate subscriptions or simulation backends;
- async `listen()` promises are unregistered on unmount;
- stale `get_collector_status` bootstrap cannot overwrite a newer event;
- settings provider remains singleton in production;
- retry button coalescing/pending UX remains correct;
- dnd-kit keyboard and pointer flows remain functional;
- Recharts cards do not enter render loops or lose memoization benefits;
- error boundaries and loading/error states still surface failures.

No React 19-only feature adoption is required. This is a compatibility migration.

## D10. Vite/TypeScript/jsdom migration is staged by failure attribution

Vite 8 supports Node 24, so keep Node 24 unless a selected tool demonstrates a stronger requirement. Prefer this order unless peer constraints require a documented variation:

1. Vite + `@vitejs/plugin-react` compatible pair;
2. TypeScript 7 and necessary tsconfig/type fixes;
3. jsdom 30/test-environment adjustments;
4. `@types/node` matching the actual Node runtime surface.

After each stage run at least typecheck + unit tests + build. Avoid mixing formatting/refactoring with compiler-driven fixes so the migration diff remains reviewable.

## D11. “Current latest” is not an acceptance criterion

For each dependency domain the executor SHALL choose one of:

- **Adopted:** target version is supported and fully qualified.
- **Pinned/deferred:** newer target has a concrete incompatibility, unsupported platform/runtime constraint, regression, or disproportionate migration cost. Record exact reason, evidence and revisit trigger.
- **Superseded:** the generated Dependabot PR is made obsolete by an intentional coherent migration.

A campaign can succeed with a justified deferral. It cannot succeed with an unexplained stale PR queue.

## D12. Validation escalates with risk

### Tier 1 — after every coherent stage

- `npm ci` / lockfile consistency as relevant;
- Rust targeted tests or TS typecheck/unit tests;
- formatting/lint for changed language;
- build of the changed surface.

### Tier 2 — after each runtime/framework domain

- canonical `verify:rust` or `verify:frontend`;
- E2E/mock simulation when frontend/Tauri behavior moved;
- startup/cadence/identity targeted checks when collector dependencies moved.

### Tier 3 — final local Windows qualification

- `npm run verify:full`;
- `npm run verify:packaged`;
- selected `sim:real` journeys covering customization round-trip, sidebar relaunch, restart soak, recovery/lifecycle and normal metrics advancement;
- strict OpenSpec validation and `git diff --check`.

### Tier 4 — hosted qualification

- required PR workflows green;
- packaged simulation dispatch green;
- release qualification MSI + NSIS green when dispatch is available;
- inspect workflow annotations/deprecation warnings rather than ignoring a nominal success.

## D13. Schema versions change only for serialized contract changes

Dependency upgrades alone do not justify bumping:

- metrics `SCHEMA_VERSION = 5` / TS expected 5;
- lifecycle schema 1;
- settings schema 2.

If upstream migration forces a serialized field/type/meaning change, first create an explicit OpenSpec delta and migration tests. Never bump a version merely to “make things match.”

## D14. PR/branch strategy

Use one campaign branch from latest `origin/main`, recommended:

`agent/monitorers-dependency-runtime-modernization`

Within it, use coherent commits per compatibility domain so any regression can be bisected/reverted. Do not merge the existing generated dependency PR branches into the campaign branch wholesale. Reproduce desired version changes intentionally in the campaign branch, or selectively cherry-pick only if the diff is verified and remains coherent.

At completion, document disposition of PRs #20–#27 (and any refreshed Dependabot replacements). If the executor cannot close superseded PRs through its environment, list exact recommended close/rebase actions in evidence rather than leaving ambiguity.

## Risks and mitigations

- **Risk: compiler/toolchain bump causes transitive diagnostic churn.** Mitigation: compiler floor first, full Rust feature matrix before stacking more changes.
- **Risk: WMI starts blocking or runs on wrong thread.** Mitigation: retain WmiBootstrap/session ownership and first-emission tests/probes.
- **Risk: device identity silently changes.** Mitigation: stable-identity fixtures plus packaged hardware discovery comparison.
- **Risk: React/StrictMode doubles subscriptions.** Mitigation: existing hook tests + simulation/e2e + targeted listener-count assertions if a gap is discovered.
- **Risk: huge migration diff becomes unreviewable.** Mitigation: compatibility-domain commits and Dependabot policy decomposition.
- **Risk: hosted runner behavior differs from local Windows.** Mitigation: required hosted Windows and release qualification evidence.
- **Risk: dependency update itself introduces vulnerability.** Mitigation: cargo/npm audits remain mandatory and lockfile diffs are reviewed.

## Migration/rollback plan

1. Create campaign branch from current main and record baseline.
2. Land policy decomposition and OpenSpec-only setup first.
3. Migrate compatibility domains in ordered commits with gates after each.
4. If a domain cannot be qualified, revert that domain's commit(s), record a pinned/deferred disposition, and continue only if the remaining stack is coherent.
5. Run final packaged/release qualification.
6. Re-audit changed surfaces, reconcile docs/PR queue, archive the OpenSpec change only after all completion gates are met.
