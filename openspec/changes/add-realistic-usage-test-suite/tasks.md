## 1. Setup

- [ ] 1.1 Confirm current baseline test counts before adding anything: `cargo test` (expect 70) from `src-tauri/`, `npm test -- --run` (expect 41) from `sys-monitor-tauri/`.
- [ ] 1.2 Create `src/components/HardwareSidebar.test.tsx` (first component-level test file in this repo) with a minimal render harness for `defaultSidebarCardOrder`/`cardOrder` merge logic, extracting that pure logic into an exported helper if it isn't already easily testable in isolation.

## 2. Identity stability — dashboard (content-keyed)

- [ ] 2.1 Test: `gpuId` is deterministic for repeated calls with the same name (`src/utils.test.ts`).
- [ ] 2.2 Test: saved `cardOrder`/`hiddenCardIds` reproduce the same visible arrangement when hardware is unchanged between loads (`src/App.tsx` logic — extract `isCardPresent`/merge logic to a testable helper if needed, or test via a focused render test).
- [ ] 2.3 Test: a new disk/GPU id not present in saved `cardOrder` is appended to the end, preserving existing order (App.tsx first-launch/merge effect logic).
- [ ] 2.4 Test: no settings write occurs when the merge finds no new ids.
- [ ] 2.5 Test: a disk id absent from the current snapshot is excluded from `visibleCardOrder` while `cardOrder` itself is left unmodified (ghost-entry characterization).
- [ ] 2.6 Test: a disk id that reappears with the same key returns to its original position without re-triggering the new-hardware merge path.
- [ ] 2.7 Test: a card hidden via `hiddenCardIds` stays hidden across the underlying hardware disappearing and reappearing.

## 3. Identity stability — sidebar (positional-keyed) and GPU merge defect

- [ ] 3.1 Test (in new `HardwareSidebar.test.tsx`): `sb_gpu_0` refers to whatever GPU occupies index 0 of `profile.gpus`, and this changes if the array order changes between two profile objects — characterizing the positional-identity gap explicitly.
- [ ] 3.2 Test (Rust, `collector/gpu.rs`): two LUIDs classified to the same brand-stripped display name produce one merged entry with summed utilization — characterization test for the confirmed merge defect, labeled clearly as pinning a known defect, not a requirement.
- [ ] 3.3 Test (Rust, `collector/gpu.rs`): summed utilization for same-named GPUs is capped at 100%.
- [ ] 3.4 Add a code comment or doc-test annotation on the characterization tests in 3.1–3.3 cross-referencing design.md's Known Gaps / recommended fix, so a future fix change finds them easily.

## 4. Settings persistence & concurrent-write safety

- [ ] 4.1 Test (`useSettings.test.ts`): several rapid, non-awaited `save()` calls to the same key converge to the last-applied value in memory.
- [ ] 4.2 Test (`useSettings.test.ts`): concurrent `save()` calls to different keys both land in the final settings state (no clobbering across keys).
- [ ] 4.3 Test (`useSettings.test.ts`): a fresh `useSettings` load from the same store returns previously saved non-default values (persistence-across-restart).
- [ ] 4.4 Test (Rust, `state.rs`): a freshly constructed `HistoryStore` always starts with empty ring buffers, regardless of what a prior instance held (persistence-boundary, telemetry side).
- [ ] 4.5 Test (`useSettings.test.ts` or a new focused test): two interleaved patch sequences (simulating two app instances) applied to the settings reducer in a defined interleaving order produce the same result as plain sequential last-write-wins application — characterizing the dual-instance gap at the logic level, with an explicit comment noting real OS-level file-write concurrency is out of scope for unit tests (see design.md Risks).

## 5. Collector lifecycle & failure modes

- [ ] 5.1 Test (Rust, `main.rs` or extracted helper): a panic inside the tick body's `catch_unwind` results in exactly one `collector-error` emission and no further `metrics-update` emissions on that run (extend existing `test_catch_unwind_*` tests toward this end-to-end shape if feasible without spawning a real thread; otherwise test the emission-count logic in isolation).
- [ ] 5.2 Test (`useMetrics.test.ts`): once `collectorError` is set from a `collector-error` event, it remains set (no automatic clearing) for the lifetime of the hook instance.
- [ ] 5.3 Test (Rust, `main.rs`): `is_full_poll_tick` cadence holds over a sustained range of ticks (extend existing tests to a larger range, e.g. 0–399, asserting exactly 1/4 are full-poll ticks).
- [ ] 5.4 Test (`useMetrics.test.ts`): given a sequence of `on_tick: true`/`false` events at the real 250ms rate over a simulated sustained period, the resulting history array length matches elapsed seconds, not event count.
- [ ] 5.5 Add task 5.5 as the absorbed manual-verification item (was task 8.7 in `fix-history-emission-rate`): run `npm run tauri dev` continuously for at least one full selected time window and confirm via stopwatch/timestamp spot-check that the "1 hour" window tracks real elapsed time 1:1, and that CPU/GPU readouts visibly update multiple times per second. **Manual — requires an interactive Windows session with real hardware sensors; not automatable with current tooling.**
- [ ] 5.6 Test (`useMetrics.test.ts`): `assertSchemaVersion` logs an error when `actual !== EXPECTED_SCHEMA_VERSION`, and logs nothing when they match.
- [ ] 5.7 Test (Rust, `collector/mod.rs` or `main.rs`): metrics polling produces a valid snapshot when `wmi_con` is `None` (WMI unavailable), with only GPU vendor classification/CPU thermal fields absent.

## 6. Everyday longitudinal usage

- [ ] 6.1 Test (Rust, `collector/mod.rs` `push_history`): pushing past `HISTORY_LEN` capacity drops the oldest sample and keeps length capped.
- [ ] 6.2 Test (Rust, `state.rs`): `timestamps` and `cpu_history` (or another parallel pair) stay length-synchronized across a simulated run of pushes exceeding `HISTORY_LEN`.
- [ ] 6.3 Test (`useMetrics.test.ts` / App-level test): before any `HistoryPayload`/`metrics-update` arrives, the app is in the "Collecting metrics…" state rather than attempting to render cards.
- [ ] 6.4 Test: a metrics snapshot with an empty `gpus` array and all-null `nvidia_*` fields renders with no GPU card and `hasNvidiaData` false, without a null-reference error.

## 7. Known Gaps register and documentation

- [ ] 7.1 Confirm design.md's Known Gaps (single-instance enforcement, GPU merge defect, settings-id pruning, no E2E harness) are each cross-referenced from their corresponding characterization test(s) added in sections 2–5.
- [ ] 7.2 Update `openspec/changes/fix-history-emission-rate/tasks.md` task 8.7 to note it has been absorbed into this change's task 5.5, so it isn't tracked as separately outstanding once this change is applied.
- [ ] 7.3 Run full verification: `cargo test` (Rust) and `npm test -- --run` (frontend) both pass with the new tests included; confirm counts have grown from the 1.1 baseline and record the new counts in the PR/change summary.
