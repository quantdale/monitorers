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
3. **Tauri CLI corrupts multi-bin crates during bundling** — found by hosted installer
   qualification, invisible to build-only CI. With two bin targets (`sys-monitor-tauri`
   + `cadence_probe`), the Tauri CLI renames each produced binary onto
   `mainBinaryName`, so the 1.1 MB probe clobbered the 9.3 MB app: the MSI File table
   contained **only `cadence_probe.exe`** (843 KB installer) and installed machines had
   no application executable at all (hosted run 32842750871:
   "installed executable missing"). Fixed by moving the probe to an example target
   (`examples/cadence_probe.rs`) and pinning `mainBinaryName`; local MSI now lists
   `sys-monitor-tauri.exe` at 9,317,888 bytes inside a 3.3 MB installer.
4. **Harness robustness**: atomic artifact writer gained a bounded rename retry
   (transient Defender EPERM failed an otherwise-passing matrix run); RealAppDriver
   cleanup retry ladder extended (~7.75 s) so WebView2 handle release cannot fail an
   otherwise-passing packaged qualification; sim matrix timeout raised to a documented
   900 s for the grown selection.
5. **Hosted-lint regex escaping**: PowerShell single-quoted strings need single
   backslashes; the first shipped-config lint used `\\[` and failed clean sources
   (run 32841068418); fixed and proven passing hosted (config lint PASS at HEAD).

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
- Installer qualification triggered via the workflow's designed tag lane (workflow_dispatch requires the file on the default branch): annotated tag **`v0.1.4-rc1`** pushed at campaign HEAD → release-qualification runs per candidate below.

### Qualify-lane failure at Runtime 150+ runners (root-caused & fixed)

