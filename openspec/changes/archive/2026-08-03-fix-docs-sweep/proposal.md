## Why

A 2026-07-25 engineering audit flagged four documentation-accuracy findings (DOC-003, DOC-004, DOC-005, DOC-008). Re-verification against current source found all four still open, plus a new instance the audit didn't anticipate: root `CLAUDE.md`, which the audit's own session corrected to "70/41" at the time, has since drifted stale again (now genuinely 77/46) because two more changes merged after the audit closed — confirming DOC-003's underlying problem (test counts drift and nothing catches it) is recurring, not a one-time fix. All four findings are pure prose corrections with zero code risk — bundled as one docs-only sweep, the same shape as prior doc-only batches in this project's history.

## What Changes

- **DOC-003**: Update stale test-count claims to the current baseline (**77 Rust tests, 46 frontend tests**) in:
  - `.cursorrules:65-66` (currently says "45 tests expected" / "41 tests expected" — even more stale than the audit's own 70/41 pin)
  - root `CLAUDE.md` (currently says 70/41 — was correct at audit time, has since drifted stale again after two more changes merged)
  - `.cursor/commands/check.md` is explicitly **out of scope** here: a prior change (`fix-dependency-audit`) established that this file is gitignored personal IDE state, never tracked in any branch, and therefore not a durable deliverable — its staleness doesn't affect other contributors or CI.
- **DOC-004**: Rewrite `.cursorrules:292-298`'s "CI" section, which currently describes a stale single-job pipeline (`cargo build`, `cargo test`, `cargo fmt -- --check`, `cargo clippy -- -D warnings`) omitting `cargo audit` entirely and never mentioning the frontend job at all. Replace with an accurate description of the real three-job pipeline (`rust-test`, `rust-lint` [fmt + clippy + `cargo audit`], `frontend` [`npm audit` + `tsc --noEmit` + vitest]), matching what root `CLAUDE.md`'s CI section already correctly says.
- **DOC-005**: Fix three stale facts in `sys-monitor-tauri/README.md`:
  - Dev port: currently states `http://localhost:5173`; actual is `5180` with `strictPort: true` (`vite.config.ts`).
  - Project-layout table: currently describes a flat `src-tauri/src/` (`main.rs, collector.rs, state.rs`); actual layout has a `collector/` subdirectory plus `hardware.rs`, `pdh.rs`, `sensor.rs`.
  - Node.js minimum: currently states "v16+"; actual CI requirement is Node 20 (`.github/workflows/rust.yml`), and no `engines` field exists in `package.json` to enforce this — update the stated minimum to match what CI actually uses.
- **DOC-008**: Remove the two remaining `.cursorrules` references to `App.css` as "legacy, unused" (lines 87 and 205) — the file has been deleted from the repo entirely; the references are flatly wrong, not just stale.

## Capabilities

### New Capabilities
- `project-documentation-accuracy`: formalizes, as a durable requirement, that developer-facing documentation (`.cursorrules`, root `CLAUDE.md`, `README.md`) stays synchronized with the actual current test counts, CI pipeline shape, onboarding facts (dev port, file layout, Node version), and file inventory (no references to deleted files). No such capability currently exists in `openspec/specs/`; this is motivated directly by CLAUDE.md's own re-drift discovered during this batch's verification — a durable requirement makes the "check docs are still accurate" step a recognized, revisitable spec rather than a one-time audit fix that silently goes stale again.

### Modified Capabilities
(none)

## Impact

- **Code**: none (documentation only). Files touched: `.cursorrules` (repo root), `CLAUDE.md` (repo root), `sys-monitor-tauri/README.md`.
- **APIs/schema**: none.
- **Dependencies**: none.
- **Tests**: no test count change expected — this change doesn't touch source. As a matter of process (not automation, since no doc-linting exists in this repo), the numbers stated here should be re-verified against the actual `cargo test --verbose`/`npm test -- --run` output at the moment this change is applied, in case additional changes have merged in the interim and drifted the count yet again.
- **Out of scope**: `.cursor/commands/check.md` (gitignored, not a durable deliverable, per the established `fix-dependency-audit` precedent); `DOC-006`/`DOC-007` (actual CI workflow YAML changes, proposed separately as `fix-ci-cache-and-build-job` since they carry different review weight than prose-only doc fixes); everything else in the wider audit backlog.
