## 1. Re-verify current numbers before editing (DOC-003 prerequisite)

- [ ] 1.1 Run `cargo test --verbose` from `src-tauri/` and `npm test -- --run` from `sys-monitor-tauri/` to reconfirm the current exact passing test counts immediately before making doc edits (do not assume 77/46 are still current if other changes have merged in the interim).

## 2. Fix stale test counts (DOC-003)

- [ ] 2.1 Update `.cursorrules:65-66`'s test-count claims (currently "45 tests expected" / "41 tests expected") to the reconfirmed current counts from task 1.1.
- [ ] 2.2 Update root `CLAUDE.md`'s test-count claims (currently 70/41) to the reconfirmed current counts from task 1.1.
- [ ] 2.3 Do not edit `.cursor/commands/check.md` — confirmed out of scope (gitignored, non-durable, per the `fix-dependency-audit` precedent).

## 3. Fix stale CI section (DOC-004)

- [ ] 3.1 Rewrite `.cursorrules:292-298`'s "CI" section to describe the real three-job pipeline (`rust-test`, `rust-lint` with fmt/clippy/`cargo audit`, `frontend` with `npm audit`/`tsc --noEmit`/vitest), mirroring root `CLAUDE.md`'s already-correct "CI readiness gate" section's content.

## 4. Fix stale README facts (DOC-005)

- [ ] 4.1 Update README.md's dev server port reference (currently `http://localhost:5173`) to the actual port (`5180`, per `vite.config.ts`'s `strictPort: true` setting).
- [ ] 4.2 Update README.md's `src-tauri/src/` project-layout table to reflect the actual current file layout (including the `collector/` subdirectory, `hardware.rs`, `pdh.rs`, `sensor.rs`).
- [ ] 4.3 Update README.md's stated Node.js minimum version (currently "v16+") to match what CI actually requires (Node 20, per `.github/workflows/rust.yml`).

## 5. Remove dead file references (DOC-008)

- [ ] 5.1 Remove the `App.css` reference in `.cursorrules`' directory-tree listing (line 87).
- [ ] 5.2 Remove the `App.css` reference in `.cursorrules`' file-description table (line 205).

## 6. Verify

- [ ] 6.1 Grep `.cursorrules`, root `CLAUDE.md`, and `README.md` for any remaining occurrence of the old stale numbers/facts (45, 70, 41 test counts where inapplicable; 5173; App.css; v16) to confirm nothing was missed.
- [ ] 6.2 No code changes in this batch — `cargo test`/`npm test` are not expected to change count as a result of this change itself, only re-run in task 1.1 to source the correct numbers to write down.
