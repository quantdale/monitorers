# Tasks — Dependency Runtime Modernization and Qualification

> Executor rule: work top-to-bottom unless a real dependency/peer constraint requires a documented reorder. Never skip a failing gate to advance to the next workstream.

## 0. Campaign bootstrap and safety

- [x] 0.1 Fetch/prune remotes and create `agent/monitorers-dependency-runtime-modernization` from the latest `origin/main`. Record both the planned baseline `46ee499ab934663c4e0807f7ab8e995707b77471` and the actual execution baseline if main advanced.
- [x] 0.2 Confirm working tree is clean before adopting any generated dependency changes. Do not merge/cherry-pick an entire Dependabot branch without first reviewing its exact diff and compatibility scope.
- [x] 0.3 Read `audit.md`, `proposal.md`, `design.md`, all delta specs in this change, root `AGENTS.md`, `.agent/EXECUTION_PROMPT.md`, `progress.md`, current package manifests/toolchain, and the latest archived PR #29 change.
- [x] 0.4 Inventory every currently open dependency PR: PR number, package(s), from→to, base/head SHA, mergeability, CI state, and whether the campaign intends Adopt / Supersede / Defer. Refresh this list if Dependabot recreated PRs after planning.
- [x] 0.5 Research upstream migration/release notes for every major/API-changing target. At minimum cover the full skipped-version ranges for sysinfo 0.33→target, WMI 0.13→target, windows-rs, nvml-wrapper, React 18→19, Vite 6→8, plugin-react 4→6, TypeScript 5→7, jsdom 25→30, Tauri v2 point releases/plugins/CLI. Save source links and compatibility conclusions in `evidence.md`.
- [x] 0.6 Record runtime floors/peer constraints: Rust MSRV, Node engine ranges, package peer dependencies, Windows/Tauri support. No target version may be selected from Dependabot metadata alone.

## Reconciliation (2026-10-08) — executor-independent verification

The original executor never reconciled these checkboxes (recorded in
`evidence.md` F: "left that way deliberately"). They were reconciled on
2026-10-08 against evidence rather than memory:

- **Sections 0-13** are marked complete on the strength of the stage evidence
  already recorded in `evidence.md` A-E plus the commits `acfe6a5 .. 3840e73`,
  which were re-read for this reconciliation (diff `46ee499..2e56ffc`).
- **Section 14** was re-verified from scratch with `gh run view <id> --json
  status,conclusion,headSha`: all four runs are `completed`/`success` at
  `2e56ffc17ff2d97203e74b29009e30c9a47eab20` — see `evidence.md` J.
- **Section 15** was executed as a fresh adversarial review on 2026-10-08 and
  its findings recorded in `evidence.md` J. 9.7's fan-out invariant is now
  covered by a new regression test (`src/components/MetricCard.test.tsx`).
- **Deliberately NOT marked complete** (mandatory requirements that the
  available evidence cannot satisfy, per 17.2):
  - **7.6** and **13.6** — physical dual-identical-GPU runtime proof. This host
    has one physical Nvidia GPU plus an Intel iGPU; fixtures are not physical
    proof (`evidence.md` I).
  - **16.4** — closing stale generated PRs. The queue was refreshed and is
    dispositioned in the successor dependency-queue campaign, not here.

## 1. Baseline qualification before dependency changes

- [x] 1.1 From `sys-monitor-tauri/`, run `npm ci` and the canonical local full gate (`npm run verify:full`) on the execution baseline. Record exact commands, versions, durations and failures if any.
- [x] 1.2 Run strict OpenSpec validation (`openspec validate --all --strict --no-interactive`, or the repository-equivalent command if CLI syntax changed) and `git diff --check`.
- [x] 1.3 On a qualifying Windows host, build/locate the production executable and run `npm run verify:packaged`. Preserve the resulting baseline artifact/evidence paths.
- [x] 1.4 Run focused collector baselines: startup probe, cadence probe/checker over the documented qualifying interval, stable identity/NVML fixture tests, WMI bootstrap tests, and collector supervisor tests. Record enough output to compare after migration.
- [x] 1.5 If baseline is not green, stop treating failures as migration regressions: triage first, fix only genuine pre-existing Critical/High/P1/P2 blockers in a separate clearly identified commit, and record why the baseline changed.

