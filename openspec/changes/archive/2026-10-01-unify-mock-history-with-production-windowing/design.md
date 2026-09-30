## Context

Two implementations of the same contract exist: the real backend's ring buffer (`src-tauri/src/state.rs::HistoryStore`, driven by `build_history_payload` in `collector/snapshot.rs`) and the browser mock (`src/sim/mockBackend.ts::MockBackend`). `useMetrics.ts` is the single consumer of both and already has the production windowing implementation in TypeScript (`timestampWindowRange`, `sliceWindow`, `sliceWithRange`), which operates on whatever payload it receives.

The production side slices a real ring:

```rust
// collector/snapshot.rs
pub fn timestamp_window_range(timestamps: &VecDeque<u64>, window_secs: u64) -> (usize, usize) { … }
pub fn slice_timestamps(deque: &VecDeque<u64>, window_secs: u64) -> Vec<u64> { … }
```

The mock side ignores the request entirely:

```ts
// src/sim/mockBackend.ts
getHistory(): Promise<HistoryPayload> {
  const payload = this.generateHistory();   // fresh 300-point sine seed, every call
  …
}
```

and its call site passes nothing, while the Tauri branch passes the window:

```ts
// src/hooks/useMetrics.ts
if (isTauri()) {
  invoke<HistoryPayload>('get_history', { windowSecs: windowSeconds }) …
} else {
  getSimBackend().getHistory().then(acceptHistory).catch(rejectHistory);
}
```

`acceptHistory` then *replaces* frontend history state with whatever came back, so in the mock lane a window change swaps the streaming data for an unrelated sine series.

## Goals / Non-Goals

**Goals:**

- Make the mock backend's history behaviour observably equivalent to production: accumulate on full ticks at the simulated 1 Hz cadence, cap at the production capacity, and slice by elapsed time on request.
- Ensure the frontend windowing code path exercised in the mock lane is the same one used in production.
- Restore the coverage that the re-seed mechanism was silently satisfying, by making window-over-accumulated-history drivable and asserted.

**Non-Goals:**

- No change to the Rust backend or to the production `get_history` command. The production side is the reference; it is not being modified.
- No change to the mock's *waveform generator* (`sinAt`, `diskWave`, `gpuWave`, `nvidiaStatsFor`) — the values produced per tick stay exactly as they are. Only their *retention and slicing* change.
- No change to the simulation engine, drivers, or journey contracts.
- No new IPC fields; `HistoryPayload` is unchanged.

## Decisions

### D1 — Give the mock a real ring, seeded once

The mock gains an internal history buffer: a `timestamps` array plus per-channel arrays (cpu/mem/net_recv/net_sent, per-disk and per-gpu series), advanced on every `on_tick` emission — the same `this.tick % 4 === 0` condition `composeSnapshot()` already computes — and trimmed to `MAX_HISTORY` (3600, the same value the production ring uses, already exported by `useMetrics.ts`). The one-time seed is written *into* this buffer on first use so first paint stays deterministic and the existing "chart grows at ~1 point/sec" and "span > 50 s" assertions continue to hold without rewriting them.

- **Alternative considered — keep generating on demand but slice the generated series to the window.** Rejected: this preserves the core defect. Every call still returns data unrelated to what actually streamed, and a window change still replaces the live series, so nothing about accumulated history is being tested. It would make the specs pass while leaving the divergence intact.
- **Alternative considered — have the mock call the frontend's own `sliceWindow`.** Rejected: the mock is a *backend* stand-in; importing frontend windowing into it inverts the dependency and would not test that the mock's *payload* is correctly sliced. The mock must produce a correctly-shaped sliced payload so the frontend's `sliceWithRange` then does what it does in production.

### D2 — Mock history advances on full ticks only, matching the 1 Hz contract

