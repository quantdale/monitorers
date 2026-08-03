# Tasks: fix-gpu-pdh-failure-and-ghost-presence

## 1. Backend: Gate GPU commits on PDH success

- [x] 1.1 Modify `commit_gpu` in `src-tauri/src/collector/mod.rs` to skip history pushes and `gpu_latest` updates when `poll.pdh_ok == false` (retain last-known values)
- [x] 1.2 Modify `commit_disk_network` in `src-tauri/src/collector/mod.rs` to preserve `disk_read_mb_s`, `disk_write_mb_s`, `disk_avg_response_ms` when `poll.pdh_ok == false` (only update when `pdh_ok == true`)
- [x] 1.3 Update `GpuSensorProvider.poll` in `src-tauri/src/sensor.rs` to set `pdh_ok` in returned `RawPoll` based on `collect_pdh` result
- [x] 1.4 Update `commit_gpu_scalar` in `src-tauri/src/collector/mod.rs` to skip `gpu_latest` updates for keys where the registry poll had `pdh_ok == false`
- [x] 1.5 Update Rust tests in `src-tauri/src/collector/mod.rs` to verify: GPU history freezes on PDH failure, disk throughput freezes on PDH failure, GPU scalar freezes on PDH failure

## 2. Frontend: Prune ghost disk/GPU cards

- [x] 2.1 Add `last_seen_ts: number` field to `DiskHistory` and `GpuHistory` types in `src/types/metrics.ts`
- [x] 2.2 Update `mergeDiskHistory` in `src/hooks/useMetrics.ts` to track `last_seen_ts` for present disks and filter out disks where `now - last_seen_ts > PRUNE_GRACE_MS` (5000ms)
- [x] 2.3 Update `mergeGpuHistory` in `src/hooks/useMetrics.ts` to track `last_seen_ts` for present GPUs and filter out GPUs where `now - last_seen_ts > PRUNE_GRACE_MS` (5000ms)
- [x] 2.4 Add `PRUNE_GRACE_MS = 5000` constant in `src/hooks/useMetrics.ts`

## 3. Frontend: Fix mid-session card anchoring

- [x] 3.1 Update `mergeDiskHistory` in `src/hooks/useMetrics.ts` to NaN-pad new disk histories to align with global `timestamps` array length
- [x] 3.2 Update `mergeGpuHistory` in `src/hooks/useMetrics.ts` to NaN-pad new GPU histories to align with global `timestamps` array length
- [x] 3.3 Verify `computeChartPoints` in `src/chartPoints.ts` correctly handles NaN (already clamps to 0)

## 4. Verification

- [x] 4.1 Run `cargo test` in `sys-monitor-tauri/src-tauri/` — all tests pass
- [x] 4.2 Run `cargo fmt -- --check` in `sys-monitor-tauri/src-tauri/` — no formatting issues
- [x] 4.3 Run `cargo clippy -- -D warnings` in `sys-monitor-tauri/src-tauri/` — no warnings
- [x] 4.4 Run `npx tsc --noEmit` in `sys-monitor-tauri/` — TypeScript typecheck passes
- [x] 4.5 Run `npm test -- --run` in `sys-monitor-tauri/` — Vitest unit tests pass
- [x] 4.6 Run `npm run e2e` in `sys-monitor-tauri/` — Playwright E2E tests pass