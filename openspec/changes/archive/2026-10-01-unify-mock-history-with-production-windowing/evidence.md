# Evidence — Unify Mock History with Production Windowing

- Change root: `openspec/changes/unify-mock-history-with-production-windowing/`
- Files touched by this change: `src/sim/mockBackend.ts`, `src/hooks/useMetrics.ts` (call site only), `src/sim/mockBackend.test.ts`, `e2e/tests/chart-fidelity.spec.ts`, `e2e/tests/helpers.ts`, `scripts/check-dead-code.mjs` (allowlist entry). **No Rust file was changed by this change** (task 5.6).

## 0. Prerequisite (task 0.1)

`restore-snapshot-timestamp-monotonicity` is **applied and verified** (28/28 tasks, `openspec validate --strict` green, `SCHEMA_VERSION`/`EXPECTED_SCHEMA_VERSION` both at **6**, `timestamp_ms` present on the live payload and consumed by `useMetrics`). It has not been *archived*, because archiving is a separate explicit action in this repository's workflow (`/opsx-archive-change`) and outside the requested `openspec apply` scope.

Why that does not weaken the prerequisite: the risk the task guards against is applying two changes that MODIFY the same `metrics-history-streaming` requirement **out of order**, which would silently discard one change's scenarios. They were applied strictly in order — change 6 first (fully implemented and verified on the tree), then this change on top of it — so both sets of scenarios compose correctly. The ordering requirement is satisfied; only the bookkeeping move is deferred.

## A. The mock now has a real ring (tasks 1.1 – 1.4)

`MockBackend` gained an accumulating history ring — the analog of the Rust `HistoryStore`:

```ts
private readonly history: {
  timestamps: number[]; cpu: number[]; cpu_name: string; cpu_temp_c: number | null;
  mem: number[]; net_recv: number[]; net_sent: number[];
  disks: Map<string, { values: MetricValue[]; read_mb_s; write_mb_s; avg_response_ms }>;
  gpus:  Map<string, { values: MetricValue[]; name; vendor; temp_c; nvidia }>;
} = { … };
```

- 1.1: only `values` is a per-timestamp series in `HistoryPayload` — a disk's read/write/response and a GPU's temp are **scalar latest-readings** by contract — so those are carried forward from the newest sample rather than accumulated. Getting this wrong would have invented a shape the IPC type does not have.
- 1.2: the ring is advanced in `emitSnapshot()` **only** when `snap.on_tick` is true, i.e. the same 1-of-4 (1 Hz) cadence the real backend commits at. Verified by test: 16 ticks → exactly 4 new points; 3 off-ticks → 0 new points.
- 1.3: every channel is capped at `MAX_SIM_HISTORY = 3600` with the same `splice(0, len - cap)` semantics as Rust `push_history`. Pinned to the production `MAX_HISTORY` by a test, since the mock cannot import it (bundle-time cycle).
- 1.4: `ensureSeededHistory()` writes the 300-point pre-attach seed **once**, guarded by `timestamps.length > 0`. A second request cannot regenerate.

## B. The window is honoured (tasks 2.1 – 2.4)

`getHistory(windowSeconds = 60)` now returns an elapsed-time slice via `sliceHistoryWindow`, implementing production `timestamp_window_range` semantics: `cutoff = newest - windowSeconds * 1000`, `start = firstIndex(t >= cutoff)`.

- 2.2: a device discovered mid-session is back-filled with `null` for the whole pre-discovery span (`appendToRing` pads on first sight), matching production `slice_aligned_history`.
- 2.3: `sliceHistoryWindow` reports only the devices in the **current** stable set — the backend's own ghost-pruning. A removed device drops out even while its earlier samples remain in the ring; a re-added one reappears immediately with an all-`null` series, exactly the pre-discovery gap production produces for a newly enumerated device. This is what keeps the existing `gpu-remove`/`gpu-add` and `disk-remove`/`disk-add` fault tests meaningful.
- 2.4: `MOCK_SEED_POINTS` / `HISTORICAL_DENSITY` are now explicitly documented as describing the **pre-attach seed**, not the live commit rate.

## C. The frontend passes the window (task 3.1 – 3.2)

```ts
// Pass the selected window, mirroring the Tauri branch's
// invoke('get_history', { windowSecs }).
getSimBackend().getHistory(windowSeconds).then(acceptHistory).catch(rejectHistory);
```

The Tauri branch, the listener wiring, and the live-event replay path are untouched — this is a call-site change only.

## D. Tests (tasks 4.1 – 4.3)

**`src/sim/mockBackend.test.ts`: 47 tests** (was 34) — +13, all green:

