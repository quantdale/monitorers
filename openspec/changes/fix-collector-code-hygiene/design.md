## Context

This change bundles seven small, previously-open audit findings (CQ-002, CQ-003, CQ-004, CQ-005, CQ-006, CQ-007, CQ-012) into one Rust-side hygiene pass. All were re-verified against current source (not just the audit's 2026-07-25 snapshot) in a preceding explore session. None overlap each other's files or lines; none require a schema change; none change observable behavior of the running app. The design questions here are narrow — for each finding, confirm *why* the change is safe rather than just asserted safe.

## Goals / Non-Goals

**Goals:**
- Close the two remaining `// SAFETY:` comment gaps (CQ-002, CQ-003) so the `unsafe-code-safety-documentation` capability's coverage is no longer partial.
- Remove code that is provably dead or provably over-broad (CQ-004, CQ-005, CQ-006, CQ-007), verified by compiler/test evidence rather than asserted from the audit alone.
- Deduplicate `disk.rs`'s drive-letter resolution logic (CQ-012) without changing either caller's output.

**Non-Goals:**
- No behavior change to PDH, NVAPI/NVML, GPU classification, or disk enumeration.
- No new tests are strictly required by this change (it removes/documents, it doesn't add capability), though CQ-012's extraction is a natural place to add one if convenient.
- Not addressing any other audit finding — multi-GPU keying (COR-002/ARC-001), error-handling/observability (ERR-*), or anything frontend. Those are separate changes.

## Decisions

- **CQ-002/CQ-003 — comment text, not behavior.** Match the existing convention's wording style already used at `new_pdh_gpu_query()`/`collect_pdh()`: state the FFI boundary, why the arguments are sound (owned/stack-local handles), and that no output is read past a failure. No alternative considered — this is pure documentation, and the convention already exists.

- **CQ-004 — delete `unsafe impl Send/Sync for HistoryStore` rather than add a `#[derive]` or restructure fields.** All current `HistoryStore` fields are automatically `Send + Sync` (owned `String`/`VecDeque`/`HashMap`/`Option` scalars, plus `HardwareProfile` which itself contains only owned data, no raw pointers or `Cell`/`RefCell`). Rust auto-derives `Send`/`Sync` for such structs, so the explicit `unsafe impl` blocks are redundant, not just superfluous-looking. Alternative considered: leave them in place as defensive documentation of intent — rejected, since an incorrect `unsafe impl` is worse than none if a future field addition (e.g. a raw pointer or `Rc`) would otherwise be silently allowed through unsafely-asserted `Send`/`Sync` rather than caught by the compiler. Verification: `cargo check` (and the full `cargo test`) must pass after deletion with no changes elsewhere — if it doesn't, that itself proves the `unsafe impl` was load-bearing and this deletion must be reverted, not forced through.

- **CQ-005 — gate `NvAPI_Initialize()` at its call site with the same `cfg` already used by its sole consumer**, rather than leaving it running unconditionally under `nvapi` alone. Alternative considered: remove `nvapi_initialized`/NVAPI init entirely and drop the feature — rejected as out of scope; the `nvapi`-only (no `nvml`) build configuration is a real, if untested-by-default, configuration this project supports, and NVAPI init must still run in that case. The fix is precisely mirroring the `cfg` already applied to the consumer (`query_nvidia_gpu_temp`), not inventing a new condition.

- **CQ-006/CQ-007 — delete rather than keep-with-better-allow.** Both are confirmed-unreferenced (`commit()` superseded by granular commits; the three `HardwareProfile::has_*` methods have no caller anywhere in `src/` or `src-tauri/src/`). Since nothing currently plans to add the "future providers" these were speculatively kept for, deleting is preferred over refining their `#[allow(dead_code)]` annotations — the project's own convention already discourages unconditional `allow` suppression, and there's no concrete near-term consumer to justify keeping speculative API surface warm.

- **CQ-012 — extract a shared private helper in `disk.rs`, not a new module.** Both `physical_disk_list()` and `poll_disk()` stay in `collector/disk.rs`; only the drive-letter-resolution logic (building `known_drive_letters` from `disks.list()`, then filtering/joining via `pdh_instance_to_drive_letters`) moves into one function both call. Kept file-local since nothing outside `disk.rs` needs this logic today.

## Risks / Trade-offs

- [Risk: deleting `unsafe impl Send/Sync` reveals a real, previously-masked concurrency issue] → Mitigation: `cargo check` and the full `cargo test` suite (77 tests) are the gate. If either fails after deletion, that's new information — stop and investigate rather than restoring the `unsafe impl` to make the error disappear.
- [Risk: CQ-005's `cfg` gating accidentally changes behavior in the `nvml`-only default build] → Mitigation: the change only adds a `cfg` condition that's already `true` in every currently-tested/default configuration (`nvapi` + `nvml`) evaluates the *consumer* to compiled-out already; gating the initializer the same way changes nothing observable in that build. Confirm via `cargo test` under default features (unchanged) — a separate manual `cargo check --no-default-features --features nvapi` (nvapi-only) build is worth a spot check to confirm NVAPI still initializes in that configuration, though it isn't part of CI.
- [Risk: CQ-012's extraction subtly changes drive-letter output for an edge case only one of the two callers previously handled] → Mitigation: read both functions' full current behavior before extracting; if any difference exists between the two (e.g., one filters something the other doesn't), keep that as a parameter to the shared helper rather than silently unifying it away.

## Migration Plan

Not applicable — no data migration, no schema change, no user-facing rollout. Standard PR: implement, run the full local gate (`cargo test`, `cargo fmt -- --check`, `cargo clippy -- -D warnings`, `cargo audit`), commit.

## Open Questions

None — all seven findings have a clear, low-risk resolution path; nothing here requires a decision from the maintainer beyond reviewing the diff.
