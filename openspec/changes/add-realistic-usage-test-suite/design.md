## Context

sys-monitor-tauri is a single-process Windows desktop app: one Rust/Tauri v2 backend thread polls PDH/WMI/NVAPI/NVML and streams `MetricsSnapshot`/`HistoryPayload` over IPC; one React frontend renders draggable cards. There is no auth, no server, no multi-tenancy, and no user-authored data other than layout preferences (`cardOrder`, `hiddenCardIds`, `sidebarCardOrder`, `viewMode`, `windowSecs`), which persist via `@tauri-apps/plugin-store` to `settings.json`. Telemetry itself (the ring buffers in `HistoryStore`) does not persist — it resets every process start.

This design was informed by reading `main.rs`, `state.rs`, `collector/gpu.rs`, `useMetrics.ts`, `useSettings.ts`, `App.tsx`, and `HardwareSidebar.tsx` end-to-end rather than reasoning from the generic "web app with auth and a database" testing template. Several of the generic template's usual concerns (authN/Z, multi-tab session conflicts, background job queues, API contract testing against a network peer) genuinely do not apply to this app and are marked N/A in the spec rather than padded out.

Four realistic-usage risk pillars emerged from that reading, each tied to a specific mechanism in the code (not a generic concern):

1. **Identity stability** — the dashboard keys cards by content (`gpuId(name)`, drive-letter combos); the hardware sidebar keys cards by array position (`sb_gpu_${i}`, `sb_disk_${i}`). These two schemes drift apart differently when hardware enumeration changes between sessions.
2. **Settings persistence & concurrent-write safety** — every drag-end/toggle/view-mode/window-range change fires an independent async `store.set` + `store.save()`; nothing serializes overlapping calls, and nothing prevents a second OS process from writing the same file.
3. **Collector lifecycle & failure modes** — the collector thread runs each tick inside `catch_unwind`; on a caught panic it emits `collector-error` once and **breaks the loop permanently** (`main.rs` ~624-668), by design, with no auto-restart. WMI connection retries with exponential backoff (up to ~life of 8 attempts / 30s cap) on startup. Schema-version mismatches between frontend and backend degrade silently (`console.error` only).
4. **Everyday longitudinal usage** — 1Hz history commit into a 3600-sample ring buffer, first-launch/new-hardware id-merge logic in both `App.tsx` and `HardwareSidebar.tsx`, and the intentional persistence asymmetry between preferences (survive restart) and telemetry (does not).

## Goals / Non-Goals

**Goals:**
- Specify test coverage, organized by the four pillars above and by persona-driven journeys, that would catch regressions a feature-by-feature suite would miss.
- Extend the existing test infrastructure only: `cargo test` (Rust, currently 70 tests) and Vitest (frontend, currently 41 tests). No new frameworks.
- Add characterization tests for two confirmed defects (GPU same-model merge, no single-instance guard) so their current behavior is pinned and any future fix is a deliberate, visible test change rather than a silent behavior shift.
- Absorb task 8.7 (`fix-history-emission-rate`) into this spec's regression/manual-verification section.
- Produce an explicit Known Gaps register so gaps found by this exercise are not lost, without requiring this change to fix them.

**Non-Goals:**
- Fixing the GPU same-model merge defect in `collector/gpu.rs`.
- Adding `tauri-plugin-single-instance` or any single-instance enforcement.
- Adding a settings-pruning pass for stale hardware ids.
- Standing up an E2E/browser-automation harness (e.g. `tauri-driver`) — scenarios that require one are scoped as manual/exploratory testing instead, with the gap explicitly documented rather than silently dropped.
- Testing anything resembling multi-user auth, server APIs, or background job queues — none exist in this app.

## Decisions

**Decision: organize the spec by pillar + persona, not by the requesting prompt's 24 generic sections.**
Several generic sections (auth/authz, multi-tab conflict, background job/queue testing, API contract testing against a network dependency) have no referent in a single-process, no-auth, no-server desktop app. Forcing content into them would either fabricate requirements the code doesn't support or pad the spec with "N/A" boilerplate. Alternative considered: fill in all 24 sections uniformly for template fidelity — rejected because Rule 1 of the source prompt itself ("do not invent requirements") argues against it; N/A sections get one line each with the reason, kept in the spec for traceability.

