## Context

`collector/mod.rs` has three `unsafe` blocks that call into the PDH (Performance Data Helper) Win32 C API:

- `new_pdh_gpu_query()` (~line 39-111) — opens the query, adds counters, does the first baseline collect. Already has a `// SAFETY:` comment (line 39-40): "PDH C API calls via FFI. All pointer arguments are stack variables. Return codes are checked before any output values are read."
- `collect_pdh()` (~line 118-123) — a small standalone function used to force a fresh PDH sample before an out-of-band read (e.g. before `physical_disk_list` during hardware detection). No comment.
- `poll()` (~line 169-173) — the main 250ms-tick data path. Contains an inline block doing the exact same `PdhCollectQueryData(query) == 0` call as `collect_pdh()`, duplicated rather than calling it. No comment.

CLAUDE.md requires every `unsafe` block in this repo to carry a `// SAFETY:` comment. These two are the only ones in the file missing it (confirmed by direct read during a prior `/opsx:explore` session).

## Goals / Non-Goals

**Goals:**
- Every `unsafe` block in `collector/mod.rs` has a `// SAFETY:` comment, consistent with the existing one at `new_pdh_gpu_query()`.
- Zero behavior change: PDH is collected exactly as often, in the same order relative to other work in `poll()`, with the same return-code handling.

**Non-Goals:**
- Not touching the tick-cadence gate, `main.rs`, or anything outside `collector/mod.rs`.
- Not addressing ARC-007 (`cpu_latest`/`gpu_latest` staleness) or COR-001 (history emission rate) — those are scoped to the separate `fix-history-emission-rate` change.
- Not a general unsafe-code audit of the rest of the codebase (e.g. `nvidia.rs`'s NVAPI unsafe block already has its own comment and is out of scope here).

## Decisions

**Decision: add matching `// SAFETY:` comments to both sites, using the same wording pattern as `new_pdh_gpu_query()`.**
Rationale: consistency — a reader scanning the file for the safety rationale of any `PdhCollectQueryData` call should find the same reasoning stated the same way. The existing comment's rationale (FFI call, stack-variable pointer args, return code checked before reading output) applies identically to both sites since all three call the same underlying API with the same calling convention.

**Decision: dedup `poll()`'s inline block to call `collect_pdh()` instead of repeating the unsafe call.**

Considered two options:

| Option | Pros | Cons |
|---|---|---|
| A. Keep duplicated, just add comments to both | Zero risk of behavior change; smallest possible diff; doesn't touch `poll()`'s control flow, which the separate `fix-history-emission-rate` change will also be editing (avoids any chance of the two changes landing out of order and conflicting) | Leaves two copies of the same one-line unsafe call in the file — the exact duplication CQ-001 flagged as a smell |
| B. Have `poll()` call `collect_pdh()`, delete the inline duplicate | Actually removes the duplication, which is the more complete reading of CQ-001; one comment location to maintain going forward | Adds one function-call indirection in the 250ms hot path (negligible — it's a single non-inlined call wrapping one FFI call, not a meaningful perf concern); touches `poll()`'s body, which is also where `fix-history-emission-rate`'s ARC-007 work (`commit_cpu`/`commit_gpu`) lands — small chance of a rebase/ordering conflict if both changes are in flight at once |

**Chosen: Option B.** The performance cost of one extra call is not measurable at a 250ms cadence, and actually removing the duplication is more faithful to what CQ-001 asked for than commenting two copies of the same code. The overlap risk with `fix-history-emission-rate` is real but small in practice: `collect_pdh()`'s change is confined to one `match` arm at the very top of `poll()` (the PDH-collect step), while ARC-007's work is in `commit_cpu`/`commit_gpu`, which are separate functions entirely — not adjacent lines within `poll()` itself. This change is also going to be proposed and applied first (before `fix-history-emission-rate`), which further reduces the ordering risk to near zero.

`poll()`'s `match collector.pdh.query { Some(query) => unsafe { PdhCollectQueryData(query) == 0 }, None => false }` becomes a direct call to `collect_pdh(collector)`, which already has identical `match`/`unsafe` logic and returns the same `bool`.

## Risks / Trade-offs

- [Risk] Option B touches `poll()`, which a subsequent change (`fix-history-emission-rate`) also edits → [Mitigation] the edited region (the PDH-collect line near the top of `poll()`) is textually distinct from where that change works (`commit_cpu`/`commit_gpu`, and the tick loop in `main.rs`); this change also lands first, so there's nothing to rebase against.
- [Risk] Calling `collect_pdh(collector)` instead of the inline block requires `collector` to still be a valid `&CollectorState` borrow at that point in `poll()` → [Mitigation] `collect_pdh()`'s signature (`&crate::state::CollectorState`) already matches how `collector` is borrowed elsewhere in `poll()`; this is a mechanical, compiler-checked substitution.

## Migration Plan

Not applicable — single-commit source change, no data migration, no rollout sequencing. Rollback is a plain revert if `cargo test`/`clippy`/`fmt` somehow regress (not expected).

## Open Questions

None outstanding — Option B above is the final decision for this change.
