## Why

The browser mock backend (`src/sim/mockBackend.ts`) and the real backend disagree about what a history-window change does, and every mock-lane assertion about windowing passes *because* of that disagreement rather than in spite of it.

In production, `get_history(windowSecs)` returns the backend's real ring buffer sliced to the requested elapsed-time window (`collector/snapshot.rs::build_history_payload` → `slice_timestamps`/`slice_history`/`slice_aligned_history` over the `timestamps` ring, which holds up to `HISTORY_CAPACITY = 3600` full-tick samples ≈ one hour). Switching from 30 s to 1 h therefore reveals *more of the same accumulated session*; the chart grows backwards in time but the data is the session's real history.

In the browser mock, `MockBackend.getHistory()` ignores the request entirely and calls `generateHistory()`, which fabricates a **fresh 300-point synthetic seed** (`MOCK_SEED_POINTS = 300`, spaced `HISTORICAL_DENSITY = 1000` ms apart, timestamped backwards from `Date.now()`). The frontend then replaces its accumulated live history with that seed (`acceptHistory` assigns `historyRef.current = next; setHistory(next)`).

Two consequences, both of which are defects rather than mock simplifications:

1. **Window behaviour is untestable in the mock lane.** `e2e/tests/chart-fidelity.spec.ts` asserts `span60 > 50_000` then, after selecting 30 s, `25_000 < span30 < 35_000`. Both assertions are satisfied by the *re-seed* mechanism; neither exercises the production `sliceWindow`/elapsed-time-window path against a real accumulated ring. The same applies to the `long-watch-cadence` journey, which sets a 1 h window and only checks that the latest timestamp advances and stays within CI bounds — trivially true of a 300-point seed. So the one lane whose whole purpose is to be a faithful, drivable stand-in for the packaged app is structurally incapable of catching a regression in windowing over accumulated history.

2. **The mock diverges observably from production in a way a journey/user would notice.** After a window change in browser mode the chart is replaced by a sine series unrelated to the values that were just streaming — the CPU % readout and the chart disagree, and a full 1 h window shows only ~5 minutes of synthetic data rather than an hour. The repo already has a `simulation-trust` capability whose purpose is exactly to keep the mock honest, and `AGENTS.md` requires journeys to prove the mock lane is a faithful stand-in.

There is a second, smaller truthfulness gap in the same area: `getHistory()` takes no window argument, so the mock cannot honour a window request even in principle, and `HISTORICAL_DENSITY`/`MOCK_SEED_POINTS` are module constants whose relationship to the production 1 Hz commit cadence is undocumented at the call site.

## What Changes

- **Give the mock backend a real, accumulating history buffer** that mirrors the production semantics: a ring of committed samples with recorded timestamps, advanced on full-tick (`on_tick`) emissions at the simulated 1 Hz cadence, capped at the same `MAX_HISTORY` capacity the production ring uses.
- **Make `MockBackend.getHistory(windowSecs)` return a window slice of that buffer** using the same elapsed-time-window semantics the production backend uses, instead of fabricating a new seed on every call. The first call (before any tick has been committed) still seeds a plausible history so first paint and the existing "chart grows at ~1 point/sec" assertions keep working — but that seed is written **into** the buffer once, not regenerated per call.
- **Keep `sliceWindow`/`timestampWindowRange` in `useMetrics.ts` as the single windowing implementation** for the frontend, and have the mock's response match its shape exactly, so the frontend code path under test is identical in both lanes.
- **Restore the coverage this gap removed**: extend `e2e/tests/chart-fidelity.spec.ts` (and/or a new spec) so the mock lane asserts window *slicing over accumulated history* — i.e. that selecting a wider window after data has accumulated reveals earlier recorded samples, and that a narrower window shows a strictly smaller span — which is the production behaviour.
- **Document the mock's cadence constants** relative to the production 1 Hz commit so future edits to `HISTORICAL_DENSITY`/`MOCK_SEED_POINTS` are not silently divergent.

## Dependencies

**This change depends on `restore-snapshot-timestamp-monotonicity` and MUST be applied after it.**

Both changes MODIFY the same requirement in `metrics-history-streaming` ("History arrays advance at exactly 1Hz end-to-end"), and an OpenSpec MODIFIED delta replaces that requirement block wholesale. Applying them in the wrong order would silently discard the other change's scenarios. The two are complementary, not contradictory:

- `restore-snapshot-timestamp-monotonicity` establishes the **provenance** of every timestamp in the ring (one clock: the backend's monotonic projection, carried in the live snapshot payload) and bumps the schema pair 5 -> 6.
- this change establishes the **windowing semantics** of the history (a window re-slices accumulated history; the mock obeys the same rule).

Landing the timestamp change first means the mock backend is built against a snapshot payload that already carries a timestamp, so this change does not have to introduce one and then be reworked when the schema moves. Do not apply this change before `restore-snapshot-timestamp-monotonicity` has landed.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `simulation-trust`: Extends the mock-fidelity contract so the scriptable backend's history semantics match the production backend's — an accumulating, window-sliceable ring advanced on full ticks — instead of regenerating a synthetic seed per `get_history` call, so the mock lane is a faithful stand-in for windowing behaviour.
- `metrics-history-streaming`: Adds the behavioural requirement that changing the selected history window re-slices the session's accumulated history (revealing more recorded samples for a wider window, fewer for a narrower one) rather than replacing it with unrelated data — a contract the mock backend must now also honour.

## Impact

- **Source**: `sys-monitor-tauri/src/sim/mockBackend.ts` (history buffer, `getHistory(windowSecs)`, cadence constants + comments).
- **Frontend (minimal)**: `sys-monitor-tauri/src/hooks/useMetrics.ts` must pass the current `windowSeconds` into the mock's `getHistory` (production already passes `windowSecs` over IPC; the mock call site currently passes nothing). This is a one-line call-shape change, not a logic change.
- **Tests**: `sys-monitor-tauri/e2e/tests/chart-fidelity.spec.ts` extended (or a new windowing spec added); `sys-monitor-tauri/src/sim/mockBackend.test.ts` extended for the new buffer semantics.
- **Sim platform**: any journey that assumed a re-seed on window change must be re-checked (the runner passes `windowSecs` through `S.setWindow` → the app → `useMetrics`; no engine change is expected, but `long-watch-cadence` in particular should be re-validated).
- **Not affected**: the Rust backend, the real/packaged lane, the production `get_history` implementation, IPC schemas.
- **Evidence (reproducible from the committed tree):**
  - `src/sim/mockBackend.ts`: `getHistory(): Promise<HistoryPayload> { const payload = this.generateHistory(); … }` — the requested window is not a parameter, and the payload is fabricated per call.
  - `src/hooks/useMetrics.ts`: browser branch calls `getSimBackend().getHistory()` with no argument, whereas the Tauri branch calls `invoke<HistoryPayload>('get_history', { windowSecs: windowSeconds })`.
  - `src/sim/mockBackend.ts`: `MOCK_SEED_POINTS = 300`, `HISTORICAL_DENSITY = 1000`, and `generateHistory()` stamps `now - (n - 1 - i) * HISTORICAL_DENSITY`.
  - `e2e/tests/chart-fidelity.spec.ts`: assertions hold under a per-call re-seed, so they do not exercise accumulated-history slicing.