## 2. Dependabot policy decomposition

- [x] 2.1 Replace the broad Cargo `rust-dependencies: "*"` grouping with compatibility-domain grouping per `design.md` D2. Ensure collector-platform majors are not silently coupled with serialization/framework patches.
- [x] 2.2 Replace the broad frontend `frontend-tooling` group with reviewable domains. React/DOM/types must be coherent; Vite/plugin-react/TypeScript majors must not be bundled with unrelated jsdom/Node-type churn unless a peer dependency explicitly requires it.
- [x] 2.3 Preserve monthly cadence/open-PR limits unless evidence justifies changing them. Do not create noisy daily update churn as part of this campaign.
- [x] 2.4 Preserve GitHub Actions dependency management and immutable full-SHA pin policy.
- [x] 2.5 Validate the Dependabot YAML syntax and document example future PR partitioning in evidence so maintainers can tell the policy changed as intended.
- [x] 2.6 Commit this workstream separately before runtime migrations so policy changes remain independently reviewable/revertible.

## 3. Rust compiler/toolchain floor

- [x] 3.1 Determine the highest actual Rust floor required by the selected Rust targets. If adopting sysinfo 0.39.x, account for its documented Rust 1.95 MSRV.
- [x] 3.2 Update `src-tauri/rust-toolchain.toml` deliberately. Keep `rustfmt` and `clippy` components and the minimal profile.
- [x] 3.3 Review every workflow/cache/doc that references the toolchain. Cargo cache keys already include `rust-toolchain.toml`; verify no stale hardcoded version remains in agent docs or CI.
- [x] 3.4 Run `rustc --version`, `cargo fmt -- --check`, a minimal compile, and the full Rust gate before stacking collector API migrations if the lockfile permits it; otherwise combine only the minimum dependency edit needed to prove the selected toolchain.
- [x] 3.5 Do not add a second conflicting MSRV truth source unless there is a documented repository policy reason.

## 4. sysinfo migration — CPU/disk/network/runtime semantics

- [x] 4.1 Upgrade sysinfo in an isolated coherent commit/working stage and apply the official migration guide across every skipped release.
- [x] 4.2 Adapt CPU refresh/brand APIs while preserving `CpuIdentity` semantics, startup enumeration de-duplication and the prior measured startup optimization.
- [x] 4.3 Adapt disk enumeration/kind APIs while preserving stable keys/names and physical-disk projection used by dashboard/sidebar persistence.
- [x] 4.4 Adapt network refresh/delta APIs while preserving explicit elapsed-time normalization, counter-reset safety and recovery baseline reset. No startup/recovery gap may become one fabricated throughput spike.
- [x] 4.5 Search for every sysinfo API use across source, examples, tests and probes; do not fix only the first compiler errors.
- [x] 4.6 Add/update regression tests only when upstream API semantics require it; never weaken existing stable-identity/time-fidelity assertions.
- [x] 4.7 Run focused Rust tests, startup probe and canonical `verify:rust`; compare startup/cadence behavior with baseline.

## 5. WMI 0.18 migration — COM/thread/bootstrap semantics

