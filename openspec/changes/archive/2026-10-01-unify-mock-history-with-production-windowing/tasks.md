## 0. Prerequisite (blocking)

- [x] 0.1 Confirm `restore-snapshot-timestamp-monotonicity` has been applied and archived: the live snapshot payload carries `timestamp_ms` and both schema constants are at the post-bump value. **Do not start this change before that is true** — the two changes MODIFY the same `metrics-history-streaming` requirement, and applying them out of order would silently discard one change's scenarios.

## 1. Add an accumulating history buffer to the mock backend

- [x] 1.1 In `src/sim/mockBackend.ts`, add an internal history structure: a `timestamps` array plus per-channel series for cpu, mem, net_recv, net_sent, and per-disk/per-gpu value series, plus the scalar fields the `HistoryPayload` shape needs (`cpu_name`, `cpu_temp_c`, and per-device read/write/response).
- [x] 1.2 Advance the buffer **only on history-committing emissions** (the existing `onTick` condition, `tick % 4 === 0`), matching the production 1 Hz history contract; do not advance on off-tick emissions.
- [x] 1.3 Cap the buffer at `MAX_HISTORY` (import the existing constant used by `useMetrics.ts`, value 3600) on every commit, mirroring `push_history`'s cap in the Rust ring.
- [x] 1.4 Add a one-time seed that writes a plausible pre-attach history into the buffer (reusing the existing `generateHistory` waveform so the values are unchanged) the first time history is requested before any commit has occurred. Do not regenerate on subsequent calls.

## 2. Honour the requested window

- [x] 2.1 Change `getHistory()` to `getHistory(windowSecs: number)` and return an elapsed-time window slice of the buffer, using the same semantics as the production backend (`build_history_payload` → `timestamp_window_range`).
- [x] 2.2 Ensure dynamically added devices (`disk-add`/`gpu-add` faults) are back-filled with `null` values to the current timestamp length in the buffer, preserving the pre-discovery gap the production `slice_aligned_history` produces.
- [x] 2.3 Ensure removed devices (`disk-remove`/`gpu-remove`) still prune from the buffer the same way `mergeDiskHistory`/`mergeGpuHistory` prune, so the `fault-disk-ghost` journey stays valid.
- [x] 2.4 Document at `MOCK_SEED_POINTS` / `HISTORICAL_DENSITY` that these describe *pre-attach seed* history, not the live commit rate (which is the 1 Hz full-tick cadence).

## 3. Pass the window through from the frontend

- [x] 3.1 In `src/hooks/useMetrics.ts`, change the browser branch from `getSimBackend().getHistory()` to pass the current `windowSeconds` to the mock, matching the Tauri branch's `invoke('get_history', { windowSecs: windowSeconds })`.
- [x] 3.2 Confirm the Tauri branch, the listener wiring, and the live-event replay path are unchanged.

## 4. Update and extend tests

- [x] 4.1 Update `src/sim/mockBackend.test.ts` for the new semantics: buffer accumulates across full ticks, off-tick emissions do not grow it, the cap holds, a window request slices the buffer, and a second request does not re-seed.
- [x] 4.2 Extend `e2e/tests/chart-fidelity.spec.ts` with production-semantics assertions: after data has accumulated, widening the window reveals earlier committed samples (larger span, and the oldest timestamp moves earlier), and narrowing the window shrinks the span while retaining the newest sample.
- [x] 4.3 Confirm the existing chart-fidelity assertions still hold, or restate them explicitly against the production contract if the seed/window interaction changes their expected values — justifying any change by the contract, not by observed mock behaviour.

## 5. Verify across lanes

- [x] 5.1 Run `npm test -- --run` and confirm the full frontend suite is green.
- [x] 5.2 Run `npm run e2e` and confirm the E2E suite is green with the extended windowing spec.
- [x] 5.3 Run the mock simulation matrix (`npm run sim`) and confirm every history-touching journey passes: `long-watch-cadence`, `degraded-startup`, `fault-disk-ghost`, `gpu-hotplug-gap`, `customization-roundtrip`, `layout-persistence`.
- [x] 5.4 Run `npx tsc --noEmit` and `npm run sim:typecheck`.
- [x] 5.5 Run `openspec validate unify-mock-history-with-production-windowing --strict`.
- [x] 5.6 Confirm `git status --porcelain` shows only `src/sim/mockBackend.ts`, `src/hooks/useMetrics.ts` (call site only), the mock test, and the E2E spec — and that no Rust file changed.
