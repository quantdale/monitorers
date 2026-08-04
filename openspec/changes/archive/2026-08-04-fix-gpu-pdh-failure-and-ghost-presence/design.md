# Design: fix-gpu-pdh-failure-and-ghost-presence

## Context

Three correctness bugs undermine the monitoring experience during transient hardware/PDH failures:

1. **GPU commits 0% on PDH failure**: `query_gpu_utilization_pdh` reads PDH counters regardless of whether `PdhCollectQueryData` succeeded. On a failed collection, it returns whatever stale data is in the counter (often 0.0). `commit_gpu` then unconditionally pushes this to history and `gpu_latest`, causing false full-width drops in GPU charts and badges.

2. **Disk throughput zeroes on PDH failure**: `poll()` returns empty maps for disk read/write/response when `pdh_ok == false`. `commit_disk_network` overwrites `disk_read_mb_s`, `disk_write_mb_s`, `disk_avg_response_ms` with these empty maps, dropping live readouts to `R: 0.0 MB/s · Avg: —`.

3. **Ghost disk/GPU cards persist forever**: Backend correctly prunes absent hardware after `PRUNE_MISS_THRESHOLD` (4 full ticks ≈ 4s). Frontend's `mergeDiskHistory`/`mergeGpuHistory` only ever append — they never remove entries. Hot-unplugged hardware stays frozen on the dashboard indefinitely.

4. **Mid-session cards plot at wrong x-positions**: When a new disk/GPU appears mid-session, `mergeDiskHistory`/`mergeGpuHistory` seed it with `values: [current_value]` while the global `timestamps` array has N existing entries. `computeChartPoints` pairs the single value with `timestamps[0]` (oldest in window) instead of the appearance timestamp, plotting the card at the left edge.

## Goals / Non-Goals

**Goals:**
- GPU history and `gpu_latest` freeze at last-known values on PDH-failed ticks (no 0% corruption)
- Disk throughput readouts freeze at last-known values on PDH-failed ticks (no zeroing)
- Frontend prunes ghost disk/GPU cards after sustained absence (matching backend prune threshold)
- Newly-appearing cards anchor their first history point to their true appearance timestamp
- No `SCHEMA_VERSION` bump (payload shape unchanged, behavior-only fixes)

**Non-Goals:**
- Disambiguate same-model multi-GPU (known gap, separate issue)
- Change PDH/WMI collection architecture
- Add persistence for card visibility (already exists via plugin-store)

## Decisions

### 1. Gate GPU commits on `pdh_ok` in `commit_gpu` (mirror disk pattern)

**Decision**: Add `pdh_ok: bool` to `RawPoll` (already present) and check it in `commit_gpu`. On `pdh_ok == false`, skip history pushes and `gpu_latest` updates — retain previous values.

**Rationale**: Disk path already does this correctly via the `if poll.pdh_ok { …prune… }` guard and by returning empty maps from `poll()` on failure. GPU path must mirror this: don't commit garbage data.

**Alternatives considered**:
- Return `Option<Vec<GpuUtilEntry>>` from `query_gpu_utilization_pdh` with `None` on PDH failure: cleaner separation but requires changing return type and all call sites.
- Check `pdh_ok` in `poll()` and skip calling `query_gpu_utilization_pdh` entirely: saves work but `GpuSensorProvider` on registry ticks also calls `collect_pdh` + `query_gpu_utilization_pdh` independently, so the gate must be in the commit function anyway.

### 2. Preserve disk throughput maps on `pdh_ok == false` in `commit_disk_network`

**Decision**: Move the `disk_read_mb_s`/`disk_write_mb_s`/`disk_avg_response_ms` assignments inside the `if poll.pdh_ok` block, or conditionally update only when maps are non-empty.

**Rationale**: Currently lines 418-420 unconditionally clone empty maps from a failed poll, wiping live readouts. The fix is to only refresh these when `pdh_ok == true`.

**Alternatives considered**:
- Return `Option<HashMap>` from `poll_disk` with `None` on failure: more explicit but larger refactor.
- Keep a "last known good" copy in `HistoryStore` and fall back to it: over-engineered; conditional assignment is simpler.

### 3. Frontend ghost pruning with per-card "last seen" tracking

