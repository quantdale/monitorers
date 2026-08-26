# Tasks — Dependency Runtime Modernization and Qualification

> Executor rule: work top-to-bottom unless a real dependency/peer constraint requires a documented reorder. Never skip a failing gate to advance to the next workstream.

## 0. Campaign bootstrap and safety

- [ ] 0.1 Fetch/prune remotes and create `agent/monitorers-dependency-runtime-modernization` from the latest `origin/main`. Record both the planned baseline `46ee499ab934663c4e0807f7ab8e995707b77471` and the actual execution baseline if main advanced.
- [ ] 0.2 Confirm working tree is clean before adopting any generated dependency changes. Do not merge/cherry-pick an entire Dependabot branch without first reviewing its exact diff and compatibility scope.
- [ ] 0.3 Read `audit.md`, `proposal.md`, `design.md`, all delta specs in this change, root `AGENTS.md`, `.agent/EXECUTION_PROMPT.md`, `progress.md`, current package manifests/toolchain, and the latest archived PR #29 change.
- [ ] 0.4 Inventory every currently open dependency PR: PR number, package(s), from→to, base/head SHA, mergeability, CI state, and whether the campaign intends Adopt / Supersede / Defer. Refresh this list if Dependabot recreated PRs after planning.
- [ ] 0.5 Research upstream migration/release notes for every major/API-changing target. At minimum cover the full skipped-version ranges for sysinfo 0.33→target, WMI 0.13→target, windows-rs, nvml-wrapper, React 18→19, Vite 6→8, plugin-react 4→6, TypeScript 5→7, jsdom 25→30, Tauri v2 point releases/plugins/CLI. Save source links and compatibility conclusions in `evidence.md`.
- [ ] 0.6 Record runtime floors/peer constraints: Rust MSRV, Node engine ranges, package peer dependencies, Windows/Tauri support. No target version may be selected from Dependabot metadata alone.

## 1. Baseline qualification before dependency changes

- [ ] 1.1 From `sys-monitor-tauri/`, run `npm ci` and the canonical local full gate (`npm run verify:full`) on the execution baseline. Record exact commands, versions, durations and failures if any.
- [ ] 1.2 Run strict OpenSpec validation (`openspec validate --all --strict --no-interactive`, or the repository-equivalent command if CLI syntax changed) and `git diff --check`.
- [ ] 1.3 On a qualifying Windows host, build/locate the production executable and run `npm run verify:packaged`. Preserve the resulting baseline artifact/evidence paths.
- [ ] 1.4 Run focused collector baselines: startup probe, cadence probe/checker over the documented qualifying interval, stable identity/NVML fixture tests, WMI bootstrap tests, and collector supervisor tests. Record enough output to compare after migration.
- [ ] 1.5 If baseline is not green, stop treating failures as migration regressions: triage first, fix only genuine pre-existing Critical/High/P1/P2 blockers in a separate clearly identified commit, and record why the baseline changed.

## 2. Dependabot policy decomposition

- [ ] 2.1 Replace the broad Cargo `rust-dependencies: "*"` grouping with compatibility-domain grouping per `design.md` D2. Ensure collector-platform majors are not silently coupled with serialization/framework patches.
- [ ] 2.2 Replace the broad frontend `frontend-tooling` group with reviewable domains. React/DOM/types must be coherent; Vite/plugin-react/TypeScript majors must not be bundled with unrelated jsdom/Node-type churn unless a peer dependency explicitly requires it.
- [ ] 2.3 Preserve monthly cadence/open-PR limits unless evidence justifies changing them. Do not create noisy daily update churn as part of this campaign.
- [ ] 2.4 Preserve GitHub Actions dependency management and immutable full-SHA pin policy.
- [ ] 2.5 Validate the Dependabot YAML syntax and document example future PR partitioning in evidence so maintainers can tell the policy changed as intended.
- [ ] 2.6 Commit this workstream separately before runtime migrations so policy changes remain independently reviewable/revertible.

## 3. Rust compiler/toolchain floor

- [ ] 3.1 Determine the highest actual Rust floor required by the selected Rust targets. If adopting sysinfo 0.39.x, account for its documented Rust 1.95 MSRV.
- [ ] 3.2 Update `src-tauri/rust-toolchain.toml` deliberately. Keep `rustfmt` and `clippy` components and the minimal profile.
- [ ] 3.3 Review every workflow/cache/doc that references the toolchain. Cargo cache keys already include `rust-toolchain.toml`; verify no stale hardcoded version remains in agent docs or CI.
- [ ] 3.4 Run `rustc --version`, `cargo fmt -- --check`, a minimal compile, and the full Rust gate before stacking collector API migrations if the lockfile permits it; otherwise combine only the minimum dependency edit needed to prove the selected toolchain.
- [ ] 3.5 Do not add a second conflicting MSRV truth source unless there is a documented repository policy reason.

