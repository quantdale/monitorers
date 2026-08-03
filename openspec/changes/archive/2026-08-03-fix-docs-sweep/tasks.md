## 1. Re-verify current numbers before editing (DOC-003 prerequisite)

- [x] 1.1 Run `cargo test --verbose` from `src-tauri/` and `npm test -- --run` from `sys-monitor-tauri/` to reconfirm the current exact passing test counts immediately before making doc edits (do not assume 77/46 are still current if other changes have merged in the interim). **Confirmed stale exactly as design.md's risk section predicted: the proposal's own "77/46" baseline had already drifted by implementation time.** `npm test -- --run` in this sandbox: **77 frontend tests pass** (up from 46, per the just-merged `add-realistic-usage-test-suite` change). `cargo test` **cannot run in this Linux sandbox** (no `cfg(windows)` gating anywhere in the crate; the Tauri Linux webview backend needs `gdk-3.0` system headers not present, no network access to install them — same constraint hit by `add-realistic-usage-test-suite`). Cross-checked instead via `grep -rc '#\[test\]' src/` at HEAD vs. at the commit where `CLAUDE.md` last said "70" (`f8fc608`, where the same grep also returned exactly 70 — validating the method) — current count is **88**. Used **88 Rust / 77 frontend** as the reconfirmed baseline for all edits below.
- [x] 1.2 (Note, not a task) Left this session's methodology visible in the git history (see this task's note) rather than restating "77/46" from the proposal verbatim, since acting on unverified proposal numbers would have reintroduced the exact DOC-003 drift this change exists to fix.

## 2. Fix stale test counts (DOC-003)

- [x] 2.1 Update `.cursorrules:65-66`'s test-count claims (currently "45 tests expected" / "41 tests expected") to the reconfirmed current counts from task 1.1 (88 Rust / 77 frontend). Also updated the Vitest test-file count callout further down in the same file (was still saying "41 tests") for consistency, and reworded both headers to "as of the latest merged change" per design.md's DOC-003 phrasing decision.
- [x] 2.2 Update root `CLAUDE.md`'s test-count claims (currently 70/41) to the reconfirmed current counts from task 1.1 (88 Rust / 77 frontend), in both the commands block and the CI readiness gate prose.
- [x] 2.3 Do not edit `.cursor/commands/check.md` — confirmed out of scope (gitignored, non-durable, per the `fix-dependency-audit` precedent). Left untouched.

## 3. Fix stale CI section (DOC-004)

- [x] 3.1 Rewrite `.cursorrules:292-298`'s "CI" section to describe the real three-job pipeline (`rust-test`, `rust-lint` with fmt/clippy/`cargo audit`, `frontend` with `npm audit`/`tsc --noEmit`/vitest), mirroring root `CLAUDE.md`'s already-correct "CI readiness gate" section's content.

## 4. Fix stale README facts (DOC-005)

- [x] 4.1 Update README.md's dev server port reference (currently `http://localhost:5173`) to the actual port (`5180`, per `vite.config.ts`'s `strictPort: true` setting).
- [x] 4.2 Update README.md's `src-tauri/src/` project-layout table to reflect the actual current file layout (including the `collector/` subdirectory, `hardware.rs`, `pdh.rs`, `sensor.rs`).
- [x] 4.3 Update README.md's stated Node.js minimum version (currently "v16+") to match what CI actually requires (Node 20, per `.github/workflows/rust.yml`).

## 5. Remove dead file references (DOC-008)

- [x] 5.1 Remove the `App.css` reference in `.cursorrules`' directory-tree listing (line 87).
- [x] 5.2 Remove the `App.css` reference in `.cursorrules`' file-description table (line 205).

## 6. Verify

- [x] 6.1 Grep `.cursorrules`, root `CLAUDE.md`, and `README.md` for any remaining occurrence of the old stale numbers/facts (45, 70, 41 test counts where inapplicable; 5173; App.css; v16) to confirm nothing was missed. Clean — zero matches for `App.css`, `5173`, `v16`, and the old "45 test"/"41 test"/"70 test" phrasings across all three files.
- [x] 6.2 No code changes in this batch — `cargo test`/`npm test` are not expected to change count as a result of this change itself, only re-run in task 1.1 to source the correct numbers to write down. Confirmed: `git status` shows only `.cursorrules`, `CLAUDE.md`, and `sys-monitor-tauri/README.md` modified; re-ran `npm test -- --run` after edits, still 77 passing, no source touched.
