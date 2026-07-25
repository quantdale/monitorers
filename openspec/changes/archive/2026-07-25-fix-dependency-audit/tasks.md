## 1. Regenerate Cargo.lock

- [x] 1.1 From `sys-monitor-tauri/src-tauri/`, run `cargo update -p crossbeam-epoch -p plist` (not a bare `cargo update`) to bump `crossbeam-epoch` to >=0.9.20 and `plist`/`quick-xml` transitively to >=1.10.0/>=0.41.0
- [x] 1.2 Confirm `Cargo.lock` diff touches only `crossbeam-epoch`, `plist`, and `quick-xml` (no unrelated transitive bumps, no `Cargo.toml` changes)

## 2. Verify the fix

- [x] 2.1 Run `cargo audit` from `sys-monitor-tauri/src-tauri/` — confirm exit 0 with no report for `crossbeam-epoch`, `quick-xml`, or `plist` (the 21 pre-existing GTK3/unmaintained warnings are expected to remain and are out of scope)
- [x] 2.2 Run `cargo test --verbose` from `sys-monitor-tauri/src-tauri/` — confirm 70 passed, 0 failed
- [x] 2.3 Run `cargo fmt -- --check` from `sys-monitor-tauri/src-tauri/` — confirm no diff
- [x] 2.4 Run `cargo clippy -- -D warnings` from `sys-monitor-tauri/src-tauri/` — confirm zero warnings
- [x] 2.5 Run `npm test -- --run` from `sys-monitor-tauri/` — confirm 41 passed (unaffected by this change, sanity check only)

## 3. Update the documented local quality gate

- [x] 3.1 Edit `.cursor/commands/check.md` to add a `cargo audit` step under the `src-tauri/` steps — **non-durable**: `.cursor/` is gitignored (never tracked in any branch), so this edit is personal-machine-only and does not reach `main` or other contributors. Not a deliverable of this change.
- [x] 3.2 Edit `.cursor/commands/check.md` to add an `npm audit --audit-level=high` step under the `sys-monitor-tauri/` steps — same non-durable caveat as 3.1.
- [x] 3.3 Correct the stale "cargo test: 45 tests pass" baseline in `.cursor/commands/check.md` to 70 tests — same non-durable caveat as 3.1.
- [x] 3.4 Confirm `CLAUDE.md`'s tracked "CI readiness gate" section (lines 33-40) already lists all 7 CI checks (`cargo test --verbose`, `cargo fmt -- --check`, `cargo clippy --verbose -- -D warnings`, `cargo audit`, `npm audit --audit-level=high`, `npx tsc --noEmit`, `npm test -- --run`) with the correct 70/41 baselines — **verified accurate, no edit needed.** This is the durable doc that actually closes DOC-002; `check.md` was a stale, out-of-scope duplicate.

## 4. Commit

- [x] 4.1 Stage and commit the regenerated `Cargo.lock` (commit `ec6bddd`). No accompanying doc commit — `CLAUDE.md` needed no change and `check.md` is gitignored.