- Symptom (runs 32845135279 → 32859315308): both MSI and NSIS qualify jobs failed identically at "Smoke-test the installed executable" — app process alive, window titled "System Monitor", six `msedgewebview2.exe` processes, Evergreen runtime **151.0.4129.86** registered, but the requested `--remote-debugging-port` never listened (CDP timeout). Local dev machine (non-elevated) passed the same driver.
- Root cause: WebView2 Runtime **150** added security hardening for elevated host processes — `WEBVIEW2_*` environment variables (including `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`) and HKCU policy are intentionally ignored; only HKLM policy and API-passed arguments survive elevation (Microsoft Learn: *Develop secure WebView2 apps → For an elevated host app*; WebView2Feedback #5640/#5645). GitHub-hosted Windows runners execute steps **elevated**, so the env-var channel silently dropped the debug switches.
- Fix (commit `22961a3`):
  - `RealAppDriver` mirrors its debug switches into `HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments` (value name `*`) before spawn — the Microsoft-sanctioned channel for elevated hosts — best-effort (access-denied on standard-integrity dev machines falls back to the working env-var channel), removed again in `close()`.
  - Qualify teardown is now unconditional (launch failures also kill the spawned app, remove the policy value, delete the work dir).
  - Failure diagnostics dump actual `msedgewebview2.exe` command lines so switch delivery is directly attributable.
- Separate defect found in the same runs: `installer-manifest.mjs` expected `msi/`+`nsis/` directly under `--bundle`, but download-artifact nests uploads under the artifact name (`bundle-artifacts/windows-installers/msi/…`), failing the manifest job even on artifacts being present; collector now walks recursively (version-token filter retained).
- Retriggered: tag `v0.1.4-rc1` force-moved to `22961a3`; release-qualification run **32864438234**.

### Run 32864438234 results → spawn-order race + uninstall parsing

- NSIS qualify: **smoke test PASSED** (real IPC, live data, isolated settings, clean exit) — the elevated-host policy channel works end to end. The job then failed in "Uninstall silently and assert removal" with a PowerShell **ParserError**: `QuietUninstallString` is a quoted path, and interpolating it via `"${{ … }}"` into the script body produced invalid syntax.
- MSI qualify: CDP now came up (`--remote-debugging-port` visible in the browser-process command line) but Playwright's attach failed with "Target page, context or browser has been closed", with the host app and webview tree gone at diagnostic time and a clean app stderr — a WebView2 **browser-process restart over a flag change**: the HKLM value was written AFTER spawn, so on this runner it landed after the loader had already created its environment, and runtime ≥150 restarted the browser over the changed overrides, tearing down the fresh debug server. Whether the write wins the race explains why one lane passed while the other died.
- Fixes (commit `aa36e2f`): write the policy value BEFORE spawn; record how the spawned app process ended and print it in failure diagnostics; parse the NSIS uninstall command from env-var-passed outputs (verbatim, quote-aware split, `/S` ensured, direct `Start-Process`) instead of string interpolation.

### Final qualification evidence (2026-08-25)

- Tag `v0.1.4-rc1` force-moved to `aa36e2f`; release-qualification run **32867950233: success** — Build installers ✓ · Qualify MSI ✓ (silent install → real-IPC smoke over CDP against the installed binary → clean removal, no orphans) · Qualify NSIS ✓ (incl. user-data retention assertion) · Release manifest ✓ generated and gated on qualification result `passed`, artifact uploaded.
- PR lanes at `aa36e2f`: E2E Verification Harness ✓ (32867729073), Simulation ✓ incl. shipped-config lint (32867729164), Rust and release ✓ (32867729506).
- Remaining annotations are non-blocking warnings only (download-artifact SHA pin targets Node 20 runtime; `artifact-name` input accepted by that pinned version).

## Commits (this campaign)

- `4c13e76` feat(supervisor): bounded collector recovery lifecycle replaces fail-stop
- `8124ba2` feat(lifecycle): typed collector-status IPC, recovery UX, recovery journeys
- `b919973` docs+test: reconcile instruction files with supervised runtime; de-flake budget tests
- `be2c109` fix(harness): manifest hashes only the current release version; packaged-lane fixes
- `120c591` chore: ignore generated release manifest; record local gate evidence in OpenSpec tasks

## Safety closure (2026-08-26) — defects found after the runs above

The green runs recorded above are **historical evidence for the heads they ran
against only** (`aa36e2f` and earlier). A fresh planner audit plus the PR review
threads found live defects at head `31f190c`; they were fixed on this date and
the affected gates are being re-run at the final head (results appended below
as they land):

1. CRITICAL — retry/stop managed-state collision in main.rs: two raw
   `Arc<AtomicBool>` values managed by type; the second `manage` was refused
   silently so `retry_collection` resolved the STOP flag. A Retry click from
   `failed` could stop collection permanently. Fixed with distinct
   `StopFlag`/`RetryRequest` newtypes + asserting `register_lifecycle_flags`;
   regression tests exercise the real MockRuntime command/state seam including
   the full Failed → Retry → one replacement generation → first data → Healthy
   path with stop-flag-false and no Stopping transition.
2. P1 — frontend mount/reload never fetched the current managed status; fixed
   with a race-fenced `get_collector_status` bootstrap (9 hook regression cases).
3. P2 — first collector poll fired before the initial tick deadline; loop now
   waits at the top of every iteration; regression fails pre-fix (~60ms first
   emit), passes post-fix.
4. P2 — mock backend reported healthy before any replacement data; parity
   restored (healthy strictly after first emit) + singleton teardown token;
   journeys assert the ordering via in-page probes.
5. HIGH — RealAppDriver could skip machine-wide WebView2 debug-policy removal
   when work-dir cleanup failed; cleanup now unconditional with aggregated
   errors and an injectable registry seam covered by unit tests. Journey-runner
   diagnostics turn any close failure into run failure.
6. P1 — release workflow download steps used unsupported `artifact-name:`
   inputs; replaced with supported `name:` everywhere.
7. DOC — `retryMetrics` contract comment reversed honored/coalesced semantics;
   corrected across AGENTS.md / CLAUDE.md / .cursorrules / useMetrics.ts.
8. Hygiene — tracked raw CI diagnostic dumps removed from repo root
   (msi-fail.log, msi-full.log, msi-rc4.log, nsis-full.log, nsis-rc4.log);
   their durable findings remain this section + the hosted-validation history
   below (CDP-unreachable-on-elevated-hosts root cause → HKLM policy channel
   written before spawn; NSIS dir resolution hardening). Untracked
   msi-rc5.log deleted.

Also landed en route (found during the audit, same blast radius): reusable PDH
counter-array scratch buffer + memoized chart/window pipelines (per-tick CPU
churn), CPU-only startup probe instead of a throwaway full CollectorState,
borrowed profile reconciliation read per emitted tick.

### Final-head validation (2026-08-26)

Local canonical gates at fix head `0c2425a` — `npm run verify:full` exit 0
(frontend audits/typecheck/Vitest **240/240**/build; cargo fmt + tests across all
5 feature lanes + clippy `-D warnings` + audit exit 0; E2E harness green; mock
sim matrix **16/16** journey runs with the strengthened lifecycle-ordering
assertions — collector-recovery now 10 asserts/run; Tauri release exe built),
plus `verify:version`, `sim:typecheck`, `openspec validate --all --strict --no-interactive`
(16 passed / 0 failed), `git diff --check` clean, and `npm run verify:packaged`
PASS against that freshly built exe (real IPC schema-5 get_history over
__TAURI_INTERNALS__, advancing collector data, viewMode write landed only in the
run-isolated settings store, clean exit, no orphan processes, developer store
byte-identical). The packaged run also exercised the new policy diagnosability:
HKLM write refused (non-elevated host) logged explicitly, env-var channel used.

- Hosted CI at final head `b479409d941a1cea024b0d92b4dae30d3563f8e3` — ALL GREEN:
  - Rust — verify ✓ + Frontend — verify ✓ + Windows production executable ✓
    (run 32921490820)
  - E2E — mock-data harness ✓ (run 32921490844)
  - Simulation — config lint ✓ + mock lane 16/16 journey runs ✓ (run 32921490834)
  - Kilo Code review pass at the final head with no new findings;
    security/snyk pass (2 security tests).
- Release qualification at the SAME final SHA — run **32922280117** success
  (workflow_dispatch on the PR branch): Build MSI+NSIS ✓, Qualify MSI
  (silent install → registry/version verification → installed-binary real-IPC
  CDP smoke → silent uninstall → clean-removal/orphan assertions) ✓, Qualify NSIS
  ✓, artifact-integrity manifest ✓. Manifest (downloaded and verified):
  commitSha b479409d…f8e3, applicationVersion 0.1.4, qualification result
  `passed`, truthful unsigned status,
  `System Monitor_0.1.4_x64_en-US.msi` sha256
  `3168ab193a5b12cd9d97f56727fa7a2db5a85bb63736bcac1e3dcff052aadfe2`,
  `System Monitor_0.1.4_x64-setup.exe` sha256
  `e1be8f791e8afed50470e6079a9b316036d14f96bd2e456a4cadb51499845ec3`.
  Historical run 32867950233 (aa36e2f) remains forensic evidence only.
