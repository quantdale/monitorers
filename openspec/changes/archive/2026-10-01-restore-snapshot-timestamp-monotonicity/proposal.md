## Why

The IPC timestamp channel is written by **two different clock sources**, and the code that consumes it compares values across that boundary.

**Producer (backend, per session):** `collector/run_loop.rs` fixes a wall-clock origin once and then advances it with a monotonic clock:

```rust
let wall_origin_ms = Utc::now().timestamp_millis().max(0) as u64;
…
pub fn monotonic_timestamp_ms(wall_origin_ms: u64, epoch: Instant, now: Instant) -> u64 {
    wall_origin_ms.saturating_add(now.saturating_duration_since(epoch).as_millis() as u64)
}
```

This is deliberate and correct: the app's timestamps never move backwards when the system clock is adjusted mid-session, which is what the surrounding comments and the `test_monotonic_timestamp_projection_never_moves_backwards` unit test exist to guarantee.

**Producer (frontend, every full tick):** `src/hooks/useMetrics.ts` stamps live history commits with the browser's wall clock:

```ts
const timestamp = Date.now();
…
setHistory((previous) => { const next = appendSnapshotToHistory(base, snap, timestamp); … });
```

**Consumer (frontend, at the history/live seam):** `reconcileHistoryWithLiveEvents` decides whether a live event was already covered by an in-flight `get_history` response *by comparing those two sources against each other*:

```ts
const newest = current.timestamps.at(-1);
if (newest !== undefined && event.timestamp <= newest) return current;
return appendSnapshotToHistory(current, event.snapshot, event.timestamp) ?? current;
```

`newest` here comes from the backend's monotonic projection (for a fresh `get_history` response) and `event.timestamp` comes from the browser's `Date.now()`. The comparison is only sound if the two agree.

**Failure modes, all reachable in normal use:**

1. **Dropped sample.** The backend's projected clock is anchored at session start and advances monotonically. If the frontend's wall clock is *behind* the projection (clock adjustment, or a drift accumulated over a long session), `event.timestamp` is less than `newest` and a genuinely new full-tick sample is silently discarded — a permanent one-second hole in the chart with no error and no gap marker, because the sample is simply never appended.
2. **Duplicated sample.** The mirror case: frontend clock ahead of the projection causes an event already present in the response to be appended again, duplicating a point and desynchronising the channel from the timestamp ring.
3. **Window selection mis-slices.** `timestampWindowRange` / `sliceWindow` compute a cutoff from `timestamps[len-1] - window*1000`. With two interleaved clock sources, that newest value is whichever was written last, and a mixed ring produces a window that is off by the skew — the chart shows more or less elapsed time than the user selected, in a way that varies with clock behaviour rather than with the data.

There is also a simpler truthfulness problem: the backend's timestamps are *not* wall-clock after session start, and no document in the repository states this. A reader (or agent) seeing `monotonic_timestamp_ms` in the backend and `Date.now()` in the frontend has to rediscover the seam by reading both files. `AGENTS.md` describes the history contract as "250 ms monotonic live schedule … approximately 1 Hz history commits" without noting that the frontend stamps its own commits with a different clock.

The most direct fix is to stop writing a second clock: the frontend should take the timestamp from the payload it is appending (the backend already computes one per full tick) rather than minting its own, so the whole history ring has exactly one timestamp source.

## What Changes

- **Carry the backend's timestamp in the live snapshot payload** and have the frontend use it for history commits, so the entire history ring is produced by the single monotonic clock.
- **Make `reconcileHistoryWithLiveEvents` a same-source comparison.** Once live events and the history response share a timestamp source, the "already covered" check is sound by construction; keep the test that pins it.
- **Handle the transition honestly.** This is an IPC payload change, so `SCHEMA_VERSION` (Rust) and `EXPECTED_SCHEMA_VERSION` (TS) must both be bumped together — the repo's documented, existing mechanism — and the mock backend plus the simulation scenario schema must be updated to match. A mismatch must still fail closed with the existing actionable error.
- **Define behaviour for a missing/invalid timestamp** on the wire (a payload from an older build, or a mock that omits it): fall back to a documented, explicitly-marked strategy rather than silently mixing clocks or silently dropping samples.
- **Document the clock contract** in the developer documentation: one clock, monotonic within a session, what happens at session boundaries and on wall-clock adjustment.

## Dependencies

**This change is a prerequisite for `unify-mock-history-with-production-windowing`, which MODIFIES the same `metrics-history-streaming` requirement ("History arrays advance at exactly 1Hz end-to-end").**

An OpenSpec MODIFIED delta replaces a requirement block wholesale, so the two changes must be applied in order. This one goes first: it establishes that every timestamp in the history ring comes from a single producer (the backend's monotonic projection, carried on the live snapshot payload) and bumps the schema pair 5 -> 6. `unify-mock-history-with-production-windowing` then builds the mock's accumulating history on top of a payload that already carries a timestamp, instead of introducing one and being reworked when the schema moves.

The two concerns are complementary, not contradictory: this change is about **where timestamps come from**; the other is about **how a selected window slices them**. No requirement text conflicts, but the shared requirement block makes ordering mandatory.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities
- `metrics-history-streaming`: Adds the requirement that the frontend's live history commits are stamped from the same clock as the backend's history (so the history ring is single-sourced), and that the live/history reconciliation compares like with like.
- `collector-time-fidelity`: Extends the time-fidelity contract from the backend's monotonic projection to the end-to-end IPC history, so the "monotonic timestamps" property covers the timestamps the frontend actually stores, not just the ones the backend computes.

## Impact

- **Rust**: `src-tauri/src/collector/snapshot.rs` (add a timestamp field to `MetricsSnapshot`; `build_snapshot` populates it), `src-tauri/src/collector/run_loop.rs` (pass the already-computed tick timestamp into the snapshot rather than discarding it), `SCHEMA_VERSION` bump.
- **Frontend**: `src/hooks/useMetrics.ts` (use the payload timestamp for `appendSnapshotToHistory`; keep the reconciliation check), `EXPECTED_SCHEMA_VERSION` bump, and the `Date.now()` fallback path.
- **Mock**: `src/sim/mockBackend.ts` (emit a timestamp in snapshots consistent with its simulated clock, not `Date.now()` at arbitrary wall time).
- **Tests**: Rust snapshot tests (field present, monotonic across ticks), TS hook tests (commit uses payload timestamp; reconciliation still suppresses duplicates; missing timestamp falls back per the documented rule), and any E2E/journey that reads `data-chart-latest-ts` must keep working.
- **Compatibility**: any frontend/backend pair built from mismatched commits fails closed via the existing schema-version check — which is the intended, already-specified behaviour for a payload change.
- **Evidence (reproducible from the committed tree):**
  - `src-tauri/src/collector/run_loop.rs`: `monotonic_timestamp_ms(wall_origin_ms, loop_epoch, Instant::now())` used only for `s.push_timestamp(ts)`; the `MetricsSnapshot` returned by `build_snapshot` carries no timestamp.
  - `src/hooks/useMetrics.ts`: `const timestamp = Date.now();` inside `handleSnapshot`, used for both the live-event buffer and `appendSnapshotToHistory`.
  - `src/hooks/useMetrics.ts`: `reconcileHistoryWithLiveEvents` compares `event.timestamp` (frontend clock) against `current.timestamps.at(-1)` (backend clock).
  - `src-tauri/src/collector/snapshot.rs`: `MetricsSnapshot` has `schema_version`, `on_tick`, and the metric fields — no timestamp field.
