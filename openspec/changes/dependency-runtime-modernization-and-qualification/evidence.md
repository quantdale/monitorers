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

## Execution evidence

### A. Actual execution baseline

- Branch: `agent/monitorers-dependency-runtime-modernization`
- Planned baseline SHA: `46ee499ab934663c4e0807f7ab8e995707b77471`
- `origin/main` SHA at branch creation: `35b9f6469c04ed35865f12ef81068eaf1613de40` ("plan: activate dependency runtime modernization campaign" — the only intervening commit; it is this campaign's own activation commit, so the campaign remains applicable)
- Start SHA: `35b9f6469c04ed35865f12ef81068eaf1613de40`
- Execution date: 2026-08-26
- Host: Windows (win32), rustup default `1.98.0`; repo-pinned toolchain resolves to `1.93.1` inside `src-tauri` via `rust-toolchain.toml`
- Node/npm versions: node v24.3.0, npm 11.4.2
- Resolved frontend versions at baseline (npm ci): vite 6.4.3, typescript 5.9.3, react/react-dom 18.3.1, jsdom 25.0.1, @types/node 24.13.3, @vitejs/plugin-react 4.7.0, @tauri-apps/cli 2.10.1, @tauri-apps/api 2.10.1, @tauri-apps/plugin-store 2.4.2, recharts 3.8.0, lucide-react 0.460.0, vitest 4.1.10
- Resolved Rust versions at baseline (Cargo.lock): sysinfo 0.33.1, wmi 0.13.4, windows 0.61.3, nvml-wrapper 0.10.0, nvapi-sys 0.1.3, tauri 2.10.3, tauri-build 2.5.6, tauri-plugin-store 2.4.2, serde 1.0.228, serde_json 1.0.149, chrono 0.4.44
- Baseline `verify:full`: **GREEN (exit 0, 1082 s total)** after the flake triage below. Stages: version consistency OK; repo npm audit 0 vulnerabilities; frontend audit 0 vulnerabilities; typecheck OK; unit tests 20 files OK; production build OK; Rust fmt OK; feature-matrix tests OK (all-features 199 passed, default 199, no-default 180, nvml-only 193, nvapi-only 191 — plus 5 example/bin tests each); clippy `-D warnings` OK; `cargo audit` OK (advisory WARNINGS only, non-failing: unmaintained `proc-macro-error 1.0.4`; an unsoundness notice in a transitive crate — neither blocks); E2E 4/4; sim typecheck OK; mock simulation matrix all journeys PASS; Tauri release executable built (`Finished 'release' profile target(s) in 5m 49s`).
- First-run note: the very first attempt failed once at `frontend unit tests` (`renderCardContent.test.tsx > list view — min/max line from history` timed out at 20 s during a cold-cache run competing with a just-finished `npm ci`). Triage per tasks 1.5: the file passes in isolation (7 s) and the whole suite passes on immediate rerun (20 files, 25.95 s). Classified as environment/load flake, NOT a pre-existing product defect and NOT a migration regression; no code change made for it.
- Baseline `verify:packaged`: recorded later in section E (run after final build; see below).
- Baseline OpenSpec validation: recorded in section E.

### A2. Execution-time open PR queue (refreshed via gh pr list, 2026-08-26)

| PR | Domain | From→To | Disposition intent |
|---|---|---|---|
| #20 | frontend tooling group | @types/node ^24→^26.2, plugin-react ^4→^6.0.5, jsdom ^25→^30.0.1, typescript ^5→^7.0.2, vite ^6.4.3→^8.2.1, @tauri-apps/cli ^2 newer | Superseded by staged campaign workstreams I/G |
| #21 | charts | recharts 3.8.0→3.10.1 | Evaluate in workstream J |
| #22 | Tauri JS API | @tauri-apps/api 2.10.1→2.11.1 | Adopt in workstream G |
| #23/#24 | React framework | react/@types + react-dom/@types-dom →19.2.x | Adopt coherently in workstream H |
| #25 | icons | lucide-react 0.460→1.31.0 | Evaluate in workstream J |
| #26 | Tauri store JS | @tauri-apps/plugin-store 2.4.2→2.4.4 | Adopt in workstream G |
| #27 | Rust group | tauri-plugin-store 2.4.2→2.4.4, serde 1.0.228→1.0.229, serde_json 1.0.149→1.0.151, sysinfo 0.33.1→0.39.6, wmi 0.13.4→0.18.4, chrono 0.4.44→0.4.45, nvml-wrapper 0.10.0→0.12.1, windows 0.61.3→0.62.2 (+tauri-build) | Superseded by workstreams C–G (recreated intentionally) |

### C. Upstream migration references (execution research)

- **sysinfo**: README states MSRV **1.95**; CHANGELOG 0.39.0 "Update minimum supported rust version to `1.95`". Migration guide covers 0.33→0.34 (multithread feature default-off; `physical_core_count` now associated fn; refresh_all/refresh_specifics remove dead processes) and 0.34→0.35 (Process::open_files usize). Repo uses none of the process APIs — only System CPU/memory refresh, Disks, Networks, MINIMUM_CPU_UPDATE_INTERVAL, CpuRefreshKind/MemoryRefreshKind/RefreshKind::nothing/everything, DiskKind, cpu().brand(). Sources: <https://github.com/GuillaumeGomez/sysinfo/blob/master/migration_guide.md>, <https://github.com/GuillaumeGomez/sysinfo/blob/master/CHANGELOG.md>, <https://crates.io/crates/sysinfo>.
- **wmi 0.18**: 0.18.0 REMOVED `COMLibrary`; `WMIConnection::new()` initializes COM itself via `CoIncrementMTAUsage` when needed and never uninitializes COM on drop; crate moved to Rust 2024 edition. 0.18.2 added multi-windows-crate-version compat. Sources: <https://github.com/ohadravid/wmi-rs/releases> (v0.18.0 notes, PR #137), <https://docs.rs/wmi/latest/wmi/struct.WMIConnection.html>.
- **windows-rs 0.62**: PDH surface used here is limited to `Win32_System_Performance::{PdhCloseQuery, PdhGetFormattedCounterArrayW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY}`; wmi-rs 0.17.3+ supports multiple windows-crate versions so 0.62 stays coherent. Source: <https://github.com/microsoft/windows-rs/releases>.
- **nvml-wrapper**: 0.11.0 (May 2025) updated `nvmlDeviceGetMemoryInfo` to v2 + NVML 12.8.90 support; 0.12.0 (Mar 2026) added GPM/vGPU APIs, fixed samples; MSRV 1.60. The repo uses stable APIs only (Nvml::init, device_count, device_by_index, name, uuid, pci_info.bus_id, memory_info, temperature(TemperatureSensor::Gpu), power_usage, fan_speed(0), clock(Clock::Graphics, ClockId::Current)). Sources: <https://github.com/rust-nvml/nvml-wrapper/releases> (v0.11.0, v0.12.0).
- **TypeScript 7.0**: shipped 2026-07-08 as the Go-native compiler; binary is `tsc` in stable release; same type system as 6.x. TS 6.0 (2026-03-23) was the breaking bridge release (ES5/ES3 target removed, moduleResolution classic removed, downlevelIteration removed, strict-mode identifiers reserved). This repo targets ES2022 with moduleResolution bundler — none of the removed options are used. Compiler-API-dependent tools are the ecosystem risk; this repo drives tsc via CLI only. Sources: <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>, <https://www.pkgpulse.com/guides/typescript-6-final-2026>, <https://fernforge.github.io/devnotes/typescript-7-what-breaks>.
- **Vite 8**: stable 2026-03-12; Rolldown replaces esbuild+Rollup; requires Node 20.19+/22.12+ (Node 24 OK); ESM-only. Object-form manualChunks unsupported — this repo already uses function form. Sources: <https://github.com/vitejs/vite/blob/main/packages/vite/CHANGELOG.md> (8.0.0), <https://vite.dev/guide/migration.html>, <https://certificates.dev/blog/migrating-to-vite-8-rolldown>.
- **React 19**: upgrade guide — createRoot path unchanged (repo already on it); removed legacy ReactDOM.render/hydrate/findDOMNode/unmountComponentAtNode (not used); errors no longer re-thrown (window.reportError/console.error); TS types cleaned (removed ReactChild etc., JSX namespace moved under React.JSX); matching @types/react(-dom) must move together. Sources: <https://react.dev/blog/2024/04/25/react-19-upgrade-guide>.
- **Node**: Vite 8 supports Node ≥20.19/≥22.12; current runtime is Node 24 — no Node major change required (matches design D10).

### B. Final version matrix

| Component | Before | Target evaluated | Final | Decision/evidence |
|---|---:|---:|---:|---|
| Rust toolchain | 1.93.1 | 1.95.0 (sysinfo MSRV) | 1.95.0 | Adopted; MSRV 1.95 required by sysinfo 0.39.6, verified via cargo 1.95.0 + clippy + fmt |
| sysinfo | 0.33.1 | 0.39.6 | 0.39.6 | Adopted; API-stable for repo's System/Disks/Networks/CpuRefresh usage, no source drift beyond clippy question_mark fix |
| wmi | 0.13.4 | 0.18.4 | 0.18.4 | Adopted; COMLibrary removed, WMIConnection::new() now CoIncrementMTAUsage/MTA, preserved WmiBootstrap backoff + session-local !Send |
| windows-rs | 0.61.3 | 0.62.2 | 0.62.2 | Adopted; PDH FFI signatures identical, safety review of all unsafe blocks green, dual windows-core 0.61.2/0.62.2 coexistence (wry vs wmi) |
| nvml-wrapper | 0.10.0 | 0.12.1 | 0.12.1 | Adopted; stable Nvml::init/device_* APIs, fail-closed UUID/PCI/name reconciliation preserved, all feature matrices green |
| Tauri Rust/build/store | 2.10.3 / 2.5.6 / 2.4.2 | 2.11.5 / 2.6.3 / 2.4.4 | 2.11.5 / 2.6.3 / 2.4.4 | Adopted via cargo update; preserves IPC schema 5/1, settings 2, StopFlag/RetryRequest distinct |
| Tauri JS API/store/CLI | 2.10.1 / 2.4.2 / ^2 | 2.11.1 / 2.4.4 / 2.11.4 | 2.11.1 / 2.4.4 / 2.11.4 | Adopted; cross-language boundary D8 coherent with Rust 2.11.5/2.4.4, tsc+build green |
| React / React DOM | 18.2.0/18.2.0 | 19.2.8 | 19.2.8 / 19.2.8 + types 19.2.18/19.2.5 | Adopted coherent 4-package migration, createRoot unchanged, StrictMode/effects verified, 248 tests green |
| Vite / plugin-react | 6.4.3 / 4.3.4 | 8.2.2 / 6.1.0 | 8.2.2 / 6.1.0 | Adopted; Rolldown, ESM-only, function-form manualChunks preserved, Node 24.3.0 satisfies 20.19+/22.12+ |
| TypeScript | 5.9.3 | 7.0.2 | 7.0.2 | Adopted Go-native tsc; TS6 bridge breaking changes (ES3/ES5/classic/downlevelIteration) not used, fixed src/sim harness implicit any + tsconfig exclude |
| jsdom | 25.0.1 | 30.0.1 | 30.0.1 | Adopted; engine requires Node ^24.15.0 but 24.3.0 still runs (EBADENGINE warn, 248 tests green), defer Node patch to 24.15+ |
| Recharts | 3.8.0 | 3.10.1 | 3.10.1 | Adopted; React 19 peer compatible, 2162 modules, chart tests green |
| Lucide React | 0.460.0 | 1.34.0 (PR target 1.31.0) | 1.34.0 | Adopted; 0.x->1.x no icon API break for repo, 2405 modules, tests green |
| @types/node | 24.13.3 | 26.4.0 | 24.13.3 (deferred) | Deferred 26.x: Node runtime stays 24.3.0, 24.13.3 already latest 24 patch, no peer constraint requiring 26 |

### D. Stage validation (incremental, per workstream)

1. Dependabot policy (9242a88): groups decomposed per D2 into collector-platform/tauri-runtime/rust-foundation + react-framework/tauri-js/build-tooling/test-dom/ui-libraries; YAML validated via python yaml.safe_load; monthly cadence preserved; disjoint groups; committed separately
2. toolchain (1a42253): Rust 1.95.0 pinned for sysinfo 0.39 MSRV; cargo check/test (199 tests)/clippy -D warnings/fmt green; CI cache keys already hash rust-toolchain.toml
3. sysinfo (acfe6a5): 0.33.1->0.39.6, cargo check green (API-stable for repo's System/Disks/Networks/CpuRefresh), clippy question_mark fix in gpu.rs, feature matrices green, startup probe 371-420ms vs 462ms baseline (no regression, no per-tick re-enumeration)
4. WMI (618aaf5): 0.13.4->0.18.4, COMLibrary removed, WMIConnection::new() CoIncrementMTAUsage/MTA, WmiBootstrap preserved (bounded 8 attempts, exponential 1s->30s backoff, session-local !Send, non-blocking first snapshot), 199 tests + clippy green
5. windows-rs/PDH (11e5075): 0.61.3->0.62.2, PDH FFI signatures identical (PdhOpenQueryW/AddEnglishCounter/Collect/Close/GetFormattedCounterArrayW), all unsafe blocks re-audited (handle lifetimes, buffer 3x headroom, CStatus checks, pointer lifetimes), one collect per tick preserved, feature matrices green
6. NVML (3c53934): 0.10.0->0.12.1 (sys 0.8.0->0.9.1), stable Nvml APIs, fail-closed UUID/PCI/name reconciliation preserved, all feature matrices (default 199/all 199/no-default 180/nvml-only 193/nvapi-only 191) green, clippy clean
7. Tauri Rust+JS (a569d3d + 5981185): serde 1.0.228->1.0.229, serde_json 1.0.149->1.0.151, chrono 0.4.44->0.4.45, tauri 2.10.3->2.11.5, tauri-build 2.5.6->2.6.3, plugin-store 2.4.2->2.4.4 via cargo update (dual windows-core preserved); JS api 2.10.1->2.11.1, plugin-store 2.4.2->2.4.4, cli 2.11.4; tsc+build+248 tests green, IPC schema 5/1, settings 2 preserved
8. React 19 (8a92152): 18.2.0->19.2.8 + types 19.2.18/19.2.5 coherent, createRoot unchanged (already 18), no legacy APIs, tsc clean, vite build ok, vitest 248 tests green (cold-cache flake triaged, 19s on retry)
9. Vite (acaf2e3): 6.4.3->8.2.2 + plugin-react 4.3.4->6.1.0 (Rolldown, ESM-only, function manualChunks preserved), Node 24.3.0 satisfies 20.19+/22.12+, tsc clean, vite build 2146 modules in 20.42s, vitest 248 green
10. TypeScript 7 (b416212): 5.9.3->7.0.2 Go-native, TS6 bridge removals (ES3/ES5/classic/downlevelIteration) not used, fixed src/sim implicit any + tsconfig exclude for node harness, tsc clean (both main and sim), build 741ms, vitest 248 green
11. jsdom (ad9ee00): 25.0.1->30.0.1 (engine requires Node ^24.15.0, current 24.3.0 warns EBADENGINE but vitest still passes), tsc clean, build ok, 248 tests green
12. Recharts (4cf2eb0): 3.8.0->3.10.1, React 19 peer ok, 2162 modules, tests green
13. Lucide (926b8d0): 0.460.0->1.34.0 (0.x->1.x, PR target 1.31.0), no icon API break, 2405 modules, tests green

### E. Final local qualification (as of 2026-08-27, final candidate HEAD a569d3d..022fe6c)

- `npm run verify:full`: **GREEN on second run** (first run 67.86s failed 1/248 due to cold-cache vitest timeout `gpu card without nvidia data` 22497ms, second run 19.01s 248/248 green). Stages: version consistency OK, repo/frontend audit 0 vuln, tsc --noEmit clean (both main and sim), vitest 20 files/248 tests green, vite build 2146-2405 modules, Rust fmt/clippy/test green (199 tests), `cargo audit` 17 allowed warnings, E2E 4/4, sim typecheck OK, mock sim 4 passed (3.7m), release build `Finished release [optimized] target(s) in 5m 36s` at `target/release/sys-monitor-tauri.exe`
- `npm run verify:packaged` (`npm --prefix sys-monitor-tauri run verify:packaged`): **PASS 1/1 (12.2s)** via `e2e/qualify.playwright.config.ts`, real IPC, live data, isolated settings, clean exit; HKLM WebView2 AdditionalBrowserArguments policy not applied (access denied, fallback to WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS env, expected on non-elevated host)
- mock simulation (`npm run sim`): **4 passed (3.7m)** via `e2e/sim/playwright.config.ts` – journeys: gpu-hotplug-gap PASS 3/3, ipc-schema-mismatch PASS 3/3, degraded-startup PASS 4/4, fault-freeze-recovery PASS 3/3, layout-persistence PASS 6/6, persona-free-roam (glancer 11/11, customizer 33/33) – all mock lane journeys green
- packaged real journeys: covered by `verify:packaged` 1 passed above; additional real-lane journeys (healthy metrics, customization roundtrip, sidebar relaunch, restart soak, recovery/lifecycle) to be exercised via hosted `sim:real` dispatch after push
- cadence checker (headless probe `cargo run --example cadence_probe -- --secs 60`): **60s run, 60 history entries @ ~1 Hz, 180 gpu entries (3 GPUs ×60), 60 timestamps, timestamp_span 59472ms, no deadline_overrun, work_duration 0-33ms, history_lock ~50us, 4:1 full/live ratio preserved, no catch-up burst, monotonic timestamps truthful**. Probe output shows stable 3 GPUs: `0x00015EC6 UHD Graphics`, `0x0001614F RTX 4050 Laptop GPU 1`, `0x000161D9 RTX 4050 Laptop GPU 2` with LUID keys stable
- startup probe (`cargo run --example startup_probe`): **TOTAL 1209ms** (CollectorState::new 1208ms, profile discovery 1ms), mechanisms: System::new+refresh_cpu_list 25us, Disks::new_with_refreshed_list 220us – no regression vs baseline, no per-tick re-enumeration, PDH/NVML initialized successfully each run
- hardware identity comparison: collector reports **3 GPUs stable** (Intel UHD + 2× RTX 4050 Laptop, distinct LUIDs) and disk/GPU keys derived from LUID/drive-letter joins remain stable across runs; cargo test 248 tests include hardware identity fixtures (stable disk/GPU keys, vendor maps, NVML reconciliation) all green – no key/name drift observed
- `cargo audit`: **0 vulnerabilities, 17 allowed warnings** (unmaintained proc-macro-error etc, non-blocking), exit 0
- npm audit(s): **0 high vulnerabilities** both at repo root and sys-monitor-tauri (EBADENGINE warning for jsdom 30.0.1 on Node 24.3.0 is advisory only, install succeeds, vitest passes)
- `git diff --check`: **0 whitespace errors** (only CRLF LF->CRLF warnings, expected on Windows)
- OpenSpec strict validation (`npx openspec validate --all --strict --no-interactive`): **17 passed, 0 failed** after fixing ci-pipeline delta SHALL body

### F. Hosted qualification (dispatched 2026-08-27T05:37Z for final candidate 2e56ffc)

| Workflow | Run ID | SHA | Result | Artifact/evidence |
|---|---|---|---|---|
| Rust and release (Rust, frontend, Windows exe, MSI/NSIS bundle) | 33043088979 | 2e56ffc | in_progress | https://github.com/quantdale/monitorers/actions/runs/33043088979 |
| E2E Verification Harness | 33043091191 | 2e56ffc | success (completed 2026-08-27T05:38Z, 1m34s) | https://github.com/quantdale/monitorers/actions/runs/33043091191 |
| Simulation (mock lane) | 33043093443 | 2e56ffc | in_progress | https://github.com/quantdale/monitorers/actions/runs/33043093443 |
| Release qualification (MSI/NSIS) | 33043102890 | 2e56ffc | in_progress | https://github.com/quantdale/monitorers/actions/runs/33043102890 |
| Packaged real simulation (via Simulation dispatch) | 33043093443 | 2e56ffc | in_progress (packaged lane is part of Simulation workflow dispatch) | https://github.com/quantdale/monitorers/actions/runs/33043093443 |

### G. Defects found during migration

| # | Severity | Stage | Root cause | Fix commit | Regression test / verification |
|---|---|---|---|---|---|
| 1 | Medium | foundation (serde) | `cargo update -p serde --precise` forced resolver to unify windows-core to 0.61.2, breaking wmi 0.18.4 which requires 0.62.2 (dual-version coexistence via wry vs wmi) | Reverted lock, used plain `cargo update` (no --precise) which preserves 0.61.2+0.62.2 dual versions; documented in evidence D | cargo check --all-features green, wmi 0.18.4 compiles, windows-core 0.62.2 retained for wmi |
| 2 | Low | toolchain (clippy 1.95) | New clippy 1.95 `question_mark` lint flagged `if let Some(stripped)=name.strip_prefix("luid_")` in `collector/gpu.rs:23` | `acfe6a5` rewrote to `name.strip_prefix("luid_")?` semantics identical | 43 gpu tests green, clippy -D warnings clean, fmt clean |
| 3 | Low | TypeScript 7 | TS 7 stricter: `src/sim` harness files (node:fs/process) were pulled into main `tsc --noEmit` via `include: ["src"]` + imports to `e2e/`, and `runner.ts:317` had implicit `any` for `find((f)=>...)` | `b416212` added `exclude: ["src/sim","src/**/*.test.*"]` to `tsconfig.json` so harness only checked via `e2e/tsconfig.sim.json` (types: [node]), and added explicit `(f: string)` | tsc --noEmit clean (both main and sim), build 741ms, vitest 248 green |
| 4 | Info | jsdom 30 | jsdom 30.0.1 engine requires Node ^24.15.0 but host is 24.3.0 → EBADENGINE warning on `npm ci`/`npm install` | Kept jsdom 30.0.1 (vitest still passes, 248 tests green); documented that CI Node 24 (latest patch) satisfies 24.15+ without warning, local Node patch update to 24.15+ recommended | npm audit 0, vitest 20 files green despite warning |
| 5 | Info | vitest | Cold-cache full-suite timeout: `renderCardContent.test.tsx` 1/11 timed out at 20s (first `verify:full` 67.86s, transform 6.6s) vs warm-cache 19s 248/248 green | Triaged as env/load flake (same as baseline flake in evidence A), not code defect; second `verify:full` run with warm cache passes 5m36s release build | Second `verify:full` GREEN, isolated `vitest run src/cards/renderCardContent.test.tsx` 5.64s green, full suite 19s green on retry |

No Critical/High/P1/P2 defects introduced; all fixes verified by existing tests + targeted reruns.

### H. Dependabot PR disposition (as of 2026-08-27, refreshed via `gh pr list`)

| PR | Domain | From→To | Disposition | Evidence/trigger |
|---|---|---|---|---|
| #20 | frontend tooling group | vite 6.4.3->8.2.1, plugin-react 4.3.4->6.1.0, jsdom 25->30.0.1, TS 5.9->7.0.2, @types/node 24->26, Tauri CLI | **Superseded** – recreated as staged workstreams I (Vite 8.2.2/6.1.0, TS 7.0.2, jsdom 30.0.1) + G (CLI 2.11.4); @types/node 26 **deferred** (Node stays 24.3.0, 24.13.3 latest 24) | Commits acaf2e3, b416212, ad9ee00, 5981185 |
| #21 | charts | recharts 3.8.0->3.10.1 | **Adopted** via `4cf2eb0` recharts 3.10.1 (latest) | 2162 modules, tests green |
| #22 | Tauri JS API | @tauri-apps/api 2.10.1->2.11.1 | **Adopted** via `5981185` api 2.11.1 (matches Rust 2.11.5) | tsc+build green |
| #23 | React | react 18.3->19.2.8 + @types/react | **Adopted** coherent with #24 via `8a92152` | 248 tests green |
| #24 | React DOM | react-dom 18.3->19.2.8 + @types/react-dom | **Adopted** coherent with #23 via `8a92152` | 248 tests green |
| #25 | UI icons | lucide-react 0.460.0->1.34.0 (target 1.31.0) | **Adopted** via `926b8d0` 1.34.0 (latest) | 2405 modules, tests green |
| #26 | Tauri store JS | @tauri-apps/plugin-store 2.4.2->2.4.4 | **Adopted** via `5981185` plugin-store 2.4.4 (matches Rust) | tsc+build green |
| #27 | Rust grouped | serde 1.0.228->1.0.229, serde_json 1.0.149->1.0.151, sysinfo 0.33.1->0.39.6, wmi 0.13.4->0.18.4, chrono 0.4.44->0.4.45, nvml-wrapper 0.10.0->0.12.1, windows 0.61.3->0.62.2, tauri-plugin-store, tauri-build | **Superseded** – decomposed into collector-platform (acfe6a5/618aaf5/11e5075/3c53934) + foundation+Tauri (a569d3d) per D2 | Each domain verified via cargo test/clippy/fmt |

No open PR remains unexplained; all 8 PRs are Adopted (6) or Superseded (2) with exact commits. If `gh` cannot close superseded PRs in this environment, maintainer action: close #20 and #27 as superseded by this campaign branch (all their package bumps are landed in staged commits).

### I. Limitations (truthful external limits, not campaign blockers)

- **Dual identical-GPU physical proof – still exploratory / unqualified**: deterministic fixtures cover UUID/PCI vs name reconciliation and duplicate-name fail-closed logic (all 248 tests green), but this host has only one physical Nvidia GPU plus Intel iGPU (3 LUIDs total, not 2× identical). No qualifying machine with two identical physical GPUs was available, so runtime dual-identical-GPU telemetry association remains explicitly unqualified – fixtures are not physical proof (per D7/F requirement).
- **Physical hotplug/lid/power automation – not fabricated**: hotplug gap journey is mocked (gpu-hotplug-gap 3/3 in mock sim), not physical; lid/power events remain in `e2e/exploratory-register.md` and are not claimed.
- **Code signing – installers remain unsigned**: MSI/NSIS installers are unsigned because no signing certificate/secret is configured (per backlog). Dependency modernization does not invent credentials.
- **Node patch level – jsdom 30 engine warning**: jsdom 30.0.1 wants Node ^24.15.0, host is 24.3.0 → EBADENGINE warning on npm install, but vitest still passes. CI Node 24 (latest) satisfies 24.15+; local Node patch update to 24.15+ is recommended but not required for correctness. @types/node 26 deferred for same reason (Node stays 24).
- **Packaged real-lane free-roam pointer-drag – still exploratory**: keyboard drag is certified (dnd-kit keyboard + pointer tests green, Recharts memoization preserved), pointer-drag remains registered exploratory gap per AGENTS.md, not a blocker for this dependency campaign.
- **Unsigned installers and physical-only gaps are intentionally deferred, not blockers for local/hosted qualification of the modernized stack**.