## 4. sysinfo migration — CPU/disk/network/runtime semantics

- [ ] 4.1 Upgrade sysinfo in an isolated coherent commit/working stage and apply the official migration guide across every skipped release.
- [ ] 4.2 Adapt CPU refresh/brand APIs while preserving `CpuIdentity` semantics, startup enumeration de-duplication and the prior measured startup optimization.
- [ ] 4.3 Adapt disk enumeration/kind APIs while preserving stable keys/names and physical-disk projection used by dashboard/sidebar persistence.
- [ ] 4.4 Adapt network refresh/delta APIs while preserving explicit elapsed-time normalization, counter-reset safety and recovery baseline reset. No startup/recovery gap may become one fabricated throughput spike.
- [ ] 4.5 Search for every sysinfo API use across source, examples, tests and probes; do not fix only the first compiler errors.
- [ ] 4.6 Add/update regression tests only when upstream API semantics require it; never weaken existing stable-identity/time-fidelity assertions.
- [ ] 4.7 Run focused Rust tests, startup probe and canonical `verify:rust`; compare startup/cadence behavior with baseline.

## 5. WMI 0.18 migration — COM/thread/bootstrap semantics

- [ ] 5.1 Replace the obsolete/currently incompatible COM construction path with the supported WMI target API. Prefer `WMIConnection::new()` when using WMI 0.18's managed COM initialization behavior unless upstream docs and this app's thread model require explicit COM ownership.
- [ ] 5.2 Preserve `WmiBootstrap` as the scheduling/backoff owner: non-blocking first core snapshot, max-attempt budget, exponential backoff, per-attempt diagnostics, session-local connection.
- [ ] 5.3 Prove the WMI connection stays on the collector session thread and is never forced through unsafe Send/Sync workarounds.
- [ ] 5.4 Verify GPU vendor-map queries, VideoController captions, WMI failure fallback and late enrichment still work.
- [ ] 5.5 Add/update tests around bootstrap success/failure/retry boundaries using pure/injectable seams where practical. Do not introduce fixed sleeps when deterministic clocks/state can test the policy.
- [ ] 5.6 Run collector tests, full Rust feature matrix, startup probe, and a packaged real-app smoke on Windows to prove real WMI behavior.

## 6. windows-rs / PDH migration

- [ ] 6.1 Upgrade windows-rs to the selected compatible version and update feature names/imports only as required.
- [ ] 6.2 Audit every affected unsafe block and FFI call in the PDH layer: handle creation/close, buffer sizing, status codes, counter arrays, pointer lifetimes and conversions.
- [ ] 6.3 Preserve “one collect per applicable tick” and counter-baseline behavior; do not accidentally add extra PDH collection through an API adaptation.
- [ ] 6.4 Run PDH parsing/unit tests, cadence tests/checker, clippy `-D warnings`, all features and the packaged real collector smoke.

## 7. NVML / Nvidia telemetry migration

- [ ] 7.1 Upgrade `nvml-wrapper` (and transitive/direct Nvidia dependency configuration only as required) without changing the existing identity policy.
- [ ] 7.2 Adapt device count/index/name/UUID/PCI/memory/temp/power/fan/clock APIs as required by upstream changes.
- [ ] 7.3 Keep exact/unique matching semantics: UUID/PCI first; name only when unique on both sides; ambiguous duplicate devices receive no foreign telemetry.
- [ ] 7.4 Preserve NVAPI fallback behavior for feature configurations without NVML; do not regress no-driver/no-GPU graceful behavior.
- [ ] 7.5 Run the full feature matrix: default, `--no-default-features`, nvapi-only, nvml-only, all-features, plus targeted duplicate-name/identity tests.
- [ ] 7.6 If qualifying multi-Nvidia hardware is unavailable, explicitly state that runtime dual-identical-GPU physical proof remains exploratory; never convert fixture success into a physical-hardware claim.

## 8. Remaining Rust foundation + Tauri runtime alignment

