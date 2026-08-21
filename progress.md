# Progress

## Current Goal
Windows-only real-time system monitor (Rust/Tauri v2 backend, React/TS frontend) in
`sys-monitor-tauri/`, kept in a spec-driven flow (`openspec/`). Current phase: post-hardening
reconciliation — documentation, OpenSpec specs, and CI configuration aligned with the
implemented source after the reliability-hardening waves that landed through
`2026-08-13-comprehensive-reliability-hardening`.

## Agent Rules
- Do not ask questions unless truly blocked.
- Make reasonable assumptions and continue.
- Work on unfinished TODOs in order.
- Mark completed TODOs with [x].
- Add new bugs, ideas, and follow-up work as TODOs.
- Run tests, lint, or build when available.
- Do not run destructive commands, force pushes, production deploys, or database resets.

## Status snapshot (verified 2026-08-21, after hardening pass)
- Authoritative quick reference: root `AGENTS.md`. `CLAUDE.md` and `.cursorrules` were
  re-reconciled against source on 2026-08-21 (schema version 5, modular backend layout,
  plugin-store persistence, default features `["nvapi", "nvml"]`, canonical `verify:*` gates).
- Verified gate status (frontend): `npx tsc --noEmit` clean; Vitest 209/209 passing;
  `npm run build` OK (split chunks: app ~57 kB + vendor-react/charts/dnd, charts lazy-loaded);
  `npm run sim:typecheck` clean. Rust: fmt/clippy clean both feature lanes, 180 lib tests
  passing (plus probe/main suites); one ignored real-hardware cadence test.
- E2E mock harness: 12 Playwright tests in 6 files (`npx playwright test --list`,
  `e2e/playwright.config.ts`). Earlier docs saying "9 tests" were stale and are corrected.
- Canonical gates live in `sys-monitor-tauri/scripts/verify.mjs`: clippy runs
  `--all-targets --all-features -- -D warnings`; Rust tests run under five feature
  combinations; `verify:fast` = frontend+rust, wired to husky `pre-push`.
- Backend layout: `src-tauri/src/{main.rs thin shell, lib.rs facade, cadence.rs, error_log.rs,
  hardware.rs, pdh.rs, sensor.rs, state.rs, bin/cadence_probe.rs, collector/{mod,cpu,disk,gpu,
  nvidia,run_loop,snapshot}.rs}`. IPC commands: `get_history`, `get_hardware_profile`,
  `sim_store_override` (simulation-only). Fatal collector errors persist to a size-capped
  `collector-error.log` in the app-data dir (`error_log.rs`).

## Active TODO
- [ ] None in progress.

## Completed
- [x] Reconciled `CLAUDE.md` and `.cursorrules` against source (drift corrections listed in
      the 2026-08-21 reconciliation report).
- [x] Replaced this template skeleton with a truthful status snapshot.
- [x] Spot-checked all 15 `openspec/specs/*/spec.md` capabilities against code; fixed
      contradicting text, noted aspirational requirements in the report.
- [x] Annotated `AUDIT_REPORT.md` with a remediation-status header (2026-08-21).
- [x] Hardening pass 2026-08-21: backend determinism/dedup/error-context fixes + tests;
      frontend drag-reorder guard, render memoization, bundle split + lazy charts; sim
      platform atomic artifacts, bounded teardown, semantic polling, new journeys; IPC
      schema v5 (`net_*_kib_s` rename, dead disk `temp_c` removed).

## Backlog Ideas
- [x] ~~Normalize mixed CRLF/LF line endings in root `CLAUDE.md` / `.cursorrules`~~ —
      investigated 2026-08-21: repo blobs are already LF-normalized; working-tree CRLF comes
      from `core.autocrlf=true` at checkout. Not an issue; no change needed.
- [ ] CI efficiency: `rust.yml` compiles `cargo-audit` from source on every Windows Rust job
      (`cargo install cargo-audit --version 0.22.1 --locked`); a prebuilt-binary action would
      cut minutes per run. Needs a deliberate PR, not a drive-by edit.
- [ ] `.cursorrules` §6 still documents only the co-located Rust/Vitest layers; consider a
      pointer to the simulation platform docs (`e2e/sim/`) once specs settle.
- [x] Internal Rust names `RawPoll.net_recv_kb_s/net_sent_kb_s` renamed to `*_kib_s`
      (2026-08-21) — same misnomer cleanup as the schema v5 IPC keys.
- [ ] Real-lane sim journey for sidebar-order persistence across true relaunch (needs built
      exe; `dragSidebarCard` step is now drivable).

## Blocked
- None.
