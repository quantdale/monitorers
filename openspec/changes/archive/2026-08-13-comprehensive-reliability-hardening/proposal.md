## Why

The monitor currently has correctness gaps that can make time-series data, hardware identity, and failure states look plausible while being wrong. The audited base also has a red E2E workflow (8 passing tests and a failed pointer-drag reorder test) and a failing Rust workflow, so local “green” claims are not a trustworthy release signal. This change establishes a single, evidence-backed remediation program for collector timing, IPC/state contracts, hardware identity, simulation trust, and CI/release verification.

## What Changes

- Repair the audited E2E failure and make local verification commands match the meaningful CI gates.
- Harden the simulation and reporting harness: validated configuration, speed semantics, empty hardware, state isolation, assertion/page-error policy, cleanup/error preservation, driver lifecycle, fresh run directories, triage-copy integrity, and structured failure reporting.
- Replace fixed post-work collector sleeps with monotonic deadline scheduling and make cadence checks enforce wall-clock timing, history coverage, and overrun behavior.
- Make history windows and network rates timestamp/elapsed-time based, with regression fixtures for jitter, pauses, counter resets, and slow cadence.
- Evolve the IPC contract once for stable hardware keys and per-device GPU telemetry; reject incompatible payloads visibly and safely.
- Prevent stale asynchronous history loads from overwriting newer settings/live state, and implement real settings-version migration with fail-safe simulation overrides.
- Preserve missing hardware history as chart gaps, make statistics/formatters finite-safe, and keep dashboard/sidebar identity stable across reorder, hotplug, and restart.
- Associate Nvidia telemetry by physical device identity, degrade safely when mapping or WMI/NVML enrichment is unavailable, and specify hardware-profile update behavior.
- Improve loading/error states, accessibility semantics/focus behavior, reduced-motion handling, and unsupported disk-temperature presentation.
- Add production Tauri build/packaging gates, security/toolchain/action reproducibility controls, truthful root scripts/hooks/docs, and repository hygiene rules.

## Capabilities

### New Capabilities

- `collector-time-fidelity`: Wall-clock scheduling, bounded overrun behavior, timestamp-based windows, elapsed-time rates, and verifiable cadence SLOs.
- `stable-hardware-identity`: Stable dashboard/sidebar/history identity and per-device Nvidia telemetry association across enumeration and hotplug changes.
- `simulation-trust`: Fail-closed simulation configuration, isolation, assertions, diagnostics, artifacts, and reproducibility semantics.

### Modified Capabilities

- `metrics-history-streaming`: Strengthen cadence, timestamp-window, missing-data, and schema-contract requirements.
- `frontend-data-load-resilience`: Strengthen schema rejection, stale-response protection, settings migration, and recoverable error behavior.
- `autonomous-e2e-verification`: Make E2E assertions semantic and ensure the audited drag-reorder scenario is reliable without weakening its signal.
- `realistic-usage-testing`: Replace known-defect characterization with stable identity and trustworthy persistence/harness behavior.
- `user-simulation-platform`: Enforce meaningful assertions, unexpected-error failure, strict isolation, validated selectors, and artifact integrity.
- `accessible-ui-feedback`: Add accessible names, state relationships, focus return, and nonblank loading/error states.
- `keyboard-accessible-drag-reorder`: Apply consistent visible focus and stable sidebar hardware identities.
- `ci-pipeline-efficiency-and-coverage`: Require canonical verification and production Tauri build/security gates with reproducible workflow configuration.
- `dependency-vulnerability-audit`: Align current audit/toolchain policy with enforced CI and documented remediation evidence.
- `project-documentation-accuracy`: Remove drift in cadence, simulation, build, settings, and CI documentation.

## Impact

The change affects Rust collector scheduling, cadence/probe diagnostics, history storage/slicing, network and GPU providers, hardware-profile and snapshot serde payloads, React hooks/components/chart utilities, settings persistence, simulation drivers/runner/reporting, package scripts, GitHub Actions, hooks, docs, and OpenSpec specs. The IPC schema and persisted settings schema require explicit migrations; all changes remain within the existing Windows-only Tauri v2 architecture and preserve the collector-thread/short-history-lock boundary.