- [ ] 8.1 Upgrade low-risk foundation crates (`serde`, `serde_json`, `chrono`) separately or as one low-risk foundation commit after collector-platform migrations are green.
- [ ] 8.2 Select mutually compatible Rust Tauri, `tauri-build`, `tauri-plugin-store`, JS `@tauri-apps/api`, JS plugin-store and Tauri CLI versions using upstream compatibility guidance.
- [ ] 8.3 Migrate Rust Tauri/build/plugin APIs and config only where required. Preserve app capability boundaries; do not broaden permissions to solve migration errors.
- [ ] 8.4 Re-run managed-state seam tests proving StopFlag and RetryRequest remain distinct types and manual Retry never sets shutdown.
- [ ] 8.5 Re-run command/event contract tests and frontend hook tests for history/status/retry/hardware-profile events.
- [ ] 8.6 Re-run settings migration/save queue/future-version tests and the packaged simulation developer-store isolation self-test.
- [ ] 8.7 Build the production executable and both installer formats (or use the canonical qualification workflow when local bundling is intentionally hosted-only).

## 9. React 19 framework migration

- [ ] 9.1 Upgrade `react`, `react-dom`, `@types/react`, `@types/react-dom` as one coherent framework migration. Do not leave React and React DOM on mismatched majors.
- [ ] 9.2 Resolve type/runtime changes minimally. Do not adopt new React features merely because the major changed.
- [ ] 9.3 Audit every effect/subscription path under StrictMode, especially `useMetrics`, `useHardwareProfile`, settings initialization and simulation backend start/stop.
- [ ] 9.4 Prove listener cleanup: no duplicate `metrics-update`, `collector-status`, `collector-error` or hardware-profile subscriptions after remounts.
- [ ] 9.5 Prove lifecycle bootstrap fencing still rejects an older fetched status after a newer event lands.
- [ ] 9.6 Run dnd-kit keyboard and pointer reorder tests; preserve accessible drag behavior and saved ordering.
- [ ] 9.7 Run Recharts/card rendering tests and, if practical, repeat the lightweight render-fanout diagnostic used by the prior performance campaign to detect an obvious React-major regression. Do not create a performance rewrite if metrics remain within normal variance.
- [ ] 9.8 Run `verify:frontend`, E2E and mock simulation before adding build-tooling majors.

## 10. Vite / plugin-react / TypeScript 7 / jsdom 30 tooling migration

- [ ] 10.1 Upgrade Vite and `@vitejs/plugin-react` as a documented compatible pair. Preserve strict dev port, Tauri dev/build integration and existing production bundle semantics.
- [ ] 10.2 Upgrade TypeScript to the selected 7.x version. Review release/migration notes and resolve new diagnostics intentionally; no `any`, `@ts-ignore`, config broadening or disabled strictness merely to silence the compiler.
- [ ] 10.3 Inspect all tsconfig files, including E2E/simulation configs, for removed/deprecated options or changed module-resolution defaults. Keep browser/Tauri and Node test contexts distinct where required.
- [ ] 10.4 Upgrade jsdom to 30.x independently enough that DOM/test-environment regressions can be attributed. Fix tests only when they relied on behavior contrary to the browser/runtime contract.
- [ ] 10.5 Align `@types/node` to the real supported Node 24 runtime surface unless upstream peer constraints require another compatible range. Do not change CI Node major without evidence.
- [ ] 10.6 Run `npm ci`, `npx tsc --noEmit`, Vitest, production build, E2E, sim typecheck and full mock simulation.
- [ ] 10.7 Inspect generated lockfile changes for unexpected duplicated framework/tool versions or surprising transitive native packages.

## 11. Remaining UI/data dependencies

- [ ] 11.1 Evaluate Recharts target update after React/tooling are stable. Run chart rendering/history-window tests and visually/structurally verify axis/domain/tooltips still behave under the existing test harness.
- [ ] 11.2 Evaluate Lucide update; verify changed icon package does not alter accessible button labeling or bundle/build behavior.
- [ ] 11.3 Evaluate JS plugin-store/Tauri API leftovers already covered by Tauri alignment; avoid duplicate/version-skewed updates.
- [ ] 11.4 For every other open dependency PR discovered in 0.4, assign Adopt/Supersede/Defer with evidence. Nothing may remain “forgotten.”

## 12. CI and release maintenance exposed by migration

- [ ] 12.1 Audit all workflow action versions/annotations after hosted runs. Preserve full commit-SHA pins.
- [ ] 12.2 If `actions/download-artifact` or another action still emits a Node-runtime deprecation warning and a compatible supported release exists, update it with a full SHA and verify behavior. Do not churn unrelated Actions without a real warning/security/support reason.
- [ ] 12.3 Ensure cargo/npm caches include every input needed after toolchain/lockfile changes and do not accidentally restore incompatible target state.
- [ ] 12.4 Keep `cargo-audit@0.22.1` semantics mandatory unless a separate evidence-backed tool-version update is required; an install or advisory failure must remain blocking.

## 13. Full behavioral qualification

