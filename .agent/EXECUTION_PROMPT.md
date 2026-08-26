# Execution Prompt — Monitorers PR #28 Safety Closure

## Status

**ACTIVE**

This is a corrective continuation of the existing `production-runtime-recovery-and-release-qualification` campaign. **Do not create a competing campaign. Do not start dependency-major upgrade work.** Resume and finish PR #28 from its actual current repository state.

## Planned-From

- Repository: `quantdale/monitorers`
- Default branch observed by planner: `main`
- Planned-from `main` SHA: `d8ec7f491370552aa60d592f3058f86fd758c852`
- Existing campaign branch: `agent/monitorers-comprehensive-remediation`
- Existing PR: **#28 — Production runtime recovery and release qualification**
- PR head observed by planner: `31f190ce2cf5376388c44a4a45a6ea25d68c1608`
- PR state observed by planner: open, mergeable, 18 commits, 89 changed files
- Important topology: the campaign branch was **18 commits ahead and 2 commits behind** the observed `main`; its merge-base was `d1b84c374842ec21dfbe0e4e9ba865f273adf18e`. Reconcile latest `main` safely before finalization and preserve all main-only planner/isolation infrastructure under `.agent/`.

## Campaign

**PR #28 final safety closure, evidence repair, hosted requalification, and merge integration**

The campaign implementation is broad and much of it is already landed, but the branch is **not complete** even though `openspec/changes/production-runtime-recovery-and-release-qualification/tasks.md` currently marks tasks 1–9 complete and records green hosted qualification. A fresh planner audit of the current PR head found multiple review findings still present in source, including one **critical runtime wiring defect** that defeats the campaign's manual Retry feature. Treat the current checked task state and prior green evidence as stale until the defects below are fixed and requalified at the final head.

The goal of this continuation is not to add features. It is to make the recovery/release campaign actually true end-to-end, close the newly discovered safety gaps, make tests capable of catching the wiring failures that escaped them, reconcile documentation/evidence with reality, and merge PR #28 only when the implementation is genuinely trustworthy.

## Repository Ground Truth to Re-read Before Editing

Read and reconcile, in this order:

1. `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `CONTEXT.md`, `progress.md`, and `sys-monitor-tauri/README.md`.
2. `.agent/PLANNER_HANDOFF.md` and this prompt.
3. PR #28 body, **all current inline review threads**, review submissions, changed files, recent commits, and current hosted check results. The PR body is older than the current head; do not treat its old head SHA or old completion narrative as authoritative.
4. The full active OpenSpec change:
   - `openspec/changes/production-runtime-recovery-and-release-qualification/proposal.md`
   - `design.md`
   - `tasks.md`
   - `evidence.md`
   - all delta specs.
5. Actual implementations and tests around:
   - `src-tauri/src/main.rs`
   - `src-tauri/src/collector/supervisor.rs`
   - `src-tauri/src/collector/run_loop.rs`
   - `src/hooks/useMetrics.ts` and hook tests
   - `src/sim/mockBackend.ts` and mock-backend tests
   - `e2e/sim/drivers/RealAppDriver.ts`
   - `e2e/sim/qualify.spec.ts`
   - `.github/workflows/release-qualification.yml`
   - simulation/E2E workflows and release scripts.
6. Re-run a repo-wide impact audit after reading the recent diff, not just the files named in review comments. Trace state ownership, lifecycle transitions, cleanup paths, event ordering, reload/bootstrap behavior, singleton teardown, installer artifact paths, and the test seams that are supposed to prove each contract.

## Confirmed Live Defects at the Planned PR Head

These were verified against source at PR head `31f190ce2cf5376388c44a4a45a6ea25d68c1608`. Re-check after fetching because the branch may have moved, but do not dismiss them merely because old tasks are checked.

### 1. CRITICAL — Retry and stop flags collide in Tauri managed state

`sys-monitor-tauri/src-tauri/src/main.rs` manages two independent `Arc<AtomicBool>` values with `app.manage(...)`: one for `stop_flag`, then another for `retry_request`. Tauri managed state is keyed by Rust type, so two values of the same type cannot represent two independent state entries. `retry_collection` requests `State<'_, Arc<AtomicBool>>`, and the exit path also requests `Arc<AtomicBool>`.

