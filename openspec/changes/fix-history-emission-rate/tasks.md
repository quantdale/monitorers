## 1. Rust: tick-cadence extraction (TEST-001)

- [x] 1.1 Extract the tick-cadence decision out of the tick loop into a small pure function (e.g. `fn is_full_poll_tick(tick: u32) -> bool { tick.is_multiple_of(4) }`) in `main.rs`.
- [x] 1.2 Use it in place of the inline `tick.is_multiple_of(4)` checks that currently gate `raw`/`reg_raw` construction (`main.rs:569-578`).
- [x] 1.3 Add unit tests covering `tick = 0..=8` (or a representative range) asserting `true` exactly on multiples of 4.

## 2. Rust: fix cpu_latest/gpu_latest staleness (ARC-007)

- [x] 2.1 Update `commit_cpu` (`collector/mod.rs`) to also set `store.cpu_latest = Some(poll.cpu_usage)` alongside its existing `cpu_history` push.
- [x] 2.2 Update `commit_gpu` (`collector/mod.rs`) to also set `store.gpu_latest` entries alongside its existing `gpu_entries` push, matching the clamping behavior already used in `commit_gpu_scalar`.
- [x] 2.3 Add/extend a unit test (mirroring `test_commit_cpu_scalar_updates_latest_not_history`) asserting that after `commit_cpu`/`commit_gpu`, `cpu_latest`/`gpu_latest` equal the just-pushed history value — no staleness window.
- [x] 2.4 Re-check `test_history_length_invariant_after_simulated_ticks` and any other existing test that asserts on `cpu_latest` after a full-tick commit; update expectations if this fix changes their asserted values. (Confirmed unchanged: `commit_cpu` sets `cpu_latest = 10.0` first, then subsequent `commit_cpu_scalar` calls override to 40.0 — final assertion `Some(40.0)` still holds.)

## 3. Rust: IPC schema — add on_tick field

- [x] 3.1 Bump `SCHEMA_VERSION` in `main.rs` from `2` to `3`.
- [x] 3.2 Add `pub on_tick: bool` to `MetricsSnapshot`.
- [x] 3.3 Update `build_snapshot` to accept/set `on_tick` (sourced from `raw.is_some()` in the tick loop, threaded through as a parameter — do not recompute it separately).
- [x] 3.4 Update the tick loop's call site to pass the tick-cadence result into `build_snapshot`.
- [x] 3.5 Update/add Rust tests for `build_snapshot` that exercise `on_tick` true/false.

## 4. Frontend: schema + types

- [x] 4.1 Bump `EXPECTED_SCHEMA_VERSION` in `useMetrics.ts` from `2` to `3`.
- [x] 4.2 Add `on_tick: boolean` to the `MetricsSnapshot` TS interface in `types/metrics.ts`.
- [x] 4.3 Change the mock/browser-dev path's `setInterval` in `useMetrics.ts` from 1000ms to 250ms (matching the real backend's tick period), and add a tick counter so `on_tick = counter % 4 === 0` — the same 4:1 ratio production uses. This makes dev-mode exercise the identical gating code path (3-out-of-4 events skip history append) instead of only ever being tested against live Tauri events. Note the ratio/rationale in a comment next to the counter.

## 5. Frontend: latest-value state + gated history append (COR-001)

- [x] 5.1 Add `latestCpu` state (number, mirroring `memGb`'s pattern) updated on every `metrics-update` event regardless of `on_tick`.
- [x] 5.2 Add `latestGpu` state (map keyed by GPU name → util, mirroring `gpuMeta`'s map pattern) updated on every event regardless of `on_tick`.
- [x] 5.3 Gate the `setHistory` block's `appendToHistory`/`mergeDiskHistory`/`mergeGpuHistory` calls behind `if (snap.on_tick) { ... }` in **both** the real `metrics-update` listener and the mock/browser-dev `setInterval` path (per 4.3, the mock now emits its own `on_tick` at the same 4:1 ratio, so both paths share the identical gating logic rather than the mock bypassing it). Implemented via an extracted `shouldCommitHistory(onTick)` helper used at both call sites.
- [x] 5.4 Add `latestCpu`/`latestGpu` to the `SlicedHistory` return shape (or equivalent) so components can consume them. (`latestCpu: number` on `SlicedHistory`; `latest: number` on each `SlicedGpuHistory` entry.)

## 6. Frontend: card reads (App.tsx)

- [x] 6.1 Change the CPU card's current-value read from `metrics.cpu.at(-1)` to the new latest-value field.
- [x] 6.2 Change each GPU card's current-value read from `gpu.values.at(-1)` to the new latest-value lookup (by GPU name).
- [x] 6.3 Leave disk/net/mem card reads (`disk.values.at(-1)`, `net_recv.at(-1)`, `metrics.mem.at(-1)`) as-is — these already only change on full ticks server-side, so gating their history append doesn't regress their live-value freshness (confirmed in design.md's Context). (No change made — confirmed correct as-is.)

## 7. Frontend: tests

- [x] 7.1 Add/update a test for `appendToHistory`'s call sites (or a new gating helper, if one is extracted) asserting no append occurs when `on_tick` is false. (Extracted `shouldCommitHistory`; tested true/false directly.)
- [x] 7.2 Add a test for the new latest-value derivation (CPU/GPU) updating on every event regardless of `on_tick`. (Extracted `mergeLatestGpu`; tested new-GPU, update-existing, and preserve-others cases.)
- [x] 7.3 Audit existing frontend tests that assume every `metrics-update` event grows `history.cpu`/`history.gpus` — update them to pass `on_tick: true` where growth is asserted, and add a companion case with `on_tick: false` asserting no growth. (Audited: no existing test exercises the hook's `metrics-update` listener directly — all existing tests target the pure exported helpers (`appendToHistory`, `mergeDiskHistory`, `mergeGpuHistory`, `sliceWindow`, `assertSchemaVersion`) in isolation, none of which assume anything about `on_tick`. Nothing needed updating.)

## 8. Verify

- [x] 8.1 Run `cargo test --verbose` from `src-tauri/` — confirm ≥70 tests pass (count should grow from 1.3/2.3/3.5). **77 passed** (70 baseline + 7 new: 3 cadence-gate + 2 build_snapshot on_tick + 2 commit_cpu/commit_gpu latest-staleness).
- [x] 8.2 Run `cargo fmt -- --check` from `src-tauri/`. Clean.
- [x] 8.3 Run `cargo clippy -- -D warnings` from `src-tauri/`. Zero warnings.
- [x] 8.4 Run `cargo audit` from `src-tauri/` — confirm clean. Clean (21 pre-existing allowlisted "unmaintained" warnings, same as after the prior SEC-001 fix; 0 new advisories; exit code 0).
- [x] 8.5 Run `npx tsc --noEmit`. Clean.
- [x] 8.6 Run `npm test -- --run` — confirm ≥41 tests pass (count should grow from section 7). **46 passed** (41 baseline + 5 new: 2 `shouldCommitHistory` + 3 `mergeLatestGpu`).
- [ ] 8.7 Manually verify in `npm run tauri dev`: let the app run several minutes, confirm the "1 hour" window's elapsed real time now tracks 1:1 (spot-check against a stopwatch or timestamp deltas), and confirm CPU/GPU card numbers still visibly update multiple times per second. **Not run** — requires an interactive Windows session with real hardware sensors; left for manual verification before merge.