- [x] 5.1 Replace the obsolete/currently incompatible COM construction path with the supported WMI target API. Prefer `WMIConnection::new()` when using WMI 0.18's managed COM initialization behavior unless upstream docs and this app's thread model require explicit COM ownership.
- [x] 5.2 Preserve `WmiBootstrap` as the scheduling/backoff owner: non-blocking first core snapshot, max-attempt budget, exponential backoff, per-attempt diagnostics, session-local connection.
- [x] 5.3 Prove the WMI connection stays on the collector session thread and is never forced through unsafe Send/Sync workarounds.
- [x] 5.4 Verify GPU vendor-map queries, VideoController captions, WMI failure fallback and late enrichment still work.
- [x] 5.5 Add/update tests around bootstrap success/failure/retry boundaries using pure/injectable seams where practical. Do not introduce fixed sleeps when deterministic clocks/state can test the policy.
- [x] 5.6 Run collector tests, full Rust feature matrix, startup probe, and a packaged real-app smoke on Windows to prove real WMI behavior.

## 6. windows-rs / PDH migration

- [x] 6.1 Upgrade windows-rs to the selected compatible version and update feature names/imports only as required.
- [x] 6.2 Audit every affected unsafe block and FFI call in the PDH layer: handle creation/close, buffer sizing, status codes, counter arrays, pointer lifetimes and conversions.
- [x] 6.3 Preserve “one collect per applicable tick” and counter-baseline behavior; do not accidentally add extra PDH collection through an API adaptation.
- [x] 6.4 Run PDH parsing/unit tests, cadence tests/checker, clippy `-D warnings`, all features and the packaged real collector smoke.

## 7. NVML / Nvidia telemetry migration

- [x] 7.1 Upgrade `nvml-wrapper` (and transitive/direct Nvidia dependency configuration only as required) without changing the existing identity policy.
- [x] 7.2 Adapt device count/index/name/UUID/PCI/memory/temp/power/fan/clock APIs as required by upstream changes.
- [x] 7.3 Keep exact/unique matching semantics: UUID/PCI first; name only when unique on both sides; ambiguous duplicate devices receive no foreign telemetry.
- [x] 7.4 Preserve NVAPI fallback behavior for feature configurations without NVML; do not regress no-driver/no-GPU graceful behavior.
- [x] 7.5 Run the full feature matrix: default, `--no-default-features`, nvapi-only, nvml-only, all-features, plus targeted duplicate-name/identity tests.
- [ ] 7.6 If qualifying multi-Nvidia hardware is unavailable, explicitly state that runtime dual-identical-GPU physical proof remains exploratory; never convert fixture success into a physical-hardware claim.

## 8. Remaining Rust foundation + Tauri runtime alignment

- [x] 8.1 Upgrade low-risk foundation crates (`serde`, `serde_json`, `chrono`) separately or as one low-risk foundation commit after collector-platform migrations are green.
- [x] 8.2 Select mutually compatible Rust Tauri, `tauri-build`, `tauri-plugin-store`, JS `@tauri-apps/api`, JS plugin-store and Tauri CLI versions using upstream compatibility guidance.
- [x] 8.3 Migrate Rust Tauri/build/plugin APIs and config only where required. Preserve app capability boundaries; do not broaden permissions to solve migration errors.
- [x] 8.4 Re-run managed-state seam tests proving StopFlag and RetryRequest remain distinct types and manual Retry never sets shutdown.
- [x] 8.5 Re-run command/event contract tests and frontend hook tests for history/status/retry/hardware-profile events.
- [x] 8.6 Re-run settings migration/save queue/future-version tests and the packaged simulation developer-store isolation self-test.
- [x] 8.7 Build the production executable and both installer formats (or use the canonical qualification workflow when local bundling is intentionally hosted-only).

## 9. React 19 framework migration

- [x] 9.1 Upgrade `react`, `react-dom`, `@types/react`, `@types/react-dom` as one coherent framework migration. Do not leave React and React DOM on mismatched majors.
- [x] 9.2 Resolve type/runtime changes minimally. Do not adopt new React features merely because the major changed.
- [x] 9.3 Audit every effect/subscription path under StrictMode, especially `useMetrics`, `useHardwareProfile`, settings initialization and simulation backend start/stop.
- [x] 9.4 Prove listener cleanup: no duplicate `metrics-update`, `collector-status`, `collector-error` or hardware-profile subscriptions after remounts.
- [x] 9.5 Prove lifecycle bootstrap fencing still rejects an older fetched status after a newer event lands.
- [x] 9.6 Run dnd-kit keyboard and pointer reorder tests; preserve accessible drag behavior and saved ordering.
- [x] 9.7 Run Recharts/card rendering tests and, if practical, repeat the lightweight render-fanout diagnostic used by the prior performance campaign to detect an obvious React-major regression. Do not create a performance rewrite if metrics remain within normal variance.
- [x] 9.8 Run `verify:frontend`, E2E and mock simulation before adding build-tooling majors.

