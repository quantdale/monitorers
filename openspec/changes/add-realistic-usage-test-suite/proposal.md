## Why

sys-monitor-tauri's existing test suites (70 Rust tests, 41 Vitest tests) verify individual functions in isolation but were not written against a model of how a person actually uses this app over days and weeks. Reading the collector, settings-persistence, and card-identity code end-to-end during an exploration session surfaced several behaviors that unit tests miss by construction: two distinct code paths derive card identity differently (content-keyed on the dashboard, position-keyed in the hardware sidebar), a GPU-utilization merge step in the PDH collector silently combines two physically distinct same-model GPUs into one card, no guard exists against running two instances of the app concurrently, and the collector's "freeze forever on panic" behavior has never been exercised end-to-end. None of this shows up in a feature-by-feature test suite; all of it shows up the first time a real machine's hardware or a real user's habits change between sessions.

## What Changes

- Add a realistic-usage testing specification organized around four pillars instead of individual features: **identity stability** across hardware/session changes, **settings persistence & concurrent-write safety**, **collector lifecycle & failure modes**, and **everyday longitudinal usage**.
- Add unit/integration-level regression tests (extending the existing `cargo test` and Vitest suites — no new test framework) for each pillar, including characterization tests for two confirmed-but-previously-untested defects (see Known Gaps in design.md): the GPU same-model merge bug in `collector/gpu.rs`, and the absence of single-instance enforcement.
- Absorb the one remaining unchecked task (8.7 — live 1-hour-window real-time-tracking verification) from the now-nearly-complete `fix-history-emission-rate` change into this spec's manual-verification/regression section, so it isn't left stranded in a change that's otherwise done.
- Document, but do not fix, known gaps that are out of scope for a testing-only change: no `tauri-plugin-single-instance`, the GPU merge-by-display-name defect, no pruning of stale ids in persisted settings, and the absence of any E2E/browser-automation harness (no `tauri-driver`/WebDriver setup exists) for scenarios that need real drag-and-drop, real hardware hotplug, or real multi-process launches.
- No application code changes. This change adds tests and a small number of pure test-support helpers only.

## Capabilities

### New Capabilities
- `realistic-usage-testing`: Defines the test coverage required to verify sys-monitor-tauri behaves correctly under realistic, longitudinal, imperfect human usage — spanning card/hardware identity stability, settings persistence and concurrent writes, collector lifecycle/failure recovery, and everyday multi-session usage patterns. Also defines the known-gaps register (confirmed defects and missing safeguards) that realistic usage exposed but that remain out of scope to fix here.

### Modified Capabilities
- none — this change adds test coverage and gap documentation; it does not change the requirements of `metrics-history-streaming`, `dependency-vulnerability-audit`, or `unsafe-code-safety-documentation`.

## Impact

- **Rust**: new `#[cfg(test)]` modules/tests in `src-tauri/src/collector/gpu.rs` (GPU merge characterization), `src-tauri/src/state.rs` and `collector/mod.rs` (ring-buffer wraparound, collector-panic invariant), no changes to non-test code.
- **Frontend**: new test files/cases alongside `src/hooks/useSettings.test.ts`, `src/hooks/useMetrics.test.ts`, and `src/utils.test.ts` (settings save-race, persistence-boundary, schema-version-skew, sidebar positional-identity characterization). Possibly a new `src/components/HardwareSidebar.test.tsx` if none exists.
- **OpenSpec**: absorbs and references task 8.7 from `openspec/changes/fix-history-emission-rate/tasks.md`; that change is otherwise unaffected.
- **CI**: no changes to `.github/workflows/rust.yml` required — new tests run under the existing three jobs. Any test requiring real hardware/manual verification is explicitly marked as out of CI scope.
- **Dependencies**: none added. (A single-instance plugin, if adopted later per the Known Gaps recommendation, is out of scope for this change.)
