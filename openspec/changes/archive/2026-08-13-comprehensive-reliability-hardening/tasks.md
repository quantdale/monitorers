## 1. Baseline, harness trust, and canonical gates

- [x] 1.1 Record the audit-base SHA, dirty paths, hosted E2E/Rust failure logs, downloaded artifacts, and all unmodified-source baseline command results in `evidence.md`.
- [x] 1.2 Make the audited pointer-drag E2E deterministic with a semantic reorder completion signal and a regression test that preserves card-set/order assertions.
- [x] 1.3 Add pure simulation configuration parsing/validation for lane, speed, seed, journey/persona selectors, quarantine counts, and zero-result behavior; align speed documentation/defaults.
- [x] 1.4 Fix mock speed semantics, timer clamping, explicit empty GPU/disk arrays, and per-instance scenario cloning; add fake-timer and two-instance isolation tests.
- [x] 1.5 Enforce meaningful assertions, unexpected page/console error failure, assertion-failure screenshots, guarded cleanup, typed failure classification, and primary-cause preservation in the simulation runner.
- [x] 1.6 Harden `MockHarnessDriver` handoff verification and `RealAppDriver` fallback navigation, bridge/root validation, spawn/early-exit lifecycle, stderr ownership, fresh owned run directories, and strict `{exists, bytes}` settings isolation tests.
- [x] 1.7 Make triage bundles copy rather than rename canonical artifacts; add HTML/JUnit escaping tests including `]]>`, and preserve stable result paths.
- [x] 1.8 Add harness adversarial tests proving synthetic pageerror, zero assertions, nonexistent selector, cleanup throw, process exit, stale directory, and settings mutation all fail.
- [x] 1.9 Add root delegated scripts and canonical `verify:fast`/`verify:full` commands; make pre-push truthful and include the intended audit/E2E/simulation/build layers.

## 2. Collector time fidelity

- [x] 2.1 Isolate and unit-test monotonic deadline arithmetic with injectable time; replace fixed post-work sleep with no-catch-up deadline scheduling, overrun accounting, and responsive stop behavior.
- [x] 2.2 Add poll/provider duration and history-lock diagnostic measurements without moving `CollectorState` behind a mutex or holding `HistoryStore` during I/O.
- [x] 2.3 Redesign cadence probe/checker around first-emission epoch, real `--secs`, explicit `--ticks`, minimum 60-second observation, interval distributions, history/timestamp/GPU checks, elapsed coverage, off-tick invariants, and overrun detection.
- [x] 2.4 Add negative cadence fixtures for 750 ms perfect-ratio, jitter/burst, too-short, timestamp-growth, and catch-up runs; update docs and ignored real-hardware test.
- [x] 2.5 Implement timestamp-based backend/frontend history windows with aligned channel slicing and irregular-timestamp tests.
- [x] 2.6 Normalize network deltas by monotonic elapsed seconds, handle first/reset/interface/long-pause cases, and add equivalent-rate tests plus aligned labels/mock data.

## 3. IPC and frontend state consistency

- [x] 3.1 Design and apply one IPC schema revision for stable GPU keys and per-device Nvidia telemetry; update Rust serde payloads, TypeScript mirrors, mocks, fixtures, and schema constants atomically.
- [x] 3.2 Make history and live schema mismatch handling fail closed with actionable UI error and no state mutation; add direct history/live mismatch tests and mock journey coverage.
- [x] 3.3 Add request generations/cancellation and live-event reconciliation for history refetches; cover out-of-order deferred requests, newer live points, and mismatch paths.
- [x] 3.4 Preserve missing dynamic-device values as null/gaps through merge, chart points, secondary series, Recharts rendering, and hotplug E2E/sim fixtures; prove zero remains zero.
- [x] 3.5 Make `historyMinMax` and all numeric formatters finite-safe with explicit empty/clamp/sign policy; remove unsupported disk-temperature badge or implement a reliable per-disk source.
- [x] 3.6 Implement real settings schema load/migration/version gate for legacy/current/future/corrupt data, atomic current-version saves, warnings, and rapid/concurrent save regression tests.
- [x] 3.7 Make simulation store override resolution fail closed while preserving normal production no-override behavior; test command failure, invalid/unwritable path, and no fallback.
- [x] 3.8 Fix delayed settings/metrics card-order initialization semantics and add tests for metrics-first/settings-later and existing persisted order.

## 4. Stable hardware identity and Nvidia

