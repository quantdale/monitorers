## Context

Today the history ring in the frontend is written by two producers using two clocks.

Backend (`collector/run_loop.rs`) computes one timestamp per full tick and pushes it into the ring:

```rust
let wall_origin_ms = Utc::now().timestamp_millis().max(0) as u64;
…
let ts = monotonic_timestamp_ms(wall_origin_ms, loop_epoch, Instant::now());
s.push_timestamp(ts);
```

Note what is *not* done with `ts`: it goes into `HistoryStore.timestamps` and stops. The `MetricsSnapshot` handed to `build_snapshot` carries no timestamp, so the `metrics-update` event the frontend receives has nothing to append with.

Frontend (`useMetrics.ts`) therefore mints its own:

```ts
const timestamp = Date.now();
liveEvents.current = appendLiveEvent(liveEvents.current, { sequence, snapshot: snap, timestamp });
setHistory((previous) => { const next = appendSnapshotToHistory(base, snap, timestamp); … });
```

The backend's clock is *deliberately* not wall-clock: it is anchored once and advanced by `Instant`, so it never moves backwards when the OS clock is adjusted. `Date.now()` is exactly the clock that adjustment moves. The two agree only while nothing perturbs them.

The correctness problem is not the drift itself but that the drift is *consumed*. `reconcileHistoryWithLiveEvents` uses timestamp equality across the two clocks as its sole duplicate-suppression mechanism:

```ts
const newest = current.timestamps.at(-1);
if (newest !== undefined && event.timestamp <= newest) return current;
```

If the frontend clock is behind the backend projection, a brand-new full-tick sample is classified as "already covered" and dropped — a permanent hole with no gap marker, because the sample is never appended at all. If it is ahead, an already-present sample is appended again. Either way `timestampWindowRange`'s `cutoff = newest - window*1000` is computed from a ring with mixed provenance, so the window itself shifts.

Constraints:

- This is an IPC payload change. The repository already has the exact mechanism for this: bump `SCHEMA_VERSION` (`collector/snapshot.rs`) and `EXPECTED_SCHEMA_VERSION` (`useMetrics.ts`) together, and rely on the existing fail-closed `assertSchemaVersion` path so a mismatched pair is rejected with an actionable message rather than silently misbehaving. The repo documents this bump in `AGENTS.md`/`CLAUDE.md` and the pairing is already regression-tested.
- `SCHEMA_VERSION` is currently 5 and `EXPECTED_LIFECYCLE_SCHEMA_VERSION` is 1; the lifecycle contract is separate and must not move.
- The mock backend fabricates its own history and must be updated in step, or the mock lane immediately starts failing the schema check it is supposed to satisfy.
- Off-tick snapshots must not gain a history-appending effect: the "off-tick events do not grow history" requirement is load-bearing and this change must not weaken it.

## Goals / Non-Goals

**Goals:**

- Make the history ring single-sourced: every timestamp in it is produced by the backend's monotonic clock.
- Keep the duplicate-suppression reconciliation correct by construction rather than by clock agreement.
- Bump the schema pair coherently and keep the fail-closed mismatch path working.
- Define and test an explicit rule for a snapshot that arrives without a usable timestamp.

**Non-Goals:**

- No change to the scheduling loop, the 4:1 cadence, the 1 Hz commit rule, the `on_tick` semantics, or any metric value.
- No change to the lifecycle/status contract (`CollectorStatus`, `LIFECYCLE_SCHEMA_VERSION`).
- No attempt to make the backend's timestamps *be* wall-clock. The monotonic projection is intentional and is protected by an existing test; the fix is to stop the frontend from inventing a competing value, not to undo the backend's design.
- No change to the cadence probe/checker thresholds.

## Decisions

### D1 — Add a timestamp to `MetricsSnapshot` and reuse the value already computed

The loop already computes `ts` for the full-tick commit. The cheapest correct change is to thread that same value into the snapshot rather than recomputing it, so the timestamp in the payload and the timestamp pushed into `HistoryStore.timestamps` for the same tick are *identical by construction* — not merely close. This matters: if they were computed twice, they would differ by the time spent in `build_snapshot`, reintroducing a (small, and much less harmful) skew.

`build_snapshot` gains a timestamp parameter. `MetricsSnapshot` gains a `timestamp_ms: u64` field.

- **Alternative considered — let the frontend keep using `Date.now()` and simply widen the reconciliation tolerance.** Rejected: this treats the symptom. The ring would still have mixed provenance, window selection would still shift, and "monotonic timestamps" would remain a claim about the backend only. It also leaves the failure mode (silently dropped samples) structurally present.
- **Alternative considered — have the backend send the timestamp only on full ticks.** Rejected: it makes the field's presence conditional, so the frontend needs a "is this field meaningful" branch on every event, and an off-tick event with a stale/absent timestamp is more error-prone than one with a present, simply-unused value. Uniform presence is simpler and matches the existing `on_tick` flag's style.
- **Alternative considered — have the backend send a per-channel timestamp array.** Rejected: the ring is already aligned to a single global timestamp vector (`slice_aligned_history` relies on it); a per-channel array would duplicate that structure and increase payload size for no gain.

### D2 — Bump both schema constants together and let the existing fail-closed path do its job