**Decision**: Extend `DiskHistory`/`GpuHistory` types with `last_seen_ts: number` (wall-clock ms when card was last in snapshot). In `mergeDiskHistory`/`mergeGpuHistory`, update `last_seen_ts` for present cards; after merge, filter out cards where `now - last_seen_ts > PRUNE_GRACE_MS` (match backend's 4s threshold).

**Rationale**: Backend prunes after 4 missing full ticks (~4s). Frontend receives events every ~250ms, so tracking wall-clock time since last sighting is more robust than counting ticks. Using a grace period matching the backend keeps behavior consistent.

**Alternatives considered**:
- Count missing `on_tick` events in frontend: requires tracking tick numbers, more complex.
- Rely solely on backend pruning (snapshot stops including the key): frontend would still show the card because `merge*` never removes entries. Must actively prune in frontend.

### 4. Fix mid-session card anchoring via NaN-padding to align with global timestamps

**Decision**: When a new disk/GPU appears in `mergeDiskHistory`/`mergeGpuHistory`, create a `values` array of length `timestamps.length` filled with `NaN`, then append the real value. This aligns indices with the global timestamp array. `computeChartPoints` already treats `NaN` as 0 (clamped), so the card renders nothing before its appearance and correctly plots from the appearance point onward.

**Rationale**: Minimal change to data model — keeps single global `timestamps` array. `computeChartPoints` already handles `NaN`/`null` → 0. The visual effect: card is invisible until its first real point, then plots correctly at its true timestamp.

**Alternatives considered**:
- Per-card timestamp arrays: larger refactor, breaks `HistoryPayload` shape.
- Track `first_index` per card and offset in `computeChartPoints`: requires passing extra metadata through the chart pipeline.
- Seed with `[value]` and also append to `timestamps`: would desync timestamps from CPU/mem history.

### 5. `GpuSensorProvider` scalar commits must also respect `pdh_ok`

**Decision**: `GpuSensorProvider.poll()` calls `collect_pdh` which returns `bool`. Thread this through `RawPoll` (add `pdh_ok` field to the registry RawPoll, or reuse the existing one). In `commit_gpu_scalar`, skip `gpu_latest` updates for keys where the poll had `pdh_ok == false`.

**Rationale**: Registry ticks (non-full) also poll GPU via `GpuSensorProvider`. They call `collect_pdh` and `query_gpu_utilization_pdh` independently. If PDH fails on a registry tick, `gpu_latest` must not be updated to 0%. The `RawPoll` from `SensorProvider.poll` already has a `pdh_ok` field (from `collector::poll`); we need to ensure `GpuSensorProvider.poll` sets it correctly.

Wait — `GpuSensorProvider.poll` creates its own `RawPoll` and doesn't currently set `pdh_ok`. It calls `collect_pdh` which returns `bool`. We should capture that and include it in the returned `RawPoll`.

Actually, looking at `RawPoll` definition in `state.rs` — it has `pdh_ok: bool`. `GpuSensorProvider.poll` returns `RawPoll { gpu_updates, nvidia_temp, ..., ..Default::default() }` which means `pdh_ok: false` by default. We need to set it to the result of `collect_pdh`.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| NaN-padding increases memory per new card (3600 f64s × 8 bytes ≈ 29 KB) | Negligible; max disks+GPUs ~10 → <300 KB. History capacity is fixed at 3600. |
| Frontend prune grace period must match backend's 4s exactly | Use a constant `PRUNE_GRACE_MS = 4500` (slightly > 4s to absorb clock skew). Backend `PRUNE_MISS_THRESHOLD = 4` full ticks at 1Hz = 4s. |
| `commit_gpu_scalar` on registry ticks might freeze `gpu_latest` incorrectly if PDH fails intermittently | Registry ticks run every 250ms; a single PDH failure freezes for 250ms. Full tick (1Hz) is the history commit — that's the critical path. Scalar freeze is correct: don't show 0% on a blip. |
| Existing tests for `commit_gpu`/`commit_disk_network` assume current behavior | Update tests to reflect new frozen-on-failure behavior. Tests in `mod.rs` are the source of truth. |

## Migration Plan

1. **Backend first** (single commit, no frontend dependency):
   - Modify `commit_gpu` to gate on `poll.pdh_ok`
   - Modify `commit_disk_network` to preserve throughput maps on `!pdh_ok`
   - Set `pdh_ok` in `GpuSensorProvider.poll` return value
   - Update Rust tests in `mod.rs`

2. **Frontend** (can be separate commit):
   - Add `last_seen_ts` to `DiskHistory`/`GpuHistory` types
   - Update `mergeDiskHistory`/`mergeGpuHistory` to track `last_seen_ts` and prune ghosts
   - NaN-pad new card histories to align with global timestamps
   - Update TypeScript types in `types/metrics.ts` to match

3. **Verify**:
   - `cargo test` passes (Rust)
   - `npm test -- --run` passes (frontend unit)
   - `npm run e2e` passes (Playwright against mock harness)
   - Manual smoke test on Windows: unplug GPU/disk, observe card removal; induce PDH failure (e.g., stop "Performance Counter DLL Host" service briefly), observe frozen readouts

## Open Questions

1. **Should `GpuSensorProvider` also skip `gpu_updates` entirely on PDH failure, or return empty vec?**
   - Current: returns whatever `query_gpu_utilization_pdh` returns (stale/0).
   - Proposed: if `collect_pdh` returns false, return empty `gpu_updates` and `pdh_ok: false`. `commit_gpu_scalar` will skip updates for absent keys (current behavior preserves ghost `gpu_latest` during grace window). This is consistent.

2. **Frontend prune: use `PRUNE_MISS_THRESHOLD` ticks or wall-clock grace?**
   - Wall-clock is simpler and more robust to tick timing variations. Use 5000ms grace (5s) to be safe.

3. **NaN-padding: should we also pad `temp_c` history?**
   - `temp_c` is a single value per card (not a history array in `DiskHistory`/`GpuHistory`). No padding needed.

4. **Does `build_history_payload` / `build_snapshot` need changes for NaN values?**
   - No — NaN only exists in frontend React state. Backend sends normal f64. Frontend creates NaN padding locally when merging.

---

**Design complete.** Ready for tasks phase.