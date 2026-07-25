## Context

`cargo audit` (run in CI's `rust-lint` job via `cargo install cargo-audit --quiet && cargo audit`) currently exits 1 against 3 RUSTSEC advisories, all in transitive dependencies:

- `crossbeam-epoch` 0.9.18 (RUSTSEC-2026-0204), pulled in via `sysinfo` 0.33.1 → `rayon` 1.11.0 → `rayon-core` 1.13.0 → `crossbeam-deque` 0.8.6. Fix: >=0.9.20.
- `quick-xml` 0.38.4, two high-severity (7.5) advisories (RUSTSEC-2026-0194, -0195), pulled in via `plist` 1.8.0 → `tauri-plugin`/`tauri-codegen`/`tauri` 2.10.3. Fix: >=0.41.0.

None of `crossbeam-epoch`, `quick-xml`, or `plist` are direct dependencies in `Cargo.toml`; all three are locked transitively via `Cargo.lock`. Dry-run verification (explore phase, re-confirmed) shows:

- `cargo update -p crossbeam-epoch --dry-run` → updates 0.9.18 → 0.9.20 alone, fixing RUSTSEC-2026-0204.
- `cargo update -p quick-xml --dry-run` alone → 0 packages updated (quick-xml's version is pinned by `plist`'s own `Cargo.toml` constraint; it cannot float independently).
- `cargo update -p plist --dry-run` → updates `plist` 1.8.0 → 1.10.0 **and** `quick-xml` 0.38.4 → 0.41.0 as a consequence, fixing both quick-xml advisories.

Separately, `.cursor/commands/check.md` documents the local quality gate a contributor is expected to run before pushing, but it omits `cargo audit` and `npm audit` entirely and states a stale Rust test count (45, vs. the actual 70 confirmed via `cargo test --verbose`). No `.git/hooks` are active (only Git's stock `.sample` files exist) and no `audit.toml` / `.cargo/audit.toml` exists anywhere in the repo, so there is no allowlist mechanism already in place that this change needs to reconcile with.

## Goals / Non-Goals

**Goals:**
- Get `cargo audit` to exit 0 (or, more precisely, no longer fail on the 3 currently-active advisories) via a `Cargo.lock`-only regeneration.
- Confirm the durable, tracked documentation of the CI gate (`CLAUDE.md`'s "CI readiness gate" section) accurately reflects what CI enforces, including `cargo audit`/`npm audit` and correct test-count baselines.

**Non-Goals:**
- Not editing `Cargo.toml` — none of the affected crates are direct dependencies, and no version-constraint change is needed to get the fix.
- Not addressing the 21 "allowed" advisories/warnings (unmaintained GTK3 bindings pulled in for Tauri's Linux target, anyhow/glib/rand unsoundness advisories) — these are pre-existing, out of scope, and not newly introduced by this change. CI's `cargo audit` invocation has no `--deny warnings` flag, so these don't fail the build today and won't after this change either.
- Not adding a `.git/hooks/pre-push` hook or CI workflow changes — CI already runs `cargo audit` and `npm audit` as part of `rust-lint` / `frontend` jobs respectively; only the *locally-documented* gate is out of sync.
- Not modifying any Rust or TypeScript source file — this is a lockfile regeneration plus a documentation fix.

## Decisions

**Decision: Run `cargo update -p crossbeam-epoch -p plist` rather than a bare `cargo update`.**
Targeting the two packages whose bumps are required (with `quick-xml` following transitively from `plist`) keeps the lockfile diff minimal and auditable — a reviewer can see exactly which advisory each bump addresses, rather than absorbing an unrelated, wider set of transitive bumps a full `cargo update` might pull in. Alternative considered: bare `cargo update` (rejected — larger, harder-to-review diff for no additional benefit, since the dry-run already confirms the targeted approach clears all 3 advisories).

**Decision: No `Cargo.toml` edit, no `audit.toml` allowlist file.**
The fix is achievable as a pure lockfile regeneration; introducing an allowlist file would be solving a problem that doesn't exist (there's nothing left to allow-list once the lockfile is regenerated) and would set an unnecessary precedent for suppressing future advisories instead of fixing them. Alternative considered: add `audit.toml` to formally allow-list the 21 pre-existing GTK3/Linux warnings — rejected as out of scope; those already don't fail CI (no `--deny warnings`), so there's no gate to fix.

**Decision (superseded): Fold the `check.md` documentation fix (DOC-002) into this same change rather than a separate one.**
This decision was made during explore/propose on the assumption that `.cursor/commands/check.md` was the durable, contributor-facing quality-gate doc, and fixing it alongside the lockfile regen would be low-cost. That assumption was wrong: `.cursor/` is gitignored (`.gitignore` line 15, present since the repo's first commit, `.cursor/` never tracked in any branch) and `check.md` is personal IDE state, not something other contributors or a fresh clone would ever see. Editing it doesn't "fold in DOC-002" in any durable sense — it just edits a file that only exists on this machine.

What actually resolves DOC-002 is that `CLAUDE.md`'s tracked, durable **"CI readiness gate"** section (lines 33-40) already lists all 7 CI checks (`cargo test --verbose`, `cargo fmt -- --check`, `cargo clippy --verbose -- -D warnings`, `cargo audit`, `npm audit --audit-level=high`, `npx tsc --noEmit`, `npm test -- --run`) with the correct 70/41 baselines — verified accurate as part of this change, no edit required. So the original DOC-002 scoping question ("bundle vs. split into its own change") is moot: there was no durable doc fix to bundle or split. The `check.md` edit was still applied locally for the operator's own consistency, but it's explicitly non-durable and not a deliverable of this change.

Alternative considered, now moot: a separate change for `check.md` — irrelevant once `check.md` is understood to be gitignored personal state rather than a shared contributor doc.

## Risks / Trade-offs

- [Risk] Bumping `plist` 1.8.0 → 1.10.0 could introduce an unrelated transitive API break if `tauri-plugin-store`/`tauri`'s use of `plist` is sensitive to its version → Mitigation: `plist` is used only internally by Tauri's own crates (`tauri-plugin`, `tauri-codegen`, `tauri`) for its own macOS `.plist`-adjacent tooling, not called directly by `sys-monitor-tauri` code; the full local verification gate (`cargo test`, `cargo fmt --check`, `cargo clippy -D warnings`) after the lockfile regen will catch any resulting build/test breakage before merge.
- [Risk] A future `cargo audit` run could reintroduce advisories if the lockfile drifts again with no gate catching it before CI → Mitigation: `CLAUDE.md`'s "CI readiness gate" section already documents `cargo audit`/`npm audit` as required checks before considering a task done; since that file is tracked and durable (unlike `.cursor/commands/check.md`), it's the effective safety net going forward, and it was verified accurate rather than needing a fix.
- [Trade-off] Not deploying an allowlist (`audit.toml`) for the 21 pre-existing GTK3 warnings means `cargo audit`'s full output remains noisy (though not build-failing) — accepted as out of scope; revisit only if CI's audit invocation is later changed to `--deny warnings`.

## Migration Plan

1. From `sys-monitor-tauri/src-tauri/`, run `cargo update -p crossbeam-epoch -p plist` to regenerate `Cargo.lock`.
2. Run the full local verification gate: `cargo test --verbose` (expect 70 passed), `cargo fmt -- --check`, `cargo clippy -- -D warnings`, `cargo audit` (expect exit 0 / no unresolved advisories).
3. Confirm `CLAUDE.md`'s "CI readiness gate" section already lists all 7 CI checks and the correct 70/41 baselines — no edit expected or needed.
4. Commit the regenerated `Cargo.lock` alone (no durable doc change accompanies it).

No rollback complexity beyond a normal git revert — this is a lockfile-only dependency bump, with no runtime behavior change and no schema/data migration involved.

## Open Questions

None outstanding — all verification steps were re-confirmed live during the explore phase (cargo audit output, dry-run deltas, test counts, hook/config file absence).