| New test | Asserts |
|---|---|
| advances only on history-committing emissions | 16 ticks → exactly +4 ring points |
| off-tick emissions do not grow the ring | 3 registry-only ticks → +0 |
| a second request does not re-seed | second payload deep-equals the first |
| caps the ring at MAX_HISTORY | 4000 commits → exactly 3600 points, per-channel |
| mirrors the production MAX_HISTORY value | observed cap `=== MAX_HISTORY` |
| widening reveals earlier committed samples | `wide.timestamps[0] < narrow.timestamps[0]`, same tail |
| narrowing shrinks the span, keeps newest | narrower span, identical latest sample and value |
| a window covering the seed returns all 300 points | wide window → 300 |
| a narrow window returns only that elapsed span | 61 of 300, same tail, later start |

**Task 4.3 — the one restated assertion, justified by contract rather than by observed behaviour.** `getHistory returns a 300-point seed matching the pre-bridge shape` became `a window covering the whole seed returns all 300 pre-attach points`, passing `getHistory(3600)`. The old test called `getHistory()` with no argument, which under the new (production-faithful) semantics means a **60 s window** over a 300 s seed → 61 points. The number changed because the *contract* changed: the default window is now honoured, exactly as `get_history` honours `window_secs` in production. A companion test asserts the narrow-window result so both directions are pinned.

**`e2e/tests/chart-fidelity.spec.ts`: 14 → 16 tests**, both new ones green, driven through the real UI:

- *widening the window reveals earlier committed samples of the same session* — select 30 s, capture span/start/latest; select 60 s, poll; assert `wideStart < narrowStart` (reaches further back) **and** `wideLatest === narrowLatest` (same newest sample). This is the assertion the re-seed implementation could not satisfy: re-seeding restamps from a fresh `Date.now()`, so the start would move *forward*, not backward.
- *narrowing the window shrinks the span but keeps the newest sample* — assert `narrowSpan <= wideSpan` and an identical latest timestamp.

Two helper additions (`chartStartTimestamp`, `chartPointCount`) were needed; both read existing `data-chart-*` attributes already emitted by `MetricCard`.

## E. Verification (task 5)

```
npm test -- --run      → 20 files / 270 tests passed
npm run e2e            → 16 passed (58.1s)
npm run sim            → 4 passed (3.8m), ALL 16 journeys PASS
npm run verify:frontend→ 0 (incl. documentation + dead-code gates)
npx tsc --noEmit / tsconfig.test.json / tsconfig.sim.json → 0, 0, 0
```

Every history-touching journey required by task 5.3 passes: `long-watch-cadence`, `degraded-startup`, `fault-disk-ghost`, `gpu-hotplug-gap`, `customization-roundtrip`, `layout-persistence` — plus `first-launch-onboarding`, `fault-freeze-recovery`, `collector-recovery`, `fault-retry-exhaustion`, `ipc-schema-mismatch`, `layout-persistence`, and `persona-free-roam`.

### The dead-code gate caught a real finding from this change

The first `verify:frontend` run **failed**:

```
dead-code check FAILED — 1 unreferenced first-party symbol(s):
  [test-only] ts resetMissingSnapshotTimestampWarning — referenced only from test code
```

That is the category the check exists for: `resetMissingSnapshotTimestampWarning` is a test seam exported from production code, added by the *previous* change in this same campaign. Rather than silence the check, it was added to the `ALLOWLIST` **with a written reason** (task 5.3 of `eliminate-dead-code-and-wire-disk-model-enrichment` provides exactly this path, and the check's own failure message points at it):

> Test seam for the module-level "warn once" guard in `resolveSnapshotTimestamp`. The guard is intentionally process-wide, so a suite must be able to reset it to assert the "warns exactly once" contract repeatedly without reloading the module. Production code never calls it.

`scripts/check-dead-code.mjs` fails if an allowlist entry lacks a ≥20-character reason, so this cannot become a silent exclusion.

### 5.6 — no Rust file changed

`git diff --numstat` over `src-tauri/**` shows changes only from changes 5 and 6 (`disk.rs`, `mod.rs`, `hardware.rs`, `state.rs`, `snapshot.rs`, `run_loop.rs`, `main.rs`, `startup_probe.rs`). This change's diff is confined to `src/sim/mockBackend.ts`, `src/hooks/useMetrics.ts` (call site), their tests, and the two E2E specs.

## F. Behaviour change worth noting

`getHistory()`'s default parameter is now `60`, matching the app's initial window selection. A caller that previously got the full 300-point seed now gets a 60-second slice — which is the point of the change, but it is a real semantic difference for any harness code that relied on the old default. All in-repo callers were updated and are covered by the tests above.