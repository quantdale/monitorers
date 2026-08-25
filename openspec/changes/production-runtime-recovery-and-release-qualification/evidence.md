# Campaign evidence — production-runtime-recovery-and-release-qualification

## Baseline

- Session start: 2026-08-25
- Prompt anchor SHA `41a532e71a72717ffe363a20f4336f7776df1795`: **not present in this
  repository** (`git cat-file` fails); treated as stale prompt metadata per the
  campaign's "never overwrite newer work" rule. Actual starting state:
  - Branch `agent/monitorers-comprehensive-remediation`, HEAD `d24d6a1`
    ("fix: comprehensive hardening pass"), working tree clean.
  - `origin/main` ref pointed at `70996e9`; initial `git fetch` failed (github.com:443
    unreachable) — see Hosted validation below for the network condition that persisted
    through the session.

## Local verification (2026-08-25, Windows dev machine)

| Gate | Result | Detail |
| --- | --- | --- |
| `npm run verify:version` | PASS | 0.1.4 consistent across package.json / Cargo.toml / tauri.conf.json |
| `npm audit --audit-level=high` (root + app) | PASS | 0 vulnerabilities |
| `npx tsc --noEmit` | PASS | clean |
| `npm test -- --run` | PASS | 18 files, **216 tests** (incl. 7 new lifecycle hook tests, 3 new mock-backend lifecycle tests) |
| `npm run build` | PASS | split chunks unchanged shape |
| `npm run verify:e2e` | PASS | **14/14** (12 prior + 2 new recovery-banner tests) |
| `npm run sim:typecheck` | PASS | clean |
| `npm run verify:sim` | PASS | matrix green, **16/16 journey runs** in ~5.4 min incl. new `collector-recovery` (9 asserts ×2 personas) and `fault-retry-exhaustion` |
| `cargo fmt -- --check` | PASS | clean |
| `cargo test` (5 feature lanes) | PASS | lib tests: 194 (default+all-features) / 175 (no-default) / 188 (nvml-only) / 186 (nvapi-only); probe 2; main 2; 1 ignored real-hardware cadence test |
| `cargo clippy --all-targets --all-features -- -D warnings` | PASS | exit 0 |
| `cargo audit` | PASS | exit 0; 21 pre-existing *allowed* advisories (unchanged policy) |
| `npm run verify:tauri` | PASS | exit 0, release exe built |
| `npx tauri build` | PASS | produced `System Monitor_0.1.4_x64_en-US.msi` + `System Monitor_0.1.4_x64-setup.exe` |
| `scripts/installer-manifest.mjs` | PASS | version-filtered manifest: 2 artifacts, sizes + SHA-256 recorded, unsigned status truthful |
| `npm run verify:packaged` | PASS | real exe over CDP: `get_history` schema 5 via `__TAURI_INTERNALS__`, live collector timestamps advanced, viewMode write landed only in run-isolated settings store, Retry-capable teardown clean, orphan-process assertion passed, developer settings byte-identical |
| `openspec validate --all --strict --no-interactive` | PASS | 16 items, 0 failures |
| `git diff --check` | PASS | clean |

## Defects found and fixed by this campaign's own verification

1. **`MetricCard` list view had lost `data-testid="metric-card-*"`** (regression introduced
   in d24d6a1). Symptom: `layout-persistence` journey hung ~12 min on an auto-waiting
   locator (cards render fine but carry no stable hook). Fixed; journey passes 6/6 in
   ~10 s. Proven pre-existing via stash-probe-pop bisect against baseline code.
2. **Supervisor test race**: escalation/budget tests could flake on a loaded host
   (scheduler stretch past `healthy_reset_after` legitimately reset the streak mid-test).
   Caught by repeated full-suite runs (1 failure / 12); hardened with a
   non-resetting `escalation_policy()`; 20/20 clean reruns of the affected lane.
3. **Harness robustness**: atomic artifact writer gained a bounded rename retry
   (transient Defender EPERM failed an otherwise-passing matrix run); RealAppDriver
   cleanup retry ladder extended (~7.75 s) so WebView2 handle release cannot fail an
   otherwise-passing packaged qualification; sim matrix timeout raised to a documented
   900 s for the grown selection.

## Fault-injection containment proof

- Synthetic panic providers/policies exist **only** in `#[cfg(test)]` modules
  (`run_loop.rs`, `supervisor.rs`) and browser-mode sim code (`src/sim/mockBackend.ts`,
  unreachable when `isTauri()`).
- No fault cargo feature exists: `simulation.yml` config-lint pins `[features]` to
  exactly `{custom-protocol, default, nvapi, nvml}` and greps backend sources for
  `SYSMON_(CRASH|FAULT|PANIC)|inject_fault|fault_injection|crash_collector`.
- Local dry-run of both lint checks: PASS (features exact-match; grep zero hits).

## Known limitations carried forward

- **Dual identical-GPU runtime mapping**: still not physically validated (requires
  qualifying hardware); deterministic identity/reconciliation fixtures remain the
  coverage; explicitly not marked resolved.
- **Signing**: installers are unsigned (no certificate); manifest/workflow/docs state
  this truthfully.
- **Hosted validation**: github.com egress from the development machine was unavailable
  for most of the session (TCP 443 connect timeouts, first observed at the initial
  fetch). One push succeeded during a brief recovery window (branch updated through
  `120c591`); remaining commits + PR + workflow runs were still being retried at report
  time. Hosted run IDs/outcomes are appended below as they land.

## Hosted validation

- PR opened: **quantdale/monitorers#28** (`agent/monitorers-comprehensive-remediation` → `main`).
- Hosted runs at intermediate head `201f7fd`: E2E ✓ success (run 32841068357), Rust-and-release ✓ success (run 32841068350), Simulation ✗ failure (run 32841068418).
- Simulation failure root cause: the NEW shipped-config fault-surface lint used double-backslash regexes in its PowerShell single-quoted strings (`^\\[features\\]`), so `-notmatch` threw "Cargo.toml missing [features]" on clean sources. Diagnosed from the failed job log; fixed in `ca2cf98`; **Simulation — config lint PASS (11 s)** on HEAD.
- Hosted runs at HEAD: E2E ✓ pass; Frontend ✓ pass; Snyk ✓ pass; Rust/Simulation/executable lanes in progress at report time (watcher running).
- Installer qualification triggered via the workflow's designed tag lane (workflow_dispatch requires the file on the default branch): annotated tag **`v0.1.4-rc1`** pushed at campaign HEAD → release-qualification run **32842750871** in progress.

## Commits (this campaign)

- `4c13e76` feat(supervisor): bounded collector recovery lifecycle replaces fail-stop
- `8124ba2` feat(lifecycle): typed collector-status IPC, recovery UX, recovery journeys
- `b919973` docs+test: reconcile instruction files with supervised runtime; de-flake budget tests
- `be2c109` fix(harness): manifest hashes only the current release version; packaged-lane fixes
- `120c591` chore: ignore generated release manifest; record local gate evidence in OpenSpec tasks