- [x] 4.1 Carry stable disk/GPU keys through hardware profile, histories, snapshots, React/DnD IDs, persisted dashboard/sidebar order, and restart/hotplug migration helpers.
- [x] 4.2 Replace display-slug/positional identity with deterministic legacy migration; test identical names, slug collisions, reorder, remove/reappear, same-model devices, and ambiguous mappings.
- [x] 4.3 Normalize NVML/NVAPI metadata and reconcile per-device telemetry only on exact/unique identity; test distinct two-GPU readings and unmapped-unavailable behavior.
- [x] 4.4 Preserve explicit NVAPI fallback association semantics and ensure no global/first-device telemetry broadcast remains in Rust snapshots or frontend rendering.
- [x] 4.5 Correct GPU kind classification to use reliable hardware signals or Unknown rather than vendor heuristics; add Intel Arc/integrated, AMD APU/discrete, Nvidia, and unknown fixtures.
- [x] 4.6 Degrade GPU profile detection when WMI is unavailable, keep PDH devices visible, and add injectable bootstrap/profile tests.
- [x] 4.7 Decide and implement debounced live hardware-profile updates (or explicitly label startup snapshot), including sidebar convergence tests and recoverable profile load/refetch errors.

## 5. UI, accessibility, and resilience

- [x] 5.1 Add accessible name/state relationships for time range, sidebar toggle, selectors, view-mode group, status/error live regions, Escape focus return, and retry semantics.
- [x] 5.2 Unify dashboard/sidebar drag handles with visible focus treatment, labels, decorative SVG semantics, and keyboard reorder tests.
- [x] 5.3 Replace blank settings loading and detecting-forever profile states with accessible loading/error/retry UI while preserving last-known-good data on transient refetch failures.
- [x] 5.4 Add reduced-motion CSS/inline behavior and ensure live charts remain non-animated; add focused component/accessibility assertions.
- [x] 5.5 Make chart downsampling output `<= maxPoints`, test nonpositive budgets/property cases, benchmark 3600 points, and adopt bounded extrema-preserving sampling only if it preserves spikes at acceptable cost.

## 6. Lifecycle, performance, and backend resilience

- [x] 6.1 Refactor WMI bootstrap so core metrics/liveness start promptly while WMI remains on the collector MTA thread and reports degraded capability.
- [x] 6.2 Wire graceful stop to Tauri lifecycle with bounded join/stop behavior, or remove misleading machinery if an invariant cannot be guaranteed; add lifecycle tests.
- [x] 6.3 Replace silent event emit `.ok()` handling with rate-limited diagnostic logging that distinguishes expected shutdown from operational delivery failure.
- [x] 6.4 Centralize and test CPU temperature cache TTL; instrument NVML/provider durations before deciding on slower enrichment/re-init backoff.
- [x] 6.5 Run frontend render/downsampling and simulation-duration measurements, record evidence, and optimize only demonstrated hotspots.

## 7. CI, supply chain, release, and hygiene

- [x] 7.1 Add Windows PR/push production Tauri no-bundle build and automatic installer policy; verify shipped config has no remote-debug flags and upload useful artifacts.
- [x] 7.2 Remediate fixable npm advisories and review current Cargo advisories without unjustified sweeping upgrades; document unavoidable platform warnings and run both root/app audits.
- [x] 7.3 Pin/document Rust toolchain and cargo-audit strategy; update GitHub actions/runtime versions, permissions, concurrency, caching, and dependency-update policy.
- [x] 7.4 Make simulation workflow PR behavior/comments match blocking policy and fail zero-result matrices; keep real packaged lane explicit/manual where hardware limits apply.
- [x] 7.5 Remove tracked ephemeral OpenCode loop/session state, add precise ignore rules, and scan for secrets, absolute personal paths, generated artifacts, debug flags, and unsafe blocks lacking SAFETY rationale.
- [x] 7.6 Add version consistency validation for package/Cargo/Tauri metadata and document the release update procedure.

## 8. Specs, final validation, and delivery

- [x] 8.1 Update main OpenSpec specs by syncing the completed deltas; validate all active change artifacts with strict repository commands.
- [x] 8.2 Sweep AGENTS/CLAUDE/CONTEXT/.cursorrules/README/workflow comments/hooks for cadence, schema, settings, simulation, build, test-count, and CI drift.
- [x] 8.3 Run the complete clean-state frontend, Rust feature-matrix, security, E2E, mock-simulation, packaged-build, and config-lint validation; record exact results in evidence.
- [x] 8.4 Run corrected cadence probe/checker for at least 60–90 seconds on available Windows hardware; record machine-readable and summary evidence, including multi-GPU validation limits.
- [x] 8.5 Perform adversarial whole-diff review for timing lies, gaps/zeros, stale async state, schema mutation, identity collapse, failure injection, lifecycle, security, and artifact ownership; fix every finding.
- [x] 8.6 Make small coherent commits by phase, push the dedicated branch, open a draft PR, inspect all hosted checks, and keep the PR description explicit about baseline, evidence, limitations, and remaining blockers.
