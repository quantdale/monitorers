## 1. Add SAFETY comments and dedup the PDH collect call

- [x] 1.1 Add a `// SAFETY:` comment above the `unsafe { PdhCollectQueryData(query) == 0 }` block in `collect_pdh()` (`collector/mod.rs:~120`), matching the rationale used at `new_pdh_gpu_query()` (FFI call, stack-variable pointer arguments, return code checked before any output is read).
- [x] 1.2 In `poll()` (`collector/mod.rs:~169-173`), replace the duplicated inline `match collector.pdh.query { Some(query) => unsafe { PdhCollectQueryData(query) == 0 }, None => false }` with a direct call to `collect_pdh(collector)`.
- [x] 1.3 Re-read both edited sites to confirm no other behavior changed (same return type, same short-circuit on `None`, same call ordering relative to the rest of `poll()`).

## 2. Verify

- [x] 2.1 Run `cargo test --verbose` from `src-tauri/` — confirm all 70 tests still pass (no count change expected).
- [x] 2.2 Run `cargo fmt -- --check` from `src-tauri/` — confirm clean.
- [x] 2.3 Run `cargo clippy -- -D warnings` from `src-tauri/` — confirm zero warnings.
- [x] 2.4 Run `cargo audit` from `src-tauri/` — confirm it stays clean (no new advisories introduced).
