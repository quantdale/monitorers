## 1. SAFETY comments (CQ-002, CQ-003)

- [x] 1.1 Add a `// SAFETY:` comment above the `PdhCloseQuery` unsafe block in `Drop for PdhHandles` (`pdh.rs:23`), stating the FFI rationale (owned handle, closed exactly once at end of life).
- [x] 1.2 Replace the loose `// unsafe:` prose comment in `nvidia.rs` (unsafe block at line 91) with a proper `// SAFETY:` comment.
- [x] 1.3 Add a `// SAFETY:` comment above the `NvAPI_Initialize()` unsafe block in `state.rs:90` (currently has no safety annotation at all).

## 2. Remove unnecessary unsafe impl (CQ-004)

- [x] 2.1 Delete `unsafe impl Send for HistoryStore` and `unsafe impl Sync for HistoryStore` (`state.rs:206-207`) and their justifying comment.
- [x] 2.2 Run `cargo check` from `src-tauri/` — confirm it still compiles cleanly with no changes elsewhere. If it fails, stop and investigate before proceeding (see design.md's risk note) rather than restoring the `unsafe impl` to silence the error.

## 3. Gate NvAPI init behind its consumer's cfg (CQ-005)

- [x] 3.1 Change the `NvAPI_Initialize()` call site in `CollectorState::new()` (`state.rs:88-92`) from `#[cfg(feature = "nvapi")]` to `#[cfg(all(feature = "nvapi", not(feature = "nvml")))]`, matching the cfg already applied to its sole consumer (`query_nvidia_gpu_temp` in `nvidia.rs`).
- [x] 3.2 Confirm `nvapi_initialized`'s value/handling elsewhere in `state.rs` (e.g. the `#[cfg_attr(feature = "nvml", allow(dead_code))]` field annotation) stays consistent with the new cfg — adjust if the field now needs its own `cfg` rather than just an `allow`.

## 4. Delete dead code (CQ-006, CQ-007)

- [x] 4.1 Delete the dead `commit()` function in `collector/mod.rs:248-249` (superseded by `commit_cpu`/`commit_gpu`/`commit_disk_network`).
- [x] 4.2 Delete the three unused public methods on `HardwareProfile` — `has_nvidia_dgpu`, `has_intel_igpu`, `has_amd_gpu` (`hardware.rs:64,72,80`).
- [x] 4.3 Grep for any remaining references to the four deleted items across `src-tauri/src/**` to confirm nothing else called them.

## 5. Deduplicate disk drive-letter resolution (CQ-012)

- [x] 5.1 Read both `physical_disk_list()` (`collector/disk.rs:160-202`) and `poll_disk()` (`collector/disk.rs:205-274`) in full; identify the shared drive-letter-resolution logic and confirm whether the two callers treat any edge case differently.
- [x] 5.2 Extract the shared logic into one private helper function in `disk.rs`; update both `physical_disk_list()` and `poll_disk()` to call it, passing any caller-specific parameter identified in 5.1 rather than silently unifying divergent behavior.
- [x] 5.3 If a natural unit-test seam falls out of the extraction, add a test for the new helper (optional — not required by this change).

## 6. Verify

- [x] 6.1 Run `cargo test --verbose` from `src-tauri/` — confirm the current baseline of 77 tests still pass (count may grow by 0-1 if 5.3's optional test is added; investigate any drop before proceeding). (88 tests passed — repo's baseline had already grown to 88 since this proposal was drafted; see CLAUDE.md.)
- [x] 6.2 Run `cargo fmt -- --check` from `src-tauri/` — confirm clean.
- [x] 6.3 Run `cargo clippy -- -D warnings` from `src-tauri/` — confirm zero warnings.
- [x] 6.4 Run `cargo audit` from `src-tauri/` — confirm no new advisories introduced.
- [x] 6.5 As a spot check only (not part of CI), run `cargo check --no-default-features --features nvapi` from `src-tauri/` to confirm NVAPI still initializes correctly in the nvapi-only (no nvml) configuration after CQ-005's cfg change.
