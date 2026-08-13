## Context

The application has a single Windows collector thread, a short-lock `HistoryStore`, Tauri v2 serialized payloads, and a browser/simulation frontend that mirrors the backend state. The audit base preserves the broad architecture but mixes fixed-delay scheduling with real-time claims, derives some identity from display names or enumeration positions, and lets several harness and persistence failures degrade into false green or silent fallback behavior. The implementation must remain Windows-only for the backend, keep all hardware I/O outside the history lock, and avoid weakening the existing CSP/capability boundary.

## Goals / Non-Goals

**Goals:**

- Make cadence, history windows, rates, and missing-data rendering truthful in wall-clock terms.
- Make IPC and asynchronous frontend state fail closed and prevent stale data from winning.
- Carry stable physical identities through backend history, snapshots, dashboard/sidebar persistence, and Nvidia enrichment.
- Make the mock and packaged simulation lanes fail on invalid configuration, missing assertions, unexpected browser errors, isolation violations, and artifact corruption.
- Make local verification, CI, release builds, security checks, and documentation share one explicit contract.
- Add pure tests and deterministic fixtures for timing, identity, migration, formatting, and failure classification so Windows hardware-only behavior has a strong unit-test boundary.

**Non-Goals:**

- Replacing Tauri, React, Recharts, the in-memory history boundary, or the collector-thread ownership model.
- Guaranteeing physical multi-GPU runtime validation on machines that do not have multiple supported devices; synthetic identity fixtures remain required and the limitation is reported honestly.
- Adding a telemetry database, a large observability framework, or a broad dependency upgrade unrelated to a measured defect or security fix.
- Making every optional hardware enrichment available on every Windows configuration; unavailable enrichment is represented explicitly.

## Decisions

1. **One monotonic scheduling model.** The collector computes a monotonic next deadline from a 250 ms period. After each tick it advances to the next future deadline; if work has overrun one or more deadlines it records an overrun and rebases without replaying missed ticks. This preserves liveness and avoids catch-up bursts. A small pure deadline helper is tested independently of Windows I/O.

2. **Wall-clock cadence is checked separately from ratio cadence.** The probe starts its observation epoch at the first emitted snapshot after bootstrap, supports `--secs` as a monotonic duration and `--ticks` as an explicit diagnostic bound, and emits timing/duration/overrun metadata. The checker requires at least 60 seconds for a real-duration run, checks interval distributions and full-history intervals, and checks timestamp/history coverage in addition to the 4:1 ratio. Synthetic negative fixtures cover slow-but-perfect-ratio, jitter/burst, timestamp, and too-short runs.

3. **Timestamps are the source of time-window truth.** Backend slicing selects the suffix whose timestamps are within `window_secs` of the newest reference timestamp and applies the same index range to all aligned channels. Frontend state keeps the timestamp axis and filters by timestamp rather than slicing by sample count. Missing device values remain `null`/gaps; they are never converted to zero.

4. **Schema evolution is atomic and fail-closed.** Stable GPU keys and per-device Nvidia telemetry are added in one IPC contract revision (Rust and TypeScript versions bump together once). The frontend rejects mismatched history and live payloads before state mutation and exposes an actionable rebuild/version error. Listeners remain attached so a compatible payload can recover, while incompatible data cannot enter state.

5. **Stable identity is separate from presentation.** Backend identity uses the strongest available physical/API identifier, with deterministic namespaced fallback only when an API does not expose one. Display names are labels, never React/persistence keys. Old display-slug IDs are migrated only when mapping is unambiguous; ambiguous entries remain inert/orphaned rather than being silently reassigned. Legacy positional sidebar IDs have no physical mapping metadata, so they are dropped from the active order and current stable IDs are appended deterministically; an old position is never attached to a different device.

6. **Nvidia association is explicit.** NVML metadata is normalized into pure identity candidates (UUID, PCI bus, vendor/device metadata, display name). Telemetry is attached only on an exact or uniquely safe match. Unmapped readings become unavailable; a single-device NVAPI fallback is associated only with the explicitly identified device and is never broadcast to all Nvidia cards.

7. **Settings and simulation isolation fail closed.** Settings load is version-gated with stepwise migrations, per-field validation, and preservation of future-version files. A simulation run that expects an override cannot fall back to the normal settings path. The real driver snapshots the exact production settings state and compares `{exists, bytes}` after the run.

8. **Harness results have typed ownership.** Journey assertions, app/browser errors, driver/CDP/spawn failures, isolation violations, cleanup failures, and explicitly registered undrivable cases are distinct result classes. A passing journey requires at least one meaningful assertion, no unexpected browser errors, and successful cleanup/isolation. Triage copies artifacts and leaves canonical paths intact.

9. **Canonical verification is layered.** `verify:fast` covers typecheck/unit/build/security essentials; `verify:full` adds E2E, simulation typecheck/matrix, Rust gates, and release no-bundle build where the host supports it. CI invokes the same scripts, while hooks state honestly which layer they run. Windows-only build and hardware probe evidence is uploaded or recorded separately.

## Risks / Trade-offs

- [A stricter cadence SLO may expose real hardware/driver stalls] → report distributions and overrun counts, keep ratio diagnostics separate, and fix measured hotspots rather than widening thresholds.
- [Changing the IPC shape can strand old packaged frontends/settings] → bump the schema once, reject incompatible payloads visibly, and migrate only known persisted settings/card IDs.
- [Physical identifiers differ across Windows APIs] → centralize candidate normalization and test ambiguity; unavailable mapping is safer than guessed telemetry.
- [Timestamp filtering can temporarily return fewer points under pauses] → preserve the actual timestamp span and show gaps/status rather than fabricating density.
- [Strict harness failure policy may reveal previously hidden environmental noise] → use narrow, documented journey-scoped allowlists only for intentional errors and classify cleanup diagnostics separately.
- [Production bundle CI increases Windows runner cost] → cache toolchains and make installer generation an automatic scheduled/release policy while keeping the no-bundle executable gate on PRs.

## Migration Plan

1. Add and validate the umbrella specs/evidence, then repair harness trust and baseline E2E determinism.
2. Land timing/rate/window fixes with pure regression fixtures; record a corrected real-hardware probe when available.
3. Land the single IPC/settings migration and update Rust, TypeScript, mocks, UI, and persistence adapters atomically.
4. Land identity/Nvidia/profile behavior and frontend accessibility/error improvements.
5. Align scripts/workflows/docs, run the full verification matrix, and perform adversarial review.
6. Rollback is a branch/commit revert before merge. After release, an incompatible schema is handled by the visible fail-closed error; future settings versions are preserved rather than downgraded.

## Open Questions

- The exact Nvidia PCI identity fields exposed by the current NVML/NVAPI crate versions must be confirmed during implementation on the available Windows toolchain.
- Installer generation may require a hosted Windows runner policy decision; the PR must distinguish a configured automatic gate from hardware/runner evidence that was unavailable locally.
- Hardware-profile hotplug event cadence should follow the backend's stable-set/prune debounce; implementation tests will establish the least noisy behavior that keeps the sidebar truthful.