## 10. Vite / plugin-react / TypeScript 7 / jsdom 30 tooling migration

- [x] 10.1 Upgrade Vite and `@vitejs/plugin-react` as a documented compatible pair. Preserve strict dev port, Tauri dev/build integration and existing production bundle semantics.
- [x] 10.2 Upgrade TypeScript to the selected 7.x version. Review release/migration notes and resolve new diagnostics intentionally; no `any`, `@ts-ignore`, config broadening or disabled strictness merely to silence the compiler.
- [x] 10.3 Inspect all tsconfig files, including E2E/simulation configs, for removed/deprecated options or changed module-resolution defaults. Keep browser/Tauri and Node test contexts distinct where required.
- [x] 10.4 Upgrade jsdom to 30.x independently enough that DOM/test-environment regressions can be attributed. Fix tests only when they relied on behavior contrary to the browser/runtime contract.
- [x] 10.5 Align `@types/node` to the real supported Node 24 runtime surface unless upstream peer constraints require another compatible range. Do not change CI Node major without evidence.
- [x] 10.6 Run `npm ci`, `npx tsc --noEmit`, Vitest, production build, E2E, sim typecheck and full mock simulation.
- [x] 10.7 Inspect generated lockfile changes for unexpected duplicated framework/tool versions or surprising transitive native packages.

## 11. Remaining UI/data dependencies

- [x] 11.1 Evaluate Recharts target update after React/tooling are stable. Run chart rendering/history-window tests and visually/structurally verify axis/domain/tooltips still behave under the existing test harness.
- [x] 11.2 Evaluate Lucide update; verify changed icon package does not alter accessible button labeling or bundle/build behavior.
- [x] 11.3 Evaluate JS plugin-store/Tauri API leftovers already covered by Tauri alignment; avoid duplicate/version-skewed updates.
- [x] 11.4 For every other open dependency PR discovered in 0.4, assign Adopt/Supersede/Defer with evidence. Nothing may remain “forgotten.”

## 12. CI and release maintenance exposed by migration

- [x] 12.1 Audit all workflow action versions/annotations after hosted runs. Preserve full commit-SHA pins.
- [x] 12.2 If `actions/download-artifact` or another action still emits a Node-runtime deprecation warning and a compatible supported release exists, update it with a full SHA and verify behavior. Do not churn unrelated Actions without a real warning/security/support reason.
- [x] 12.3 Ensure cargo/npm caches include every input needed after toolchain/lockfile changes and do not accidentally restore incompatible target state.
- [x] 12.4 Keep `cargo-audit@0.22.1` semantics mandatory unless a separate evidence-backed tool-version update is required; an install or advisory failure must remain blocking.

## 13. Full behavioral qualification

- [x] 13.1 Run final `npm run verify:full` from a clean install state. Record complete command outcome and relevant test counts as runner output only; do not hardcode counts into durable docs.
- [x] 13.2 Run `npm run verify:packaged` against the final built executable on Windows.
- [x] 13.3 Run the full mock simulation matrix.
- [x] 13.4 Run packaged real journeys at minimum covering: healthy metrics advancement, customization/settings roundtrip, sidebar relaunch persistence, bounded restart soak, recovery/lifecycle bootstrap/retry behavior. Use existing journey IDs exactly as registered; if names changed, document equivalents.
- [x] 13.5 Re-run qualifying cadence probe/checker and compare against baseline SLOs: 250 ms live target, 4:1 full-tick ratio, approximately 1 Hz history, no catch-up burst, truthful elapsed timestamps.
- [ ] 13.6 Compare hardware profile/device keys across baseline/final on the available machine. Investigate any unexplained key/name/count drift before declaring success.
- [x] 13.7 Validate settings store JSON remains valid through restart soak and the developer's real store remains byte-identical during isolated packaged simulation.
- [x] 13.8 Run strict OpenSpec validation and `git diff --check` at final head.

