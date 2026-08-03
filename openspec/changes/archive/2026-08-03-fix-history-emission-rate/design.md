## Context

Current tick loop (`main.rs`, 250ms sleep, `tick` counter):

```
tick % 4 == 0 (full poll, 1Hz):
  collector::poll()              → RawPoll (fresh CPU/mem/net/disk/GPU I/O)
  commit_disk_network(store, r)  → pushes mem/net/disk history
  commit_cpu(store, r)           → pushes cpu_history          (NOT cpu_latest)
  commit_gpu(store, r)           → pushes gpu_entries history  (NOT gpu_latest)
  push_timestamp(ts)
  registry NOT polled (reg_raw forced to all-None)

tick % 4 != 0 (registry-only, 4Hz):
  registry.poll_all()            → CpuSensorProvider + GpuSensorProvider RawPolls
  commit_cpu_scalar / commit_gpu_scalar → update cpu_latest/gpu_latest (NOT history)

Every tick, regardless of branch:
  build_snapshot(&s) → MetricsSnapshot
  app_handle.emit("metrics-update", snapshot)   ← unconditional, 250ms
```

`build_snapshot` prefers `cpu_latest`/`gpu_latest` over the history tail when present (`main.rs:126-128, 169-176`). This is correct on registry-only ticks (latest reflects the just-polled 250ms-fresh value) but wrong on full ticks (latest is stale from up to 250ms ago, while history was *just* updated with a newer value in the same tick — this is ARC-007).

On the frontend, `useMetrics.ts`'s `metrics-update` listener appends every event's scalar into `history.{cpu,mem,net_recv,net_sent}` and merges into `history.{disks,gpus}[].values` — unconditionally, every 250ms. Since `get_history` (the initial load) returns the correctly-1Hz-sliced backing store, but the frontend then grows its own copy at 4Hz thereafter, the two rates diverge over the session: after ~15 minutes of runtime, `MAX_HISTORY = 3600` points represents only ~15 real minutes instead of 1 hour. This is COR-001.

Card components (`App.tsx`) read the *current* value as `history.cpu.at(-1)`, `gpu.values.at(-1)`, `disk.values.at(-1)`, `net_recv.at(-1)` — i.e., derived from the tail of the same array the chart plots. `mem_used_gb`/`mem_total_gb` and the NVIDIA stats are the only fields that already have a separate "latest" state (`memGb`, `nvidiaStats`) independent of any history array — this is the pattern to extend to CPU% and GPU%.

## Goals / Non-Goals