- [ ] 13.1 Run final `npm run verify:full` from a clean install state. Record complete command outcome and relevant test counts as runner output only; do not hardcode counts into durable docs.
- [ ] 13.2 Run `npm run verify:packaged` against the final built executable on Windows.
- [ ] 13.3 Run the full mock simulation matrix.
- [ ] 13.4 Run packaged real journeys at minimum covering: healthy metrics advancement, customization/settings roundtrip, sidebar relaunch persistence, bounded restart soak, recovery/lifecycle bootstrap/retry behavior. Use existing journey IDs exactly as registered; if names changed, document equivalents.
- [ ] 13.5 Re-run qualifying cadence probe/checker and compare against baseline SLOs: 250 ms live target, 4:1 full-tick ratio, approximately 1 Hz history, no catch-up burst, truthful elapsed timestamps.
- [ ] 13.6 Compare hardware profile/device keys across baseline/final on the available machine. Investigate any unexplained key/name/count drift before declaring success.
- [ ] 13.7 Validate settings store JSON remains valid through restart soak and the developer's real store remains byte-identical during isolated packaged simulation.
- [ ] 13.8 Run strict OpenSpec validation and `git diff --check` at final head.

## 14. Hosted CI/release qualification

- [ ] 14.1 Push the campaign branch and obtain green required Rust/frontend/E2E/mock simulation/production-executable workflows at the final candidate SHA.
- [ ] 14.2 Trigger the packaged real-app simulation dispatch and archive run IDs/artifact names/results.
- [ ] 14.3 Trigger release qualification for MSI and NSIS when repository permissions/workflow design permit it; both install/run/uninstall flows must pass.
- [ ] 14.4 Inspect annotations and logs even when workflows are green; address new deprecations, unsupported-runtime warnings, cache corruption, test retries or suspicious skips introduced by the migration.
- [ ] 14.5 Never mark hosted qualification complete from an older SHA. Every cited run must correspond to the final or explicitly equivalent head.

## 15. Post-migration deep review

- [ ] 15.1 Re-read every changed source/config/test/workflow file and its immediate behavioral caller/callee. Search for TODO/FIXME/HACK, new unwrap/panic/unsafe, suppressed TypeScript/Rust diagnostics and disabled tests introduced during migration.
- [ ] 15.2 Re-audit collector startup/WMI, stable identity, NVML association, Tauri managed state, settings store, async frontend subscriptions, simulation isolation and workflow security as the highest-risk seams.
- [ ] 15.3 Fix every introduced Critical/High/P1/P2 issue with regression coverage before completion. Lower-priority ideas may be documented only when they are genuinely non-blocking.
- [ ] 15.4 Review the full dependency/lockfile diff for accidental downgrades, duplicate majors, abandoned packages or newly fixable advisories.

## 16. Repository truth and Dependabot queue reconciliation

- [ ] 16.1 Update `progress.md` with final supported Rust/Node/framework/runtime versions, major migration decisions, evidence links/run IDs, remaining intentional deferrals and physical-hardware limits.
- [ ] 16.2 Update `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, README or other tracked docs only where version/build/test truth actually changed. Avoid duplicating details already owned by OpenSpec.
- [ ] 16.3 Record final disposition of every dependency PR present at campaign start plus replacements created during execution: merged/superseded/closed/deferred/rebase-needed and exact reason.
- [ ] 16.4 Close or supersede stale generated PRs through available GitHub tooling when authorized. If that action is unavailable, produce a precise maintainer action list in evidence.
- [ ] 16.5 Ensure no doc still says “no actionable work” while an active campaign remains incomplete, and no doc says the campaign is active after it is archived/merged.

## 17. Completion and archive

- [ ] 17.1 Fill `evidence.md` with upstream references, before/after version matrix, commands, test/probe results, hosted run IDs, migration decisions, PR dispositions, limitations and any deferred targets.
- [ ] 17.2 Verify every task checkbox truthfully. Do not mark a hardware-only or hosted step complete without actual evidence; use explicit N/A/blocked evidence and keep the campaign open if the requirement is mandatory.
- [ ] 17.3 Sync delta specs into canonical specs using the repository OpenSpec workflow, then run strict validation.
- [ ] 17.4 Archive `dependency-runtime-modernization-and-qualification` only after all mandatory completion gates are met and evidence is final.
- [ ] 17.5 Final detailed commit/report must name start SHA → final SHA, dependency version matrix, key source migrations, test/qualification results, introduced defects fixed, remaining limitations and Dependabot PR disposition.
- [ ] 17.6 Push all commits. Leave the branch clean and remote-visible so the planner/user can inspect it without local-only state.