This can make the Retry command resolve the stop flag instead of the supervisor's retry request. In the failure state, clicking **Retry metrics** can therefore set stop, cause supervision to transition to stopping, and permanently terminate collection until process restart — the opposite of the campaign's primary recovery contract.

Required closure:

- Introduce distinct managed-state types, e.g. explicit `StopFlag` and `RetryRequest` wrappers around `Arc<AtomicBool>` (or an equally strong typed design).
- Make `retry_collection` depend on the retry-specific type, and make app-exit shutdown depend only on the stop-specific type.
- Do not rely on insertion order or duplicate same-type `manage` calls.
- Fail loudly/assert the expected `manage` registration result where appropriate so a dropped managed state cannot silently recur.
- Add a regression test that exercises the real command/state wiring sufficiently to prove: from `Failed`, Retry signals the supervisor retry path, produces exactly one replacement generation/session, and **does not** set stop or emit/enter `Stopping` as a consequence of the click.
- Also retain/cohere the existing retry coalescing behavior outside `Failed`.

### 2. P1 — Tauri frontend mount still misses managed current collector status

`sys-monitor-tauri/src/hooks/useMetrics.ts` currently subscribes to future `collector-status` events but does not bootstrap the existing status with `get_collector_status` on mount/reload.

Required closure:

- Fetch and validate the managed current status in addition to installing the event listener.
- Make listener/fetch ordering race-safe: an event that arrives during bootstrap must not be overwritten by an older fetched status.
- A webview reload while the supervisor is already persistent `failed` must immediately surface the failed UX and Retry action without waiting for a new event or restarting the native app.
- Add regression coverage for failed-before-mount, event-during-bootstrap, stale fetch vs newer event, schema mismatch/recovery, cleanup/unmount, and normal healthy bootstrap.

### 3. P2 — First recovered collector poll still occurs before the intended initial deadline

`sys-monitor-tauri/src-tauri/src/collector/run_loop.rs` sets `next_deadline = loop_epoch + TICK_INTERVAL`, but the loop enters the poll body before waiting for that deadline. Baselines are therefore primed and then sampled nearly back-to-back on a fresh/recovered session.

Required closure:

- Actually wait until the initial deadline before the first poll/commit.
- Preserve immediate/responsive shutdown, bounded-test semantics, missed-deadline rebasing, cadence telemetry, 1 Hz history gating, and the no-catch-up-burst invariant.
- Add deterministic regression coverage that would fail if first polling happens immediately after priming.

### 4. P2 — Mock backend still declares `healthy` before the replacement session emits a snapshot

`sys-monitor-tauri/src/sim/mockBackend.ts::start()` currently emits `starting` and then `healthy` immediately after scheduling the interval, before a new-generation snapshot is emitted. Automatic recovery also emits `healthy` before calling `start()`.

Required closure:

- A replacement generation reaches `healthy` only after its first successful snapshot/emission, matching the production first-emit contract.
- Recovery/error UI must not clear merely because a timer was scheduled.
- Add tests that prove a dead/non-emitting replacement cannot transition healthy and cannot satisfy recovery journeys.

### 5. Release workflow still uses unsupported `artifact-name`

`.github/workflows/release-qualification.yml` still contains `artifact-name: windows-installers` on `actions/download-artifact` steps. The supported input is `name`.

The prior hosted lane may have succeeded because recursive discovery and the single-artifact shape tolerated the unsupported input, but warnings and accidental behavior are not a release contract.

Required closure:

- Replace every unsupported `artifact-name` with the supported `name: windows-installers`.
- Keep action download paths workspace-relative and consistent with subsequent `run` steps under `defaults.run.working-directory: sys-monitor-tauri`.
- Validate both MSI and NSIS jobs plus manifest layout using the exact final workflow.

### 6. SECURITY/HARDENING — machine-wide WebView2 debug policy cleanup is not unconditional

`sys-monitor-tauri/e2e/sim/drivers/RealAppDriver.ts` correctly applies the elevated-host HKLM `AdditionalBrowserArguments` fallback before spawn, but `close()` can throw on work-directory cleanup before reaching `removeHklmArgsFallback()`.

That can leave a machine-wide WebView2 policy containing remote-debugging arguments/origin relaxation behind on non-ephemeral/admin developer hosts.