**Goals:**
- History arrays (both Rust `HistoryStore` and the frontend's mirror) advance at exactly 1Hz, so a "1 hour" window always represents 3600 real seconds.
- CPU/GPU current-value readouts keep their existing ~250ms visual refresh rate — no perceptible regression in live responsiveness.
- `cpu_latest`/`gpu_latest` in `HistoryStore` are never stale relative to what was just committed to history in the same tick (ARC-007).
- The tick-cadence decision is unit-tested so this bug class (already recurred twice) cannot regress silently a third time (TEST-001).

**Non-Goals:**
- Not changing the underlying 250ms poll cadence, the 4-tick full-poll ratio, or PDH/WMI collection strategy.
- Not addressing COR-002/ARC-001 (multi-GPU keying), ERR-002/ARC-002 (crash logging/restart), or PERF-001/PERF-002 (explicitly deferred to re-measure after this lands).
- Not introducing a second Tauri event type (rejected — see Decisions).
- Not touching CQ-001 (handled in the separate, already-proposed `fix-pdh-safety-comments` change, applied first).

## Decisions

**Decision: thread a single `on_tick: bool` field through the existing `metrics-update` event, rather than (a) gating with no new field, or (b) adding a second lighter-weight event for off-tick scalar refresh.**

| Option | Description | Verdict |
|---|---|---|
| (a) Gate only, no new field | Infer "was this a history tick" on the frontend some other way (e.g. compare consecutive disk/net values) | Rejected — fragile, no reliable signal exists client-side; would require guessing from value equality, which breaks the moment a disk/net value coincidentally repeats on a genuine full tick |
| (b) Two events | Emit `metrics-update` only on full ticks (1Hz) for history; add `metrics-live` (or similar) every 250ms carrying just CPU%/GPU%/temps for the live readout | Rejected — doubles the event surface (two listeners, two payload types, two schema-version concerns), and gains nothing `on_tick` doesn't already give more simply, since ordering between two same-thread-emitted events is not meaningfully different from one event with a flag |
| (c) **Chosen**: one field, one event | Add `on_tick: bool` = `raw.is_some()` (already computed in the tick loop, threaded through for free) to the existing `MetricsSnapshot` | Minimal schema disruption (one field, one version bump), no new event/listener, and it's exactly the information already available in the tick loop — nothing new to compute |

**Decision: give the frontend its own `latestCpu`/`latestGpu` (map by GPU name) state, updated on every event; history arrays only append when `on_tick` is true.**

This mirrors the `memGb`/`nvidiaStats` split already present in `useMetrics.ts` for mem/NVIDIA fields — not a new pattern, just extending an existing one to CPU/GPU. Rejected alternative: gate history append only, and let `history.cpu.at(-1)` fall back to reading whatever the last **appended** point was for the live number too. That was rejected because it would silently drop the CPU/GPU numeric readout to 1Hz, regressing a UX property this proposal is explicitly required to preserve (per `App.tsx`'s current `.at(-1)` reads, confirmed during `/opsx:explore` to be the sole source of the displayed current value for those cards).

**Decision: fix ARC-007 by updating `cpu_latest`/`gpu_latest` inside `commit_cpu`/`commit_gpu` themselves (the full-tick commit path), not by changing when the registry runs.**

Alternative considered: also run the registry on full ticks (i.e., drop the `reg_raw` all-None short-circuit) so `commit_cpu_scalar`/`commit_gpu_scalar` always refresh the scalars. Rejected — that would mean two separate PDH/WMI polls per full tick (one via `collector::poll()`, one via the registry), defeating the "one `PdhCollectQueryData` per tick" invariant documented in CLAUDE.md and doubling I/O cost on the hot path for no benefit, since `collector::poll()` already produced fresh CPU/GPU values in the same tick — `commit_cpu`/`commit_gpu` just needs to also write them into `cpu_latest`/`gpu_latest`.

**Decision: extract the tick-cadence gate as a small pure function in `main.rs` (e.g. `fn is_full_poll_tick(tick: u32) -> bool`), not as part of a larger refactor, and not co-located with CQ-001's PDH dedup.**

Per the prior `/opsx:explore` finding: TEST-001 and CQ-001 do not share line-adjacency in current source (TEST-001 lives in `main.rs`'s tick loop; CQ-001 is in `collector/mod.rs`'s `poll()`/`collect_pdh()`, already handled by the separate, first-landing `fix-pdh-safety-comments` change). Keeping this extraction narrow (just the boolean) avoids scope creep and keeps this design decoupled from that change's outcome.

**Decision: bump `SCHEMA_VERSION` 2 → 3 in the same commit as the `MetricsSnapshot` field addition, on both `main.rs` and `useMetrics.ts`.**

Non-negotiable per CLAUDE.md's IPC contract rule — any payload shape change requires a coordinated bump. Since `assertSchemaVersion` only logs a console error on mismatch (not a hard failure), this is a lint/observability safeguard rather than a runtime gate, but it must still be kept accurate.

## Risks / Trade-offs

- [Risk] Adding `on_tick` and gating frontend appends changes the shape of `HistoryPayload` vs. `MetricsSnapshot` semantics — a developer skimming `useMetrics.ts` later might not realize `metrics-update` events are dual-purpose (latest + conditional history) → [Mitigation] name the field and the gated code path clearly (`on_tick`, a single `if (snap.on_tick) { ...append... }` block), and document the split at the top of the listener.
- [Risk] `commit_cpu`/`commit_gpu` writing to `cpu_latest`/`gpu_latest` on the full-tick path is new coupling between "history commit" and "latest scalar" responsibilities that were previously cleanly separated (history-only vs. scalar-only commit functions) → [Mitigation] keep the write minimal (set the same field the scalar-only commit functions already own) and cover it with a unit test analogous to `test_commit_cpu_scalar_updates_latest_not_history`, asserting `cpu_latest`/`gpu_latest` reflect the just-committed value immediately after `commit_cpu`/`commit_gpu`.
- [Risk] Frontend test/behavior drift: existing frontend tests may assume every `metrics-update` event grows `history.cpu` — those will need updating alongside the gating change, not just additive new tests → [Mitigation] tasks.md calls this out explicitly as an audit-and-update step, not just "add tests."
- [Risk] `SCHEMA_VERSION` bump with no forced-reload mechanism means a stale frontend build talking to a rebuilt backend (or vice versa) degrades to a console warning, not a hard stop → [Mitigation] unchanged from current behavior/CLAUDE.md-documented risk; out of scope to fix here.

## Migration Plan

Single coordinated commit (or tightly sequenced PR) across `main.rs`, `collector/mod.rs`, `useMetrics.ts`, `types/metrics.ts`, `App.tsx` — the schema bump means backend and frontend must ship together; there is no incremental rollout path for a desktop app rebuild like this one. Rollback is a plain revert; no persisted data/state migration is involved (history is in-memory, `settings.json` persistence via `useSettings.ts` is untouched).

## Open Questions

None outstanding for this change's scope. (Re-measuring PERF-001/PERF-002 after this lands is explicitly deferred, per the proposal's Impact/out-of-scope note.)