**Decision: characterize confirmed defects with tests instead of silently fixing them here.**
The GPU-merge defect and the missing single-instance guard are real, but fixing them is a behavior change to production code, which this change's scope (tests only, per the proposal) excludes. A characterization test (asserting today's actual behavior — e.g., "two same-model GPUs produce one summed-utilization entry") pins the behavior so: (a) it's now a known, tested fact instead of an undiscovered latent bug, and (b) a future fix change will fail this test deliberately, forcing an explicit update rather than an unnoticed regression. Alternative considered: fix them inline as part of "test discovery" — rejected per the user's explicit choice to scope this change as tests-and-gap-documentation only.

**Decision: use existing test infra (`cargo test`, Vitest) for everything expressible without real hardware or process control; mark the rest manual/exploratory.**
No `tauri-driver`/WebDriver setup exists in this repo. Drag-and-drop reordering, real hardware hotplug (unplug a drive, dock/undock a GPU), and real multi-process launches cannot be exercised by the current unit/integration tooling. Alternative considered: write these as skipped/ignored automated tests as placeholders — rejected; an `#[ignore]`d test that never runs reads as "covered" in a test count and would violate the "no silent caps" principle. Instead: pure-function-level tests cover the identity/merge/persistence *logic* (e.g., "given this before/after profile shape, does the id-merge function produce X"), and the parts that need an actual OS-level drive letter change or a second process are captured as explicit exploratory-testing missions in the spec (Phase 25-style), not as automated tests.

**Decision: single new capability `realistic-usage-testing` rather than one capability per pillar.**
The four pillars are facets of one testing effort against one app, not four independently-versioned product capabilities. Alternative considered: four capability specs (`identity-stability-testing`, `settings-persistence-testing`, etc.) — rejected as unnecessary fragmentation; the spec-driven schema supports grouping requirements within one spec, and traceability is preserved via requirement IDs per pillar.

## Risks / Trade-offs

- **[Risk]** Characterization tests for the GPU-merge and single-instance gaps could be read later as "this is intended behavior, don't touch it" → **Mitigation**: each characterization test's description explicitly states it pins a *known defect*, not a requirement, and the Known Gaps register cross-references it with a recommended fix direction.
- **[Risk]** Marking scenarios as "manual/exploratory only" could let them silently rot (never actually run) → **Mitigation**: the regression suite section lists them as named, owned checklist items (including the absorbed task 8.7), not just prose, so they're visible in `tasks.md` and can be tracked like any other task.
- **[Risk]** Testing settings-write concurrency (rapid drag-reorder, dual-instance writes) at the unit level can only exercise the pure merge/save logic, not real OS-level file-lock contention → **Mitigation**: spec calls this out explicitly as a known limitation of unit-level testing and recommends a follow-up manual test session for true concurrent-process file writes.
- **[Trade-off]** Choosing not to fix the two confirmed defects means this change ships tests that document known-broken behavior rather than improving it → accepted, per explicit scope decision; recommended follow-ups are logged, not silently dropped.

## Migration Plan

Not applicable — this change adds tests and documentation only; no runtime behavior, schema, or dependency changes ship. Tests land incrementally per `tasks.md` and run under the existing three CI jobs with no workflow changes required.

## Open Questions

- Should the Known Gaps register's recommended follow-ups (single-instance plugin, GPU-merge fix, settings-pruning pass) become their own OpenSpec changes now, or wait until this test suite lands and characterizes current behavior first? (Recommendation: wait — characterizing first gives the follow-up fix changes a test to flip from red-on-fix to green, which is a cleaner signal than fixing blind.)
- Is a `HardwareSidebar.test.tsx` file expected to already exist and was missed, or genuinely absent? (Confirmed absent as of this writing — `src/components/` has no `.test.tsx` files at all; only hooks and `utils.ts` have tests. This spec introduces the first component-level test file.)
