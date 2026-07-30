## 1. Setup

- [x] 1.1 Confirm current baseline test counts before adding anything: `cargo test` (expect 70) from `src-tauri/`, `npm test -- --run` (expect 41) from `sys-monitor-tauri/`. **Frontend baseline actually 46** (grown since CLAUDE.md's documented 41, from the `fix-history-emission-rate` change). **Rust baseline could not be run in this environment** — see note in section 8/Verify below; `cargo test`/`check`/`clippy` all fail during dependency compilation (`gdk-sys` requires system GTK dev headers not present, and this Linux sandbox has no network access to install them) before reaching this crate's own code at all. This is a pre-existing constraint of the Windows-only Tauri app, not something introduced by this change.
- [x] 1.2 Create `src/components/HardwareSidebar.test.tsx` (first component-level test file in this repo) with a minimal render harness for `defaultSidebarCardOrder`/`cardOrder` merge logic, extracting that pure logic into an exported helper if it isn't already easily testable in isolation. Extracted `mergeSidebarCardOrder` (exported) alongside the now-exported `defaultSidebarCardOrder`.

## 2. Identity stability — dashboard (content-keyed)

- [x] 2.1 Test: `gpuId` is deterministic for repeated calls with the same name (`src/utils.test.ts`). Already covered pre-change.
- [x] 2.2 Test: saved `cardOrder`/`hiddenCardIds` reproduce the same visible arrangement when hardware is unchanged between loads. Extracted `computeVisibleCardOrder`/`isCardPresent`/`computeDefaultCardIds`/`mergeNewCardIds` into `src/cardIdentity.ts`; `App.tsx` now calls them. Tested in `src/cardIdentity.test.ts`.
- [x] 2.3 Test: a new disk/GPU id not present in saved `cardOrder` is appended to the end, preserving existing order.
- [x] 2.4 Test: no settings write occurs when the merge finds no new ids (`mergeNewCardIds` returns `null`).
- [x] 2.5 Test: a disk id absent from the current snapshot is excluded from `visibleCardOrder` while `cardOrder` itself is left unmodified (ghost-entry characterization).
- [x] 2.6 Test: a disk id that reappears with the same key returns to its original position without re-triggering the new-hardware merge path.
- [x] 2.7 Test: a card hidden via `hiddenCardIds` stays hidden across the underlying hardware disappearing and reappearing.

## 3. Identity stability — sidebar (positional-keyed) and GPU merge defect

- [x] 3.1 Test (in new `HardwareSidebar.test.tsx`): `sb_gpu_0` refers to whatever GPU occupies index 0 of `profile.gpus`, and this changes if the array order changes between two profile objects — characterizing the positional-identity gap explicitly.
- [x] 3.2 Test (Rust, `collector/gpu.rs`): two LUIDs classified to the same brand-stripped display name produce one merged entry with summed utilization. Extracted the merge step into a small pure helper (`merge_gpu_utilization_by_caption`, behavior-preserving refactor) so it's directly unit-testable; characterization test added. **Could not be compiled/run in this environment** (see 1.1) — written carefully against the existing code patterns but unverified by `cargo test`; needs confirmation on a Windows CI/dev machine.
- [x] 3.3 Test (Rust, `collector/gpu.rs`): summed utilization for same-named GPUs is capped at 100%. Same compile-verification caveat as 3.2.
- [x] 3.4 Cross-referenced the characterization tests in 3.1–3.3 to design.md's Known Gaps via doc comments on `merge_gpu_utilization_by_caption` (Rust) and `mergeSidebarCardOrder` (TS).

## 4. Settings persistence & concurrent-write safety

- [x] 4.1 Test (`useSettings.test.ts`): several rapid, non-awaited `save()` calls to the same key converge to the last-applied value in memory.
- [x] 4.2 Test (`useSettings.test.ts`): concurrent `save()` calls to different keys both land in the final settings state (no clobbering across keys).
- [x] 4.3 Test (`useSettings.persistence.test.ts`, new file): a fresh `useSettings` load from the same store returns previously saved non-default values (persistence-across-restart). Mocks `@tauri-apps/plugin-store` with an in-memory map keyed by store path, shared across `Store.load()` calls, so two hook mounts against the "same" store simulate an app restart without touching the filesystem.
- [x] 4.4 Test (Rust, `state.rs`): a freshly constructed `HistoryStore` always starts with empty ring buffers, regardless of what a prior instance held (persistence-boundary, telemetry side). Same compile-verification caveat as 3.2.
- [x] 4.5 Test (`useSettings.test.ts`): characterizes the dual-instance gap at the reducer-logic level — a fixed chronological interleaving of two instances' patches is deterministic last-write-wins per key, and demonstrates that naively batching each instance's patches together first (rather than true arrival-order interleaving) can diverge from the correct result — pinning why a single-instance guard matters, per design.md Risks. Real OS-level file-write concurrency remains out of scope, as noted in the test.

## 5. Collector lifecycle & failure modes

- [x] 5.1 Test (Rust, `main.rs`): a panic inside the tick body's `catch_unwind` results in exactly one `collector-error` emission and no further `metrics-update` emissions on that run. Modeled the tick loop's match arms directly (no real thread/app handle needed). Same compile-verification caveat as 3.2.
- [x] 5.2 Test (`useMetrics.hook.test.ts`, new file): once `collectorError` is set from a `collector-error` event, it remains set (no automatic clearing) for the lifetime of the hook instance, even across further `metrics-update` events. Mocks `@tauri-apps/api/event`/`core` to exercise the real listener wiring.
- [x] 5.3 Test (Rust, `main.rs`): `is_full_poll_tick` cadence holds over ticks 0–399 (extended from the existing 0–8 range), asserting exactly 1/4 are full-poll ticks. Same compile-verification caveat as 3.2.
- [x] 5.4 Test (`useMetrics.hook.test.ts`): given a sequence of `on_tick: true`/`false` events at the real 250ms rate over a simulated sustained period (40 events / 10s), the resulting history array length (10) matches elapsed seconds, not event count (40).
- [ ] 5.5 Absorbed manual-verification item (was task 8.7 in `fix-history-emission-rate`): run `npm run tauri dev` continuously for at least one full selected time window and confirm via stopwatch/timestamp spot-check that the "1 hour" window tracks real elapsed time 1:1, and that CPU/GPU readouts visibly update multiple times per second. **Not run — requires an interactive Windows session with real hardware sensors; genuinely not automatable and not performable from this Linux sandbox.** Left for manual verification before merge/release, same as it was in the source change.
- [x] 5.6 Test (`useMetrics.test.ts`): `assertSchemaVersion` logs an error when `actual !== EXPECTED_SCHEMA_VERSION`, and logs nothing when they match. Already fully covered by pre-existing tests (match, undefined, greater, lesser cases) — no new test needed.
- [x] 5.7 Test (Rust, `collector/mod.rs`): metrics polling produces a valid snapshot when `wmi_con` is `None` (WMI unavailable), with CPU thermal absent and no panic. Follows the existing precedent in `collector/nvidia.rs` of constructing a real `CollectorState` in a test. Same compile-verification caveat as 3.2.

## 6. Everyday longitudinal usage

- [x] 6.1 Test (Rust, `collector/mod.rs` `push_history`): pushing past `MAX_HISTORY` (3600) capacity drops the oldest sample and keeps length capped. Same compile-verification caveat as 3.2.
- [x] 6.2 Test (Rust, `state.rs`/`collector/mod.rs`): `timestamps` and `cpu_history` stay length-synchronized across a simulated run of pushes exceeding capacity. Same compile-verification caveat as 3.2.
- [x] 6.3 Test (`cardIdentity.test.ts`): before any `HistoryPayload`/`metrics-update` arrives, the app is in the "Collecting metrics…" state rather than attempting to render cards. Extracted `shouldShowLoadingState` pure helper (used by `App.tsx`) rather than a full DOM render, consistent with this project's preference for pure-function-level tests over heavy integration harnesses (see design.md Decisions).
- [x] 6.4 Test (`cardIdentity.test.ts`): a metrics snapshot with an empty `gpus` array and all-null `nvidia_*` fields renders with `hasNvidiaData` false, without a null-reference error. Extracted `computeHasNvidiaData` pure helper.

## 7. Known Gaps register and documentation

- [x] 7.1 Cross-referenced design.md's Known Gaps from their corresponding characterization tests: `merge_gpu_utilization_by_caption`'s doc comment and its test module header (Rust GPU-merge defect); `mergeSidebarCardOrder`'s doc comment and the "known gap" describe block in `HardwareSidebar.test.tsx` (positional-identity gap); the dual-instance interleaving test's comments (`useSettings.test.ts`, 4.5) reference the missing single-instance guard.
- [x] 7.2 Updated `openspec/changes/fix-history-emission-rate/tasks.md` task 8.7 to note it has been absorbed into this change's task 5.5.
- [x] 7.3 Run full verification: **Frontend** — `npx tsc --noEmit` clean; `npm run build` succeeds; `npm test -- --run` passes with **77 tests** (baseline 46 + 31 new, across `cardIdentity.test.ts` (new), `HardwareSidebar.test.tsx` (new), `useSettings.test.ts` (extended), `useSettings.persistence.test.ts` (new), `useMetrics.hook.test.ts` (new)). **Rust** — `cargo fmt -- --check` passes (clean). `cargo test`/`cargo check`/`cargo clippy` could **not** be run: this session is a Linux sandbox and the project is an unconditionally Windows-only Tauri app (no `cfg(windows)` gating anywhere in the crate; `tauri`'s Linux webview backend pulls in `gdk-sys`, which fails to build without system GTK dev headers, and this sandbox has no network access to install them — confirmed by attempting `apt-get install libgtk-3-dev ...`, which 404'd against the configured mirrors). All new Rust tests (sections 3.2–3.3, 4.4, 5.1, 5.3, 5.7, 6.1–6.2) were written carefully against existing code patterns and idioms in the same files, but are **unverified by compilation** — this must be confirmed by running `cargo test` on a Windows machine or the `rust-test`/`rust-lint` CI jobs before merging.