Required closure:

- Make HKLM policy removal unconditional via a `finally`-style structure that cannot be skipped by browser-close, process-close, work-dir cleanup, assertion, or spawn failure paths.
- Preserve useful error aggregation: cleanup failures still surface, but security cleanup must run regardless.
- Ensure policy cleanup also executes if spawn itself throws after policy application.
- Prefer reading back/logging the policy write result when practical so access-denied vs successful application is diagnosable.
- Add an injectable/testable seam or focused unit coverage for failure paths, including simulated work-dir deletion failure and spawn failure. Do not require a real persistent HKLM mutation in ordinary unit tests.
- Remove pointless final retry sleeps if encountered, but do not broaden this into unrelated refactoring.

### 7. Mock singleton teardown can be resurrected by stale crash timers

`src/sim/mockBackend.ts::stop()` clears only the active interval. Crash/recovery timeouts are tracked separately and currently survive `stop()`. The mock backend is a module-level singleton, so an old timeout can fire after unmount, call recovery/start logic, resurrect emission, advance generation, and contaminate the next mount/run.

Required closure:

- `stop()` must clear crash/recovery timeouts as part of teardown.
- Scheduled crash/recovery callbacks must also refuse to mutate/restart a backend that has been stopped or superseded. Use an explicit stopped/run epoch/generation token or an equally clear mechanism.
- Test teardown during automatic recovery, teardown during exhaustion staging, remount after teardown, and deterministic singleton state.

### 8. Retry command documentation is backwards

The `UseMetricsResult.retryMetrics` comment currently says `'failed'` means the retry was coalesced/ignored. The backend contract returns `Failed` on the honored retry path and returns other current states for coalesced no-ops.

Correct the public/internal documentation and any tests or UX assumptions that encoded the reversed interpretation.

## Workstreams — Execute in Order

### Workstream A — Reopen truth before changing code

1. Fetch/prune and inspect current `main`, PR branch, PR reviews, checks, and merge-base.
2. Reconcile the campaign branch with latest `main` without losing unrelated changes or `.agent/` infrastructure. No force-push.
3. Update the active OpenSpec task/evidence state to acknowledge the newly discovered defects. Do **not** leave every task checked while known correctness/security defects remain.
4. If the current OpenSpec design/spec text needs amendments for typed stop/retry state, bootstrap status race semantics, cleanup guarantees, or mock first-emit/teardown semantics, modify the existing active change rather than opening a competing change.

### Workstream B — Fix lifecycle correctness at the native/frontend boundary

Implement the typed stop/retry state separation and command wiring first. Then fix frontend current-status bootstrap and race ordering. Audit every lifecycle transition across Rust → IPC → hook → App UX so `starting/recovering/healthy/failed/stopping` semantics remain coherent across app startup, native recovery, frontend reload, retry, and shutdown.

Tests must target real contracts, not local helper reimplementations. A test that merely duplicates `if state == Failed { signal }` is insufficient; exercise the state registration/command path or extract a typed seam that the actual command uses.

### Workstream C — Restore truthful timing and simulation semantics

Fix the initial collector deadline and mock first-emit health transition. Then repair singleton teardown/crash timeout cancellation. Audit simulation recovery journeys so they prove data actually resumes rather than accepting a lifecycle label as proof.

Preserve determinism, seeded reproduction, settings isolation, and current user-simulation artifact/reporting behavior.

### Workstream D — Harden installed-binary qualification cleanup and workflow correctness

Fix `actions/download-artifact` inputs and RealAppDriver policy cleanup. Preserve the elevated-host WebView2 workaround that made hosted installed-binary qualification possible, but make its lifecycle safe on every path.

Do **not** weaken qualification to mock-only, process-launched-only, or frontend-only checks. The final gate must still exercise the **installed production binary + real Tauri IPC + advancing collector data + isolated settings + representative interaction + clean teardown + uninstall/removal/orphan checks** for MSI and NSIS.

### Workstream E — Deep regression audit across the PR, not only review-comment files

Because this PR changes 89 files and the campaign was previously declared complete while live defects remained, perform a full-system review of the PR diff and affected code paths before sign-off. At minimum inspect:

- duplicate/same-type Tauri managed states and command state injection;
- supervisor stop/retry races and session overlap;
- first-emit lifecycle ordering;
- history and rate baseline semantics across recovery;
- event-listener/bootstrap races on reload;
- all timers/intervals and singleton teardown paths;
- all RealAppDriver failure/cleanup paths, process/orphan detection, policy writes/removal, work-dir/settings isolation;
- installer artifact download/layout/manifests;
- error handling that can skip security/resource cleanup;
- stale comments/specs/docs that claim behavior the source does not implement;
- tests that reproduce implementation logic instead of exercising the production seam.

Fix any newly discovered **Critical/High/P1/P2 correctness or security regression** that is in the blast radius of this campaign. Do not broaden into cosmetic redesign or unrelated dependency modernization.

### Workstream F — Documentation and evidence reconciliation

Reconcile all source-of-truth documents against the final implementation. In particular, inspect `AGENTS.md` and related docs for stale claims about WebView2 automation/CDP and the env-only debug-argument path; the current repository has a real packaged-app CDP qualification path and an elevated-host HKLM fallback. Do not leave contradictory statements.

Remove tracked raw CI diagnostic dumps from repository root after extracting durable findings into OpenSpec evidence. The planner observed these raw logs in the PR diff and they should not ship as source artifacts:

- `msi-fail.log`
- `msi-full.log`
- `msi-rc4.log`
- `nsis-full.log`
- `nsis-rc4.log`

If any is intentionally retained, justify it in durable documentation; otherwise delete all of them.

Update `tasks.md` and `evidence.md` only from actual final results. Prior run IDs remain historical evidence, not proof of the final post-fix head.

### Workstream G — Full local validation

Run focused regression tests immediately after each subsystem fix, then execute the repository's complete canonical gates from `sys-monitor-tauri/` / `src-tauri/` as appropriate. At minimum:

- frontend typecheck (`npx tsc --noEmit`)
- frontend Vitest suite (`npm test -- --run`)
- frontend build (`npm run build`)
- Rust formatting (`cargo fmt -- --check`)
- Rust tests in every feature lane required by repository verification scripts/policy
- Rust clippy `--all-targets --all-features -- -D warnings`
- `cargo audit` under repository policy
- E2E (`npm run verify:e2e` or current canonical equivalent)
- simulation mock matrix (`npm run verify:sim` or current canonical equivalent)
- simulation typecheck (`npm run sim:typecheck`)
- version consistency gate
- `openspec validate --all --strict --no-interactive`
- `git diff --check`
- `npm run verify:tauri`
- `npm run verify:packaged`

Use the canonical aggregate verification commands in `package.json`/AGENTS when they supersede individual commands. Do not claim success from partial subsets.

### Workstream H — Hosted CI and release requalification at the final head

Push coherent commits to the existing PR branch and inspect hosted CI. Fix failures; do not merely report them.

Because this continuation changes retry wiring, lifecycle semantics, qualification workflow, and RealAppDriver cleanup, dispatch/run the full release-qualification workflow again at the **final branch head** after all fixes. Require green:

- regular PR Rust/release lane(s)
- frontend/E2E lane
- simulation lane
- packaged/production executable checks that apply
- MSI build/install/real-IPC smoke/uninstall qualification
- NSIS build/install/real-IPC smoke/uninstall qualification
- artifact-integrity/release manifest job

Record exact final run IDs, job outcomes, relevant artifact names/hashes, and any environment-specific facts in `evidence.md`.

### Workstream I — Review closure, OpenSpec archive, and merge

1. Re-read every unresolved PR #28 review thread after fixes.
2. Resolve/reply only when the actual code and regression evidence address the thread; do not mechanically resolve comments because CI is green.
3. Ensure no current Critical/High/P1/P2 thread remains substantively open.
4. Make OpenSpec task/evidence state truthful.
5. Sync/archive `production-runtime-recovery-and-release-qualification` according to repository policy **only after** all acceptance criteria are met and final evidence is captured.
6. Reconcile with the latest `main` again immediately before merge. Preserve planner files and unrelated newer main commits.
7. Merge PR #28 through the normal PR flow once it is genuinely merge-ready and all required hosted qualification is green. Never force-push or overwrite main.
8. Verify the remote `main` contains the merged/archived campaign, the final commit SHA is known, and the working tree is clean/up-to-date.
9. Mark this execution prompt **COMPLETE** (or otherwise transition it per the local planner-handoff convention) so a future `/goal continue` does not restart finished work.
10. Stop. Do not start Dependabot/React/Vite/TypeScript/Rust dependency-major campaigns in the same run.

