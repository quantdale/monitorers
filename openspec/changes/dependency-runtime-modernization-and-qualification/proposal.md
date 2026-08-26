# Dependency Runtime Modernization and Qualification

## Why

The repository finished its production recovery, packaged qualification, persistence, CI-efficiency and repository-truth campaigns on 2026-08-26. Current runtime behavior is well defended, but the dependency queue is no longer routine maintenance:

1. **Rust runtime upgrades cross correctness boundaries.** Dependabot PR #27 combines `sysinfo`, `wmi`, `windows`, `nvml-wrapper`, Tauri build/store and serialization changes. The target `sysinfo 0.39.x` line requires a newer Rust toolchain than the repository's pinned `1.93.1`, while WMI's current construction/COM model differs from the code's `COMLibrary` path.
2. **Frontend majors are over-coupled.** The frontend tooling PR combines Vite 8, plugin-react 6, TypeScript 7, jsdom 30, Node types and Tauri CLI; React 19/React DOM 19 are separate open migrations. Several generated PRs are already non-mergeable.
3. **Dependabot grouping creates avoidable blast radius.** All Cargo packages are grouped together and all frontend dev dependencies are grouped together, so unrelated major/API migrations arrive as one opaque unit.
4. **The app has strong qualification infrastructure that should be used.** The Rust feature matrix, Playwright/mock simulation, packaged CDP real-app lane, cadence probes, restart/settings journeys, Windows build and MSI/NSIS qualification make a controlled modernization possible without reducing safety.

## What Changes

- **Dependency-policy decomposition:** redesign `.github/dependabot.yml` so major/API-changing upgrades are split into reviewable compatibility domains instead of broad “all Rust” / “all frontend tooling” groups. Keep GitHub Actions SHA-pinning and security/audit policies intact.
- **Rust/toolchain migration:** deliberately choose and document the supported Rust floor, then migrate the collector-facing libraries (`sysinfo`, `wmi`, `windows`, `nvml-wrapper` and compatible supporting crates) while preserving startup, cadence, device identity, WMI degradation/retry and Nvidia telemetry association semantics.
- **Tauri/store alignment:** align Rust Tauri/build/plugin-store and JS Tauri API/plugin-store/CLI versions as a tested cross-language boundary. Preserve typed managed state, commands/events, settings v2 migration/save serialization, simulation-store isolation and true-relaunch persistence.
- **React 19 migration:** move React, React DOM and matching type packages together; qualify StrictMode/effect cleanup, async Tauri listeners, dnd-kit interactions, Recharts rendering, settings context and recovery UI behavior.
- **Frontend tooling migration:** stage Vite/plugin-react/TypeScript/jsdom/Node types according to actual peer/runtime constraints; update configuration only when required by documented migrations.
- **Remaining library updates:** take Recharts/Lucide and other low-risk dependency updates only after the runtime/framework floor is stable and only when existing behavior remains qualified.
- **Compatibility qualification:** run the canonical Rust/frontend/E2E/simulation gates, packaged-app real lane, targeted cadence/startup/identity checks, and hosted Windows/release qualification where available. Re-audit changed surfaces and fix introduced Critical/High/P1/P2 defects with regression coverage.
- **Queue reconciliation:** document the final disposition of the currently open dependency PRs and leave `progress.md`, OpenSpec and agent instructions in one truthful state.

## Behavioral Contracts That Must Not Regress

- 250 ms monotonic live cadence, 4:1 live/full-poll split and approximately 1 Hz history commits;
- no catch-up burst after slow work and no fabricated startup/recovery rate samples;
- schema 5 metrics IPC and lifecycle schema 1 unless an intentional serialized-contract change justifies a migration;
- stable per-device disk/GPU keys and fail-closed telemetry association for ambiguous identical GPUs;
- WMI is optional enrichment: its failure must not hide core metrics or block the first snapshot;
- collector panic recovery, retry budget, manual retry and typed StopFlag/RetryRequest separation;
- settings schema 2, serialized writes, future-version fail-closed behavior and simulation store isolation;
- real packaged-app restart persistence and orphan-process cleanup;
- existing accessibility/keyboard-drag behavior and deterministic simulation semantics;
- mandatory `cargo audit` / npm audit and immutable GitHub Action pins.

## Non-Goals

- No UI redesign or new product feature.
- No unrelated architecture rewrite or broad refactor disguised as a dependency migration.
- No gate weakening, test deletion, assertion relaxation or audit suppression to force compatibility.
- No cross-platform expansion.
- No fabricated physical dual-GPU, physical hotplug, lid or power-event validation.
- No code-signing certificate/secret provisioning; installers may remain unsigned until separately provisioned.
- No requirement to adopt a newest version that cannot be safely qualified. A documented deferral is preferable to an unsafe upgrade.

## Success Criteria

A successful change leaves the repository on an intentionally supported Rust/Node/dependency stack, with the critical collector/Tauri/frontend behavior proven through the strongest existing lanes, safer future Dependabot grouping, no introduced high-priority defects, strict OpenSpec validation green, and every dependency PR in the planning queue accounted for.
