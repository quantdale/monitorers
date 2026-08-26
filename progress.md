# Progress

## Current Goal
Windows-only real-time system monitor (Rust/Tauri v2 backend, React/TS frontend) in
`sys-monitor-tauri/`, kept in a spec-driven flow (`openspec/`). Current phase:
post-feature hardening (`production-persistence-and-operational-hardening`) —
repository-truth convergence, real-lane sidebar relaunch persistence
certification, bounded restart/settings durability soak, and CI efficiency
without gate reduction.

## Agent Rules
- Do not ask questions unless truly blocked.
- Make reasonable assumptions and continue.
- Work on unfinished TODOs in order.
- Mark completed TODOs with [x].
- Add new bugs, ideas, and follow-up work as TODOs.
- Run tests, lint, or build when available.
- Do not run destructive commands, force pushes, production deploys, or database resets.

## Status snapshot (2026-08-26, post-PR #28 hardening)
- Authoritative quick reference: root `AGENTS.md`. Supervisor lifecycle, recovery
  policy, status contract (`LIFECYCLE_SCHEMA_VERSION = 1`), retry semantics (honored
  ONLY while failed — a `Failed` answer never means ignored), and the
  qualification lanes are documented there; `CLAUDE.md` / `.cursorrules` were
  re-reconciled on 2026-08-26.
- PR #28 (supervised recovery, typed lifecycle IPC, packaged qualification,
  MSI/NSIS release qualification) is COMPLETE: merged, archived, hosted green.
  Historical evidence lives in its archived change; it is not active work.
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
- [x] 2026-08-26 deep-audit remediation pass (per root "deep review resolve.txt"):
      baseline gates re-verified green locally (cargo test 195+5, fmt, clippy -D
      warnings, cargo audit exit 0; tsc; vitest 240; build; Playwright e2e 14;
      sim mock lane 16/16). Fixed: .cursorrules schema version 4 → 5 + lifecycle
      version pointer; .cursorrules probe path bin/ → examples/. Consolidated
      duplicated code: mockBackend Nvidia-telemetry literal (×2) → nvidiaStatsFor;
      journeys recovery-probe install (×2) → installRecoveryProbe; useMetrics hook
      test beforeEach (×2) → freshIpcMock. Removed dead code: drawSessionLength +
      unused persona field sessionLengthSecs (+ fixture), shouldQuarantine (policy
      stays documented on FLAKE_BUDGET), assertChartGrowth helper. Verified IPC
      contract sync: SCHEMA_VERSION 5↔5, LIFECYCLE_SCHEMA_VERSION 1↔1. cadence.rs
      "dead code" flags confirmed false positives (used by examples/cadence_probe.rs,
      tests/cadence_hardware.rs, SYSMON_CADENCE_LOG tap).
- [x] 2026-08-26 performance campaign (repository-wide, evidence-driven):
      (1) CI rust job now installs pinned cargo-audit@0.22.1 as the official
      prebuilt release via taiki-e/install-action (SHA-pinned b6ff5808…) instead of
      `cargo install` recompiling its dependency tree every Windows run — closes
      the AUDIT_REPORT.md §cache recommendation and this file's old backlog idea.
      (2) e2e.yml + simulation.yml cache ms-playwright Chromium keyed on the
      lockfile (install step retained as cold-miss fallback). (3) UI render
      fan-out: MetricChart wrapped in React.memo with hoisted yDomain constants
      (MetricCard DEFAULT_Y_DOMAIN, renderCardContent Y_DOMAIN_AUTO) — measured on
      the Vite mock harness (7 charts, 12s window): chart-body renders 686 → 182
      (-73%), long-task main-thread time 3.57s → ~1.3s (-62%); live scalars and
      1 Hz chart growth unchanged. Guard test MetricChart.test.tsx pins the memo
      contract + commit-skipping semantics. Evaluated and declined with evidence:
      e2e.yml frontend-build step (deliberate audit-era gate, non-critical-path),
      incremental tsc (~8s clean typecheck; ≤4s saving; no CI benefit), SIM_SPEED
      CI tuning (mock lane already defaults to 8× compressed clock), backend
      micro-allocations (negligible vs PDH/WMI FFI).