`SCHEMA_VERSION` → 6 and `EXPECTED_SCHEMA_VERSION` → 6, in the same change, per the documented convention. A frontend built against 5 talking to a backend at 6 (or vice versa) is rejected by `assertSchemaVersion` with the existing actionable "rebuild" message. That is the correct outcome and needs no new mechanism — but it does mean the change is only safe as a matched pair, which the tasks must make explicit.

### D3 — Documented fallback for a missing/invalid timestamp, and make it visible

A snapshot from an incompatible build cannot reach this code (the schema check rejects it first), so the realistic sources of a missing timestamp are a mock that omits it and future payload evolution. The rule should be explicit rather than incidental:

- If the payload timestamp is present and usable (finite, non-negative, and not older than the ring's newest entry), use it.
- Otherwise, do **not** silently fall back to `Date.now()` and re-mix the clocks. Instead, treat the snapshot as un-stampable: record the condition once (a `console.warn`, matching the repo's existing "log once" discipline) and fall back to the ring's newest timestamp so the sample is still appended in order rather than dropped.

Falling back to "the newest known timestamp" keeps the ring monotonic and non-duplicated, at the cost of a repeated timestamp for that one sample — which is a visibly honest degradation (the window math stays well defined) rather than a silent hole.

- **Alternative considered — fall back to `Date.now()`.** Rejected: it reintroduces exactly the mixed-clock defect this change removes, in the one path where it would be hardest to notice.
- **Alternative considered — drop the sample.** Rejected: recreates the "silently discarded new sample" failure this change is fixing, in a rarer path.

### D4 — Update the mock to emit a timestamp derived from its simulated clock

`MockBackend.composeSnapshot()` should stamp each snapshot from the same value its history buffer uses, so the mock lane satisfies the bumped schema and continues to exercise the single-clock path. Its simulated clock (`simSeconds`) and the wall-clock anchor it already uses for seeding must stay consistent — the mock already stamps its seed with `now - (n - 1 - i) * HISTORICAL_DENSITY`, so the live path should use the same anchor rather than a fresh `Date.now()` per snapshot, otherwise the mock reintroduces the same two-clock seam it is meant to rule out.

### D5 — Keep `on_tick` as the sole history-growth gate

The timestamp field is metadata; it must not become an implicit growth trigger. `shouldCommitHistory(onTick)` remains the only thing that decides whether a snapshot appends, and the existing regression tests for off-tick behaviour are extended (not replaced) to confirm a present timestamp on an off-tick snapshot still appends nothing.

## Risks / Trade-offs

- **[Schema bump breaks any build pairing an old frontend with a new backend]** → Intended and already specified: the fail-closed mismatch path shows an actionable rebuild message. Both sides ship together via `tauri build`, so the shipped app is never mismatched. The packaged lane (`verify:packaged`) exercises the real IPC and will catch a mistake here.
- **[Existing Rust snapshot tests construct `MetricsSnapshot` literals]** → They will need the new field. This is mechanical and the compiler enforces it; the risk is a test that constructs the struct in a way that hides a real ordering change, so the update should be paired with an explicit assertion on the new field's value rather than just filling it in.
- **[Existing E2E/journey assertions read `data-chart-latest-ts`]** → These read `ChartPoint.t`, which comes from the `timestamps` array. Since the values remain epoch-milliseconds (the backend projects from `Utc::now()`), the assertions should keep passing unchanged. Verify rather than assume: `long-watch-cadence` asserts monotonic advance, `chart-fidelity` asserts span bounds, and the packaged journeys compare `latest-ts` across a relaunch. Each is re-run in verification.
- **[The fallback rule could mask a systematic producer bug]** → Mitigated by logging once and by the spec requiring the condition be recorded; a producer that omits the timestamp for every snapshot is visible in the console and in the mock-lane tripwires.
- **[A 6-byte-per-sample payload increase is irrelevant** → 3600 samples/hour is kilobytes; noted for completeness, not as a concern.

## Migration Plan

1. Rust: add `timestamp_ms` to `MetricsSnapshot`; thread the already-computed tick timestamp into `build_snapshot`; bump `SCHEMA_VERSION` to 6; update the Rust snapshot tests to assert the field.
2. Frontend: bump `EXPECTED_SCHEMA_VERSION` to 6; use the payload timestamp in `handleSnapshot`; implement the documented fallback (D3) with a one-time warning; keep the reconciliation check.
3. Mock: emit a timestamp from the mock's existing anchor (D4); keep `schema_version` consistent with the scenario default.
4. Extend TS hook tests: commit uses the payload timestamp; reconciliation still suppresses duplicates and does not drop new samples; off-tick snapshots with a timestamp still do not grow history; missing timestamp takes the documented fallback.
5. Re-run the mock simulation matrix and the E2E suite; re-run the packaged lane if a built exe is available.
6. Rollback: revert the field, the bump, and the frontend use together. Because the schema pair moves in lockstep, a partial revert is a mismatch that fails closed — so the revert must be atomic, which git gives for free.

## Open Questions

None that affect the specs or the task breakdown. The fallback rule (D3) and the mock anchor (D4) are decided above; the only judgement left at implementation time is whether the one-time warning should be a `console.warn` (matching existing repo convention) or an explicit surfaced error, which is a minor UI decision that does not alter the specified behaviour.
