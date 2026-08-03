## Why

A 2026-07-25 engineering audit of `sys-monitor-tauri` flagged seven small, independent Rust-side code-quality findings (CQ-002, CQ-003, CQ-004, CQ-005, CQ-006, CQ-007, CQ-012) that remain open after re-verification against current source in a follow-up `/opsx:explore` session. None of them touch IPC schema, none overlap each other's files, and none require a design decision beyond "do the obviously-correct cleanup" — the same shape as the already-completed `fix-pdh-safety-comments` change, just for the remaining unsafe-comment gaps plus a handful of unrelated dead-code/duplication/cfg-gating issues that happen to be similarly small and low-risk. Bundling them into one change avoids seven near-empty PRs for genuinely trivial fixes while keeping the change reviewable as a single, easy-to-verify diff.

## What Changes

- **CQ-002**: Add a `// SAFETY:` comment to the `PdhCloseQuery` unsafe block in `Drop for PdhHandles` (`pdh.rs:23`), matching the FFI/return-code rationale already used elsewhere.
- **CQ-003**: Replace the loose `// unsafe:` prose comment in `nvidia.rs` (unsafe block at line 91) with a proper `// SAFETY:` comment. Add a `// SAFETY:` comment to the `NvAPI_Initialize()` call in `state.rs:90`, which currently has no safety annotation at all.
- **CQ-004**: Delete the unnecessary `unsafe impl Send for HistoryStore` / `unsafe impl Sync for HistoryStore` (`state.rs:206-207`) and their justifying comment. `HistoryStore`'s fields are all auto-Send+Sync; `cargo check` must confirm `Mutex<HistoryStore>` still compiles cleanly without them.
- **CQ-005**: Gate the unconditional `NvAPI_Initialize()` call in `CollectorState::new()` (`state.rs:88-92`) behind `#[cfg(all(feature = "nvapi", not(feature = "nvml")))]` — the same condition already used for its only consumer (`query_nvidia_gpu_temp`) — so it's not dead FFI surface executed in the default (`nvapi` + `nvml`) build.
- **CQ-006**: Delete the dead `commit()` function in `collector/mod.rs:248-249` (superseded by the granular `commit_cpu`/`commit_gpu`/`commit_disk_network`, currently kept alive only by a plain `#[allow(dead_code)]`).
- **CQ-007**: Delete the three unused public methods on `HardwareProfile` (`has_nvidia_dgpu`, `has_intel_igpu`, `has_amd_gpu` — `hardware.rs:64,72,80`), each marked `#[allow(dead_code)]` with no current or planned caller.
- **CQ-012**: Extract the duplicated drive-letter-resolution logic shared by `physical_disk_list()` and `poll_disk()` (`collector/disk.rs:160-202` vs `205-274`) into one helper function used by both.

No IPC schema changes. No user-visible behavior changes are intended anywhere in this batch — CQ-004 and CQ-005 remove code that should be provably inert (verified via `cargo check`/`cargo test`, not assumed), and CQ-012's extraction is a pure refactor preserving both callers' existing output.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `unsafe-code-safety-documentation`: add two new scenarios covering the `Drop for PdhHandles` (`PdhCloseQuery`) and `NvAPI_Initialize()` call sites (CQ-002, CQ-003), extending this capability's existing coverage (currently scoped to the two PDH collect call sites from `fix-pdh-safety-comments`) to close the remaining gaps the audit found. The general requirement text ("every unsafe block SHALL carry a `// SAFETY:` comment") does not change — only the enumerated scenarios grow.

## Impact

- **Code**: `sys-monitor-tauri/src-tauri/src/pdh.rs`, `src-tauri/src/nvidia.rs`, `src-tauri/src/state.rs`, `src-tauri/src/collector/mod.rs`, `src-tauri/src/hardware.rs`, `src-tauri/src/collector/disk.rs`. `Cargo.toml` is referenced for its existing `default = ["nvapi", "nvml"]` features (not edited) — CQ-005's fix is a `cfg` adjustment at the `NvAPI_Initialize()` call site in `state.rs`, using the same condition already applied to its consumer.
- **APIs/schema**: none.
- **Dependencies**: none added or removed.
- **Tests**: Rust baseline is currently 77 tests (re-verified this session). Expect this to stay at 77, or grow by one or two if CQ-012's extracted helper gets direct unit coverage. No drop is acceptable without investigation. `cargo fmt -- --check` and `cargo clippy -- -D warnings` must stay clean throughout.
- **Out of scope**: everything else in the wider audit backlog — this is one of several independent batches being proposed from the same explore session (frontend-duplication, frontend-error-surfacing, drag-handle-keyboard-a11y, remaining-a11y, docs-sweep, ci-cache-and-build-job are separate changes and share no files with this one).