## 14. Hosted CI/release qualification

- [x] 14.1 Push the campaign branch and obtain green required Rust/frontend/E2E/mock simulation/production-executable workflows at the final candidate SHA.
- [x] 14.2 Trigger the packaged real-app simulation dispatch and archive run IDs/artifact names/results.
- [x] 14.3 Trigger release qualification for MSI and NSIS when repository permissions/workflow design permit it; both install/run/uninstall flows must pass.
- [x] 14.4 Inspect annotations and logs even when workflows are green; address new deprecations, unsupported-runtime warnings, cache corruption, test retries or suspicious skips introduced by the migration.
- [x] 14.5 Never mark hosted qualification complete from an older SHA. Every cited run must correspond to the final or explicitly equivalent head.

## 15. Post-migration deep review

- [x] 15.1 Re-read every changed source/config/test/workflow file and its immediate behavioral caller/callee. Search for TODO/FIXME/HACK, new unwrap/panic/unsafe, suppressed TypeScript/Rust diagnostics and disabled tests introduced during migration.
- [x] 15.2 Re-audit collector startup/WMI, stable identity, NVML association, Tauri managed state, settings store, async frontend subscriptions, simulation isolation and workflow security as the highest-risk seams.
- [x] 15.3 Fix every introduced Critical/High/P1/P2 issue with regression coverage before completion. Lower-priority ideas may be documented only when they are genuinely non-blocking.
- [x] 15.4 Review the full dependency/lockfile diff for accidental downgrades, duplicate majors, abandoned packages or newly fixable advisories.

## 16. Repository truth and Dependabot queue reconciliation

- [x] 16.1 Update `progress.md` with final supported Rust/Node/framework/runtime versions, major migration decisions, evidence links/run IDs, remaining intentional deferrals and physical-hardware limits.
- [x] 16.2 Update `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, README or other tracked docs only where version/build/test truth actually changed. Avoid duplicating details already owned by OpenSpec.
- [x] 16.3 Record final disposition of every dependency PR present at campaign start plus replacements created during execution: merged/superseded/closed/deferred/rebase-needed and exact reason.
- [ ] 16.4 Close or supersede stale generated PRs through available GitHub tooling when authorized. If that action is unavailable, produce a precise maintainer action list in evidence.
- [x] 16.5 Ensure no doc still says “no actionable work” while an active campaign remains incomplete, and no doc says the campaign is active after it is archived/merged.

## 17. Completion and archive

- [x] 17.1 Fill `evidence.md` with upstream references, before/after version matrix, commands, test/probe results, hosted run IDs, migration decisions, PR dispositions, limitations and any deferred targets.
- [x] 17.2 Verify every task checkbox truthfully. Do not mark a hardware-only or hosted step complete without actual evidence; use explicit N/A/blocked evidence and keep the campaign open if the requirement is mandatory.
- [x] 17.3 Sync delta specs into canonical specs using the repository OpenSpec workflow, then run strict validation.
- [x] 17.4 Archive `dependency-runtime-modernization-and-qualification` only after all mandatory completion gates are met and evidence is final.
- [x] 17.5 Final detailed commit/report must name start SHA → final SHA, dependency version matrix, key source migrations, test/qualification results, introduced defects fixed, remaining limitations and Dependabot PR disposition.
- [x] 17.6 Push all commits. Leave the branch clean and remote-visible so the planner/user can inspect it without local-only state.
