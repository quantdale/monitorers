# Progress

## Current Goal
Windows-only real-time system monitor (Rust/Tauri v2 backend, React/TS frontend) in
`sys-monitor-tauri/`, kept in a spec-driven flow (`openspec/`). Current phase:
production-runtime-recovery-and-release-qualification — supervised collector recovery,
typed lifecycle IPC, packaged-app qualification, and MSI/NSIS install qualification.

## Agent Rules
- Do not ask questions unless truly blocked.
- Make reasonable assumptions and continue.
- Work on unfinished TODOs in order.
- Mark completed TODOs with [x].
- Add new bugs, ideas, and follow-up work as TODOs.
- Run tests, lint, or build when available.
- Do not run destructive commands, force pushes, production deploys, or database resets.

## Status snapshot (2026-08-26, PR #28 safety closure in progress)
- Authoritative quick reference: root `AGENTS.md`. Supervisor lifecycle, recovery
  policy, status contract (`LIFECYCLE_SCHEMA_VERSION = 1`), retry semantics (honored
  ONLY while failed — a `Failed` answer never means ignored), and the
  qualification lanes are documented there; `CLAUDE.md` / `.cursorrules` were
  re-reconciled on 2026-08-26.
- Safety closure at the post-audit head: typed `StopFlag`/`RetryRequest` managed
  state (the two raw `Arc<AtomicBool>` registrations used to alias — Retry could
  hit shutdown), race-fenced `get_collector_status` bootstrap on mount/reload,
  top-of-loop initial tick deadline, mock healthy-only-after-first-emit + run-token
  teardown, unconditional WebView2 HKLM policy cleanup with injectable seam,
  supported download-artifact inputs, corrected retry docs. See tasks.md §10.
- Collector: supervised sessions (`src-tauri/src/collector/supervisor.rs`). A panic
  ends one session; bounded automatic recovery replaces it (3 attempts/streak,
  staged backoff 500ms→8s, healthy ≥30s resets); exhausted budget → persistent
  `failed` with manual `retry_collection`. Fresh sessions rebuild all OS-facing
  state and prime rate baselines before waiting out the first deadline
  (no fabricated post-recovery zeros/spikes).
  History survives sessions; downtime remains a truthful timestamp gap.
- Release boundary: `npm run verify:packaged` drives the built exe via CDP (real
  IPC, isolated real settings store, orphan-process assertions);
  `.github/workflows/release-qualification.yml` (dispatch/tag) builds MSI+NSIS,
  qualifies install/run/uninstall per format on clean runners, uploads a hashed
  release manifest. Installers remain unsigned (no certificate).

## Active TODO
- [ ] None in progress.

## Completed
- [x] 2026-08-21 hardening pass reconciliation (see git history).
- [x] 2026-08-25 supervised collector recovery + lifecycle contract + recovery UX.
- [x] 2026-08-25 packaged qualification lane + MSI/NSIS release-qualification CI.
- [x] 2026-08-26 PR #28 safety closure: typed stop/retry managed state, race-fenced
      status bootstrap, initial-deadline wait, mock first-emit parity + teardown token,
      workflow artifact inputs, unconditional WebView2 policy cleanup, retry-doc fix;
      hosted CI + MSI/NSIS release qualification green at b479409 (run 32922280117);
      change archived; PR merged.

## Backlog Ideas
- [ ] CI efficiency: `rust.yml` compiles `cargo-audit` from source every Windows
      Rust job; a prebuilt-binary action would cut minutes. Needs a deliberate PR.
- [ ] `.cursorrules` §6 could gain a pointer to the simulation platform docs once
      specs settle further.
- [ ] Real-lane sim journey for sidebar-order persistence across true relaunch
      (needs built exe).
- [ ] Dual identical-GPU runtime mapping still physically unvalidated (needs
      qualifying hardware); deterministic fixtures cover identity logic.

## Blocked
- None.