`metrics-history-streaming` already requires that history advance at exactly 1 Hz end-to-end and never on off-tick events. The mock must honour the same rule or the mock lane would be validating a cadence the production lane forbids. So the buffer is advanced inside the existing `onTick` branch of `composeSnapshot`/`advance`, not on every tick. This also keeps the `degraded-startup` and `freeze` fault journeys meaningful: a freeze holds values, and history still commits at 1 Hz with held values, exactly as a PDH freeze behaves in production.

### D3 — Preserve dynamic-device gap semantics in the mock buffer

`metrics-history-streaming` requires that a disk/GPU appearing mid-session has `null` gaps before its first observation, and the existing `mergeDiskHistory`/`mergeGpuHistory` produce those. The mock's seeded disk/gpu series are already aligned to the seed length, so once the buffer accumulates, newly added devices (`disk-add`/`gpu-add` faults) must be back-filled with `null` to the current timestamp length — the same rule the Rust `slice_aligned_history` applies. The `gpu-hotplug-gap` journey asserts exactly this (`data-chart-gap-count > 0`), so this must keep working after the buffer change.

### D4 — Extend the E2E windowing spec rather than adding a new spec file

`e2e/tests/chart-fidelity.spec.ts` is the natural home: it already owns "the history pipeline respects the selected window and grows at ~1 point/sec". The new assertions belong there and should assert the *production* semantics — widening reveals earlier committed samples; narrowing shrinks the span and keeps the newest sample — rather than the current span-only checks that the re-seed satisfied trivially. Adding a separate spec file would fragment one concern across two files.

## Risks / Trade-offs

- **[Existing mock assertions depend on the per-call re-seed]** → Re-run the whole mock suite and the simulation matrix; the specs identified in the exploration (`chart-fidelity` span assertions, `long-watch-cadence`) are the ones most likely to need their expectations restated to the new (correct) semantics. Any change to an expectation must be justified by the production contract, not by "the mock now behaves differently".
- **[The one-time seed's timestamp spacing (`HISTORICAL_DENSITY = 1000` ms) is not the production 1 Hz commit for the first 300 samples]** → It is a *seed* representing history that predates the page load, which is exactly what the real backend also returns (history committed before the frontend attached). The relationship must be documented at the constant, and the seed length must be understood as "pre-attach history", not as the live commit rate. The live rate after seeding is the 1 Hz full-tick cadence.
- **[A long mock run could grow the buffer without bound]** → The ring is capped at `MAX_HISTORY` on every commit, exactly as `push_history` caps the Rust ring; memory is bounded and mirrors production.
- **[Device-removal faults (`disk-remove`/`gpu-remove`) must still prune]** → The buffer must drop or ghost-manage removed devices the way `mergeDiskHistory`/`mergeGpuHistory` do. The `fault-disk-ghost` journey covers this and must stay green.
- **Risk of scope creep into waveform changes** → Explicitly out of scope (see Non-Goals). Any pressure to "improve" the sine generator during this change should be deferred to a separate change.

## Migration Plan

1. Add the history buffer + one-time seed to `MockBackend`, advanced on full ticks and capped at `MAX_HISTORY`.
2. Change `getHistory()` to `getHistory(windowSecs)` and return an elapsed-time slice of the buffer, with `null`-backfilled dynamic-device series for newly-added devices.
3. Update the `useMetrics.ts` browser call site to pass `windowSeconds`.
4. Update `mockBackend.test.ts` for the new semantics; extend `chart-fidelity.spec.ts` with window-over-accumulated-history assertions.
5. Re-run the mock simulation matrix and confirm every journey that touches history still passes (`long-watch-cadence`, `degraded-startup`, `fault-disk-ghost`, `gpu-hotplug-gap`, `customization-roundtrip`, `layout-persistence`).
6. Rollback: revert the mock + call-site + spec changes. No production code, schema, or persisted state is affected, so rollback is safe at any point.

## Open Questions

- Whether the pre-attach seed length (300) should eventually be made configurable per scenario is a nicety, not a requirement; it is safe to leave at the existing constant and defer.
