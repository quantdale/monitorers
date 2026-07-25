## Why

Two `unsafe { PdhCollectQueryData(query) == 0 }` blocks in `collector/mod.rs` (in `collect_pdh()` and duplicated inline in `poll()`) lack the `// SAFETY:` comment that CLAUDE.md requires for every `unsafe` block in this codebase. This is finding CQ-001 from the 54-finding engineering audit. It was originally scoped to land alongside a tick-cadence-gate extraction (TEST-001) on the theory that both touch the same lines of `poll()`, but a prior `/opsx:explore` session confirmed that overlap doesn't exist in current source — TEST-001's target is confined to `main.rs`'s tick loop and never touches `poll()`'s body or `collect_pdh()`. With no real code-adjacency coupling, this is split out as its own small, independent fix.

## What Changes

- Add a `// SAFETY:` comment to the unsafe block in `collect_pdh()` (`collector/mod.rs:120`), matching the rationale already used at `new_pdh_gpu_query()` (`collector/mod.rs:39-41`): PDH C API via FFI, pointer arguments are stack variables, return codes are checked before any output is read.
- Add the same `// SAFETY:` comment to the duplicated inline unsafe block in `poll()` (`collector/mod.rs:171`).
- Evaluate (and record the decision in `design.md`) whether `poll()`'s inline block should instead call the existing `collect_pdh()` function rather than duplicating the same unsafe call — a pure internal dedup, not a behavior change.

No IPC schema changes. No behavior changes are intended; if the dedup option is taken, it must be behavior-preserving.

## Capabilities

### New Capabilities
- `unsafe-code-safety-documentation`: captures, as a formal requirement, the existing CLAUDE.md convention that every `unsafe` block in the Rust backend must carry a `// SAFETY:` comment. This change is the first to bring the two non-compliant PDH call sites into line with it, so it's recorded here rather than left as prose-only guidance.

### Modified Capabilities
(none — no existing spec's requirements are changing; PDH polling continues to return the same values under the same conditions)

## Impact

- **Code**: `sys-monitor-tauri/src-tauri/src/collector/mod.rs` only (`collect_pdh()` at line ~120, `poll()` at line ~171; optionally removing the duplicated call in favor of invoking `collect_pdh()`).
- **APIs/schema**: none.
- **Dependencies**: none.
- **Tests**: no new tests required; existing 70 Rust tests must continue to pass unchanged. `cargo clippy -- -D warnings` and `cargo fmt -- --check` must stay clean.
