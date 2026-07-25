## Why

`cargo audit` fails today with 3 hard RUSTSEC vulnerabilities (crossbeam-epoch invalid-pointer-deref, plus two high-severity quick-xml DoS advisories), all fixable by regenerating `Cargo.lock` with no `Cargo.toml` edits. CI's `rust-lint` job already runs `cargo audit`, so this is a live, currently-red gate on `main`, not a hypothetical risk.

Separately, the change originally set out to fix a documentation gap in `.cursor/commands/check.md` (missing `cargo audit`/`npm audit` steps, stale 45-test baseline). Investigation during implementation found that gap already closed elsewhere: `CLAUDE.md`'s tracked, durable **"CI readiness gate"** section (lines 33-40) already lists all 7 checks CI runs — including `cargo audit` and `npm audit --audit-level=high` — with the correct 70/41 test baselines. `.cursor/commands/check.md` is gitignored personal IDE state (never tracked in any branch, ignored since the repo's first commit) and was simply a stale duplicate. No doc fix was needed.

## What Changes

- Regenerate `Cargo.lock` via `cargo update -p crossbeam-epoch -p plist` to pull crossbeam-epoch to >=0.9.20 and plist/quick-xml to >=1.10.0/>=0.41.0, resolving all 3 active RUSTSEC advisories.
- Verified `CLAUDE.md`'s "CI readiness gate" section is already accurate (all 7 CI checks listed, 70/41 baselines correct) — no edit needed there. `.cursor/commands/check.md` was edited locally for personal consistency but is gitignored and out of this change's durable scope; it is not a deliverable.
- No source code changes — `crossbeam-epoch`, `quick-xml`, and `plist` are all transitive dependencies (via `sysinfo` and `tauri`/`tauri-plugin-store` respectively); none are declared directly in `Cargo.toml`.

## Capabilities

### New Capabilities
- `dependency-vulnerability-audit`: establishes the requirement that both CI and the documented local quality gate check Rust and npm dependencies against known-vulnerability databases (`cargo audit`, `npm audit`) before a change is considered mergeable, and that the Cargo lockfile stay free of unresolved advisories with available fixes.

### Modified Capabilities
(none — no existing capability specs in `openspec/specs/` cover dependency auditing)

## Impact

- `sys-monitor-tauri/src-tauri/Cargo.lock` — regenerated (2 packages bumped: `crossbeam-epoch`, `plist`; `quick-xml` bumped transitively as a consequence of the `plist` bump). No `Cargo.toml` edits.
- `CLAUDE.md` — no edit; its "CI readiness gate" section was verified already correct (all 7 checks, 70/41 baselines) and needs nothing further.
- `.cursor/commands/check.md` — edited locally (added audit steps, corrected baseline) but this file is gitignored, untracked, and out of scope for this change's durable impact; it does not reach `main` or other contributors.
- No Rust or TypeScript source files change. No behavior change to the running app. CI's existing `rust-lint` job (`cargo audit`) goes from failing to passing; no CI workflow file changes needed.
