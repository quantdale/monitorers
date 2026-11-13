# Autonomous readiness campaign — 2026-11-13

Start: clean `main@637728958dd2296dc754865ed2265f1cd0050537`, equal to fetched origin/main. Working branch `agent/production-readiness-2026-11-13`. No active OpenSpec change; old planner prompt is explicitly superseded. Foreign locked Cursor worktrees are untouched.

Session logs and screenshots: `D:/Documents/tryPython/_AgentArtifacts/monitorers/sessions/20261113-codex-successor/`.

Architecture reviewed: collector/run_loop and supervisor, thin Tauri commands, snapshot/history construction, metrics/profile/settings hooks, verification scripts, Playwright lanes and release configuration. Existing collector cadence/identity/settings/schema contracts remain acceptance boundaries.

Initial prioritization:

1. P1: Hardware profile notification loss and subscribe/bootstrap gap; deterministic hook tests and bounded serialized refresh required.
2. P2: Review equivalent async listener disposal paths and timestamp fallback against documented clock contract; implement only reproduced defects.
3. Qualification: canonical frontend/Rust feature matrices/audits, E2E, full mock matrix, fresh release/packaged runtime, responsive visual inspection and host cleanup.
4. Physical identical-Nvidia, actual hotplug/power/lid scenarios, signing/trusted distribution remain external qualification; do not fabricate proof.

Environment: shell Node 24.3.0 is below package floor 24.15; baseline is labeled accordingly. A session-local Node 24.15 runtime will be used for final qualification. Cargo 1.98 Windows is available.

## Frontend boundary repair

Profile regression: `npm test -- --run src/hooks/useHardwareProfile.hook.test.ts` failed 5/13 before the fix (`profile-red.log`); now 14/14 pass including subscription failure/retry. Added deferred fetch, coalesced notifications, failed-request trailing refresh, delayed registration and disposed-effect cases.

Sibling review reproduced two metrics defects (`metrics-red.log`): old StrictMode callbacks overwrote active data (CPU 99 instead of 42), and missing payload time before history response used local wall time. Guarding disposed listeners exposed a third bug: StrictMode replay of an impure state updater appended one full tick twice. History ref ownership now resides in the event callback, outside replayable updaters. Subscription errors were also invisible despite successful bootstrap (`subscription-red.log`); they now remain visible until remount.

Supported runtime: session-local Node 24.15.0 SHA256 `3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5`, matches official nodejs.org v24.15.0 SHASUMS256.txt. No global runtime changed. Canonical frontend gate passed with 357 tests and both npm audit scopes at zero vulnerabilities; all three TS projects and hooks lint pass.

Initial full E2E: 50/51; keyboard reverse-drop failed. Ten isolated repetitions passed, then stress failed 7/60, proving a successor issue rather than dismissing it. The follow-up change is `synchronize-keyboard-scroll-collisions`.

First mock matrix failed after early journeys because it reused an E2E-owned Vite server that terminated on E2E completion (`ERR_CONNECTION_REFUSED`). This is session orchestration error, not a product result. Final suites use a separately owned Vite process and no source edits during browser verification.

Backend review exposed cross-session wall-origin reset, reproduced and repaired under `preserve-history-clock-through-recovery`.

Settings sibling review reproduced an obsolete StrictMode bootstrap overwriting an edited five-minute window with the default one-minute window (`settings-red.log`, expected 300, received 60). Effect cancellation now fences both the native store and simulation shim; the regression passes. A final missing-timestamp regression also proved the ring tail could outrank a newer scalar-only backend timestamp (`latest-time-red.log`); fallback now takes the newest of the two, and history bootstrap cannot regress that known live time.

## Final local qualification

Frozen source: `verify:frontend` exit 0, **360 tests/28 files**, production and test TS checks, hooks lint, dead-code/version/doc checks, production bundle. Both repository-root and application npm audit scopes: exit 0, zero vulnerabilities. `sim:typecheck` exit 0. Installed top-level dependency tree satisfies package.json (`npm ls --depth=0`).

Full E2E **52/52**, keyboard stress **60/60**, full mock matrix **16/16** journeys (4/4 runner tests), fresh production executable and packaged qualification **1/1**. Real IPC/data/store/focus/drag-cancel/teardown proof is in `packaged.log`. The first failed E2E/mock/cadence attempts are preserved above/in sibling evidence; none is silently relabeled as green.

Visual inspection: browser screenshots at 400×300, 900×1100 and 1440×900 plus the minimum-height metrics popup; actual packaged dashboard and hardware drawer screenshots are inspected separately. No visual redesign was justified. Axe reports zero violations in inspected browser states; gradient/pseudo-element background contrast checks remain incomplete and are not claimed as automated contrast certification. Existing contrast tests and visual inspection remain the evidence for those states.

Real-process qualification (`real.log`): customization roundtrip **9/9**, sidebar relaunch persistence **17/17**, restart-soak durability **25/25** assertions; all three journeys pass (4/4 runner tests). Real developer settings byte-identity and orphan guards pass. Machine-wide WebView2 args policy absent after packaged and real runs. Actual packaged tile/dashboard and 400px hardware drawer screenshots were visually inspected: readable model names, contained badges/charts, reachable controls, visible focus and coherent modal layering.

Adversarial final review covered every product diff and adjacent consumers: async request disposal/failure paths, StrictMode updater purity, save queue ownership, one ring/live timestamp clock across recovery, scroll compensation and nested ancestors, unchanged IPC schemas/CSP/capabilities/features, no new production unsafe/OS handle ownership, no added dependencies or test suppression, no leftover probes, and final scoped audits. No further evidence-backed local product defect was identified. Signing material and physical hotplug/power/identical-device certification remain external; no physical or signing proof is claimed.