## Constraints / Non-Negotiables

- Windows-only backend realities remain valid; do not fake host-bound success.
- Preserve production behavior outside the campaign blast radius.
- No force-push, destructive history rewrite, or deletion of unrelated work.
- No blanket `#[allow]`, swallowed exceptions, disabled gates, `continue-on-error`, mock-only substitutions, or timeout inflation to hide deterministic defects.
- Do not weaken the collector's 250 ms monotonic cadence / 1 Hz history semantics.
- Do not compromise settings isolation or touch the developer's real settings store during simulation/qualification.
- Machine-wide HKLM policy mutation, when needed for elevated WebView2 qualification, must be scoped and unconditionally cleaned up.
- Keep the app's current unsigned release truthfulness unless actual signing infrastructure exists; do not fabricate signing success.
- Do not absorb open Dependabot major-version PRs unless a verified release blocker makes a specific dependency change unavoidable; if that occurs, justify it narrowly in evidence.
- Fix introduced Critical/High regressions before moving on.
- Prefer durable regression tests that fail on the pre-fix code and validate observable contracts.

## Acceptance / Completion Gates

This campaign is complete only when **all** of the following are true:

1. Retry and stop are distinct typed managed states; a Retry from `Failed` demonstrably starts exactly one replacement generation and never sets shutdown/stopping.
2. Frontend Tauri mount/reload bootstraps the current collector status race-safely; already-failed supervisors expose Retry after reload.
3. Fresh/recovered collector sessions wait for the real initial tick deadline before first polling/commit.
4. Mock recovery reports `healthy` only after actual replacement-session data emission.
5. Mock teardown cancels/invalidates crash timers and cannot resurrect the singleton after unmount/stop.
6. All release workflow download-artifact steps use supported inputs and correct paths.
7. WebView2 HKLM debug policy cleanup is unconditional across success, spawn failure, browser/process close failure, and temp-dir cleanup failure.
8. Retry API/documentation semantics are correct everywhere.
9. A full PR-wide impact audit finds no remaining campaign-related Critical/High/P1/P2 defect.
10. Root raw diagnostic logs are removed or explicitly justified.
11. Docs/specs/task state/evidence match source and actual final execution.
12. Full local canonical verification is green.
13. Hosted PR CI is green at the final head.
14. A new final-head MSI + NSIS installed-production-binary release qualification is green with real IPC/settings/collector assertions and clean teardown/uninstall, and final evidence records exact run IDs/artifacts.
15. Substantive PR #28 review threads are closed/resolved with code/evidence rather than ignored.
16. The active OpenSpec change is synced/archived only after truthfully satisfying its requirements.
17. PR #28 is merged to current `main` without losing newer main/planner infrastructure.
18. Remote main is verified, final SHA reported, and the repository is left clean with no unpushed completed work.
19. This prompt is transitioned out of ACTIVE state.

## Git / Reporting Requirements

- Use coherent, reviewable commits grouped by defect/workstream; avoid a single opaque mega-commit when multiple independent fixes can be separated safely.
- Push after meaningful completed slices so hosted checks can validate actual branch state.
- Never force-push.
- Before completion, fetch/prune, verify branch/main relationship, and confirm remote state rather than assuming local state.
- Final report must include:
  - start and final SHAs;
  - exact defects fixed, including any additional audit findings;
  - tests/gates run and results;
  - final hosted CI/release-qualification run IDs;
  - OpenSpec archive/sync status;
  - PR #28 merge status and resulting main SHA;
  - any genuine remaining host-bound limitation (do not list already-solved items as limitations);
  - confirmation that worktree/remote are clean and synchronized.

## Executor Instruction

`/goal continue`

Read repository instructions, this prompt, PR #28, the full current review state, the active OpenSpec change, and the actual Git state. Resume the **first genuinely incomplete requirement** above. Do not generate another planning prompt, do not redo already-proven work unnecessarily, and do not begin a different campaign until this one is fully closed.