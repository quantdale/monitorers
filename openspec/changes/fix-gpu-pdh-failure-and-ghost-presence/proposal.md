# Proposal: fix-gpu-pdh-failure-and-ghost-presence

## Why

Three correctness bugs undermine the monitoring experience during transient hardware/PDH failures. On a failed `PdhCollectQueryData`, GPU utilization is committed as 0% (history + live badge) while the disk path correctly freezes values on `pdh_ok` gating, so GPU charts show false full-width drops. Separately, the frontend never removes ghost disk/GPU cards, so hot-unplugged hardware stays frozen on the dashboard "forever" despite the documented per-key card-presence intent. Finally, cards that appear mid-session (new disks/GPUs) plot their history against wall-clock timestamps at the wrong x-positions.

## What Changes

- **Gate GPU commits on PDH success.** Make `query_gpu_utilization_pdh` / the sensor registry / `commit_gpu` treat a PDH-failed tick like the disk path does: freeze GPU history and `gpu_latest` at their last-known values instead of writing 0.0. A PDH blip must not corrupt charts or badges.
- **Don't zero disk throughput on PDH-failed ticks.** `commit_disk_network` currently overwrites `disk_read_mb_s`, `disk_write_mb_s`, and `disk_avg_response_ms` with empty maps when `poll.pdh_ok == false`, dropping badges to `R: 0.0 MB/s · Avg: —`; keep last-known values instead.
- **Frontend: drop ghost disk/GPU cards.** When a disk/GPU is absent from the backend snapshot for a sustained window (backend already prunes after `PRUNE_MISS_THRESHOLD`), remove the corresponding card from the frontend's accumulated history so `isCardPresent` correctly hides its own ghost card — matching the documented per-key card presence behavior.
- **Plot per-card history correctly.** `computeChartPoints` mixes a global timestamp array with per-card value arrays; anchor a card's first point to the timestamp at which it first appeared, not to the oldest global timestamp, so newly-appearing cards don't render at the left edge of the window.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `metrics-history-streaming`: GPU and disk history must not be corrupted (committed as 0% / zeroed throughput) on PDH-failed ticks; ghost disk/GPU cards must disappear from the frontend after a sustained absence; newly-appearing cards must be plotted against their real timestamps.
- `frontend-data-load-resilience`: Ghost disk/GPU cards must be pruned from frontend history when absent from the live snapshot, so `isCardPresent` hides genuinely-removed hardware.

## Impact

- `src-tauri/src/collector/mod.rs` — `commit_gpu`, `commit_disk_network`, `GpuSensorProvider`/`registry` commit gating on `pdh_ok`.
- `src-tauri/src/collector/gpu.rs` — propagate PDH-success into `query_gpu_utilization_pdh` result (new field or empty-vs-zero distinction).
- `src-tauri/src/collector/sensor.rs` — `GpuSensorProvider::poll` honors the `collect_pdh` result.
- `src/hooks/useMetrics.ts` — `mergeDiskHistory` / `mergeGpuHistory` prune ghosts; seed/timestamp bookkeeping for mid-session cards.
- `src/chartPoints.ts` — per-card timestamp anchoring.
- `src/types/metrics.ts`, `src-tauri/src/collector/snapshot.rs` — existing payload shape (no `SCHEMA_VERSION` bump expected; behavior-only).