- [x] 2026-08-26 sim journey fix (found by the campaign's validation runs):
      customization-roundtrip failed deterministically for seeds whose RNG rolls
      a misdrag at the reorder step (dragCard models seeded mis-drags that cancel;
      persona misdrag chance 5–10%). The journey asserted "reorder applied"
      unconditionally, so any misdraw turned into a seed-stable gate failure
      (CI uses random seeds → intermittent red). dragCard now returns
      'applied' | 'cancelled' and the journey asserts the matching postcondition
      (moved vs intentionally unchanged) while still round-tripping persistence
      from the actual resulting order. Verified: previously-failing seed
      153885314 passes both personas 9/9; full matrix re-run green.

- [x] 2026-08-26 optimization campaign round 2 (evidence-driven, measured):
      (1) Session bootstrap de-duplication: hardware::detect() re-enumerated
      the OS per call (fresh sysinfo System for the CPU brand ~2.1ms each,
      fresh Disks ~0.7ms) and ran twice per session start on top of state
      CollectorState::new() already holding both — 4 redundant System + 1
      redundant Disks enumeration per launch AND per supervisor recovery.
      New CpuIdentity::from_sysinfo/detect_with_cpu reuse held state;
      startup_probe example added (mechanism: System refresh median 2069us,
      Disks 646us; profile-discovery phase 4ms → <1ms; total bootstrap
      dominated by the REQUIRED ~200ms MINIMUM_CPU_UPDATE_INTERVAL baseline,
      honestly unchanged at ~385ms). Regression pins: CpuIdentity brand
      semantics, disk_infos_from projection (hardware.rs tests).
      (2) Release profile: lto=true → "thin" after measuring warm final-crate
      phase (the part CI re-pays per build): fat 4m45s vs thin+cu=1 3m15s
      (-32%) vs thin+cu=16 2m22s (+12% exe). Adopted thin+cu=1; full table
      documented in src-tauri/Cargo.toml. Exe 9.12MB → 9.42MB.
      (3) build_snapshot tick-path hygiene: per-250ms-tick HashMap<String,String>
      vendor cache (2 allocs/GPU name + clone/entry under the history lock)
      → zero-allocation (&str,&'static str) scan.
      Evaluated and declined: vite reportCompressedSize:false (~1s of a 46s
      build), vitest node-env split for pure tests (~1-3s of 10.75s, P3),
      cargo test 5-feature-matrix trim in verify.mjs rust gate (coverage
      tradeoff, needs CI timing data), frontend history-append copies
      (deliberate immutability design at 1Hz), get_history lock scope
      (microseconds).

## Backlog Ideas
- [x] CI efficiency: cargo-audit prebuilt install + Playwright Chromium caching
      landed 2026-08-26 (see Completed: performance campaign).
- [x] `.cursorrules` §6 now carries the simulation-platform documentation pointer
      (production-persistence-and-operational-hardening, 2026-08-26).
- [x] Real-lane sim journey for sidebar-order persistence across true relaunch:
      `sidebar-relaunch-persistence` (+ `restart-soak-durability` soak) — found and
      fixed the destructive sidebar persistence merge on real hardware.
- [ ] Dual identical-GPU runtime mapping still physically unvalidated (needs
      qualifying hardware); deterministic fixtures cover identity logic. This
      workstation's single iGPU exposes multiple PDH LUID nodes but does NOT
      qualify. Related evidenced behavior: hardware discovery can differ between
      sessions (lazy GPU Engine counters; disk source pre/post WMI) — the sidebar
      now tolerates that without losing the user's arrangement.
- [ ] Free-roam pointer-drag reorder on the real lane remains unproven and stays
      registered (keyboard drag is the certified interaction).

## Blocked
- None.
