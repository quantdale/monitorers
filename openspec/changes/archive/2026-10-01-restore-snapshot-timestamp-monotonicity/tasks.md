## 1. Add the timestamp to the IPC snapshot (Rust)

- [x] 1.1 In `src-tauri/src/collector/snapshot.rs`, add a `timestamp_ms: u64` field to `MetricsSnapshot` and give `build_snapshot` a timestamp parameter that it copies into the field.
- [x] 1.2 In `src-tauri/src/collector/run_loop.rs`, compute the full-tick timestamp **once** (it is already computed for `push_timestamp`) and pass that same value to both `s.push_timestamp(ts)` and `build_snapshot`, so the ring value and the payload value are identical by construction rather than recomputed.
- [x] 1.3 Decide and document what timestamp a non-full (registry-only) tick carries. It MUST NOT cause a history append; `on_tick` remains the sole growth gate.
- [x] 1.4 Bump `SCHEMA_VERSION` in `src-tauri/src/collector/snapshot.rs` from 5 to 6. Do NOT touch `LIFECYCLE_SCHEMA_VERSION` (stays 1).
- [x] 1.5 Update every Rust test that constructs a `MetricsSnapshot` literal, and add an explicit assertion that the emitted snapshot's `timestamp_ms` equals the value pushed into the ring for that tick (not merely that the field is present).

## 2. Consume the timestamp in the frontend

- [x] 2.1 In `src/hooks/useMetrics.ts`, bump `EXPECTED_SCHEMA_VERSION` from 5 to 6, in the same change as the Rust bump.
- [x] 2.2 In `handleSnapshot`, use the payload's timestamp for `appendSnapshotToHistory` and for the live-event buffer entry instead of `Date.now()`.
- [x] 2.3 Implement the documented fallback for a missing/invalid payload timestamp: log the condition once (`console.warn`, matching existing repo convention) and append using the ring's newest known timestamp so the sample is preserved in order rather than dropped. Do NOT fall back to `Date.now()`.
- [x] 2.4 Leave `reconcileHistoryWithLiveEvents`'s already-covered check in place (it is correct once both sides share a source) and confirm it now compares like with like.
- [x] 2.5 Confirm `shouldCommitHistory(onTick)` remains the only growth gate: an off-tick snapshot carrying a valid timestamp must still append nothing.

## 3. Update the mock backend

- [x] 3.1 In `src/sim/mockBackend.ts`, emit a `timestamp_ms` in every snapshot, derived from the same anchor the mock already uses to stamp its seeded history (not a fresh `Date.now()` per snapshot), so the mock does not reintroduce a two-clock seam.
- [x] 3.2 Update the mock's default/derived schema version to match the new value and keep the scenario `schema_version` override behaviour intact.
- [x] 3.3 Confirm the mock's timestamp advances on the same cadence the history ring advances, so `on_tick` remains the growth gate there too.

## 4. Tests

- [x] 4.1 Rust: assert the snapshot timestamp equals the ring timestamp for the same tick; assert it never moves backwards across consecutive full ticks (extend the existing monotonic-projection test rather than replacing it).
- [x] 4.2 Rust: assert a registry-only (off-tick) snapshot carries a timestamp but does not grow any history channel.
- [x] 4.3 TS: assert a history-committing live event is appended using the payload's timestamp.
- [x] 4.4 TS: assert `reconcileHistoryWithLiveEvents` still suppresses an event already covered by the response AND does not drop a genuinely new event (the regression this change prevents).
- [x] 4.5 TS: assert a snapshot with a missing/invalid timestamp takes the documented fallback, logs once, and still appends the sample in order.
- [x] 4.6 TS: assert the schema-version bump rejects a mismatched payload with the existing actionable error (confirm the fail-closed path still fires).

## 5. Verify across lanes

- [x] 5.1 `npx tsc --noEmit` and `npm test -- --run` green.
- [x] 5.2 `npm run e2e` green — specifically confirm `chart-fidelity`, `long-watch-cadence`-equivalent behaviour, and anything reading `data-chart-latest-ts` still hold.
- [x] 5.3 `npm run sim` (mock matrix) green — every journey that reads chart timestamps (`customization-roundtrip`, `layout-persistence`, `first-launch-onboarding`, `fault-freeze-recovery`, `degraded-startup`).
- [x] 5.4 Rust: `cargo test`, `cargo fmt -- --check`, `cargo clippy --all-targets --all-features -- -D warnings` green.
- [x] 5.5 If a built exe is available, `npm run verify:packaged` green (real IPC exercises the bumped schema pair).
- [x] 5.6 `openspec validate restore-snapshot-timestamp-monotonicity --strict`.
- [x] 5.7 Confirm the two schema constants moved together: grep for `SCHEMA_VERSION` and `EXPECTED_SCHEMA_VERSION` and verify they are equal, and that `LIFECYCLE_SCHEMA_VERSION`/`EXPECTED_LIFECYCLE_SCHEMA_VERSION` are untouched at 1.

## 6. Document the clock contract

- [x] 6.1 Document in the developer documentation that the history ring has a single timestamp source (the backend's monotonic projection), what that means for wall-clock adjustment mid-session, and what the fallback rule is for a payload with no usable timestamp.
- [x] 6.2 Confirm no documentation states a stale current schema version (the value moved from 5 to 6) — reconcile every mention.
