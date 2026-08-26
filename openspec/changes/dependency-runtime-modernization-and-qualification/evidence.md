# Evidence — Dependency Runtime Modernization and Qualification

## Planner baseline (2026-08-26)

This file is intentionally initialized by the planning audit and MUST be extended by the executor with actual migration and qualification evidence. Planner observations are not substitutes for execution-time results.

### Planning anchor

- Repository: `quantdale/monitorers`
- Planned from: `main@46ee499ab934663c4e0807f7ab8e995707b77471`
- Base tree: `b5d832631015f301fefdb0bdbd9bb843f1591273`
- Base commit is the merge of PR #29 (production persistence/restart durability/CI efficiency/repository-truth convergence).
- Current Rust toolchain declaration at planning time: `1.93.1`.
- Current app package: `sys-monitor-tauri` version `0.1.4`.
- Metrics IPC schema at planning time: 5.
- Collector lifecycle schema at planning time: 1.
- Settings schema at planning time: 2.

### Live dependency queue observed by planner

At planning time the open queue included these relevant generated changes. The executor MUST refresh this table because Dependabot may rebase/recreate PRs after this commit.

| PR | Domain | Planning-time update | Planning disposition |
|---|---|---|---|
| #20 | frontend tooling | Tauri CLI 2.10.1→2.11.4; Node types 24→26; plugin-react 4→6; jsdom 25→30; TypeScript 5.9→7.0; Vite 6.4→8.2 | Supersede/decompose; do not merge wholesale |
| #21 | charts | Recharts 3.8→3.10.x | Evaluate after React/tooling |
| #22 | Tauri JS | `@tauri-apps/api` 2.10.1→2.11.x | Fold into coherent Tauri boundary |
| #23 | React | React 18.3.x→19.2.x + types | Migrate coherently with React DOM |
| #24 | React DOM | React DOM 18.3.x→19.2.x + types | Migrate coherently with React |
| #25 | UI icons | Lucide React 0.460→1.x | Evaluate after framework/tooling |
| #26 | Tauri store JS | plugin-store 2.4.2→2.4.4 | Fold into coherent Tauri boundary |
| #27 | Rust grouped | store/serde/json/sysinfo/wmi/chrono/nvml/windows/tauri-build | Supersede/decompose; do not merge wholesale |

### Compatibility observations requiring execution-time confirmation

- `sysinfo 0.39.x` upstream currently documents **Rust 1.95** as its minimum-supported compiler, higher than the repository's planning-time Rust 1.93.1 pin.
- WMI 0.18.4 documentation presents `WMIConnection::new()` as the normal connection constructor and documents connection-managed COM initialization. Current repo code uses `COMLibrary::new().and_then(WMIConnection::new)`; source adaptation is therefore expected.
- Vite 8 upstream documents Node `20.19+` or `22.12+`; Node 24 satisfies that runtime floor, so there is no planning-time reason to change the repo's Node 24 CI baseline solely for Vite.
- These observations are version-sensitive. The executor MUST save exact upstream release/migration references for the versions actually selected.

## Execution evidence template

### A. Actual execution baseline

- Branch:
- Start SHA:
- `origin/main` SHA at branch creation:
- Rust version:
- Node/npm versions:
- Baseline `verify:full`:
- Baseline `verify:packaged`:
- Baseline cadence/startup/identity probes:
- Baseline OpenSpec validation:

### B. Final version matrix

| Component | Before | Target evaluated | Final | Decision/evidence |
|---|---:|---:|---:|---|
| Rust toolchain | 1.93.1 | | | |
| sysinfo | 0.33.x | | | |
| wmi | 0.13.x | | | |
| windows-rs | 0.61.x | | | |
| nvml-wrapper | 0.10.x | | | |
| Tauri Rust/build | 2.x | | | |
| Tauri JS API/store/CLI | 2.x | | | |
| React / React DOM | 18.3.x | 19.2.x | | |
| Vite / plugin-react | 6.x / 4.x | 8.x / 6.x | | |
| TypeScript | 5.9.x | 7.x | | |
| jsdom | 25.x | 30.x | | |
| Recharts | 3.8.x | | | |
| Lucide React | 0.460.x | | | |

### C. Upstream migration references

For every major/API-changing package, record exact release/migration URLs, breaking changes, MSRV/engine/peer constraints, and how each applies to repository code.

### D. Stage validation

Record command, SHA, environment, result, duration and noteworthy warnings after each compatibility domain:

1. Dependabot policy
2. toolchain/sysinfo
3. WMI
4. windows-rs/PDH
5. NVML/NVAPI
6. Tauri/store
7. React 19
8. Vite/TypeScript/jsdom
9. remaining UI/data libraries

### E. Final local qualification

- `npm run verify:full`:
- `npm run verify:packaged`:
- mock simulation:
- packaged real journeys:
- cadence checker:
- startup probe:
- hardware identity comparison:
- `cargo audit`:
- npm audit(s):
- `git diff --check`:
- OpenSpec strict validation:

### F. Hosted qualification

| Workflow | Run ID | SHA | Result | Artifact/evidence |
|---|---|---|---|---|
| Rust/frontend/release | | | | |
| E2E | | | | |
| Mock simulation | | | | |
| Packaged real simulation | | | | |
| MSI/NSIS qualification | | | | |

### G. Defects found during migration

For each defect: priority/severity, root cause, dependency stage that exposed it, fix commit, regression test, and final verification.

### H. Dependabot PR disposition

Refresh the live queue and record every PR as merged, superseded/closed, recreated, deferred or still blocked. No generated dependency PR should remain unexplained at campaign completion.

### I. Limitations

Preserve truthful external limits, including physical identical-GPU/hotplug/power validation and unsigned installers unless separately provisioned. Do not claim fixture/mock evidence as physical-hardware evidence.
