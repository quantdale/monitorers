# Evidence — production-persistence-and-operational-hardening

All commands executed on Windows 11 (dev workstation) unless noted as hosted.
Artifacts referenced below live under `sys-monitor-tauri/e2e-results/sim/`
(run directories carry seed/journey/persona in their names).

## 1. Baseline and adopted work

- Campaign branch `agent/monitorers-production-persistence-ci-hardening`
  created from `origin/main` = `718e503a6663f7fdd780d9f76410e288875a438a`
  (planner-observed tip; re-fetched mid-campaign — still current).
- The working tree carried an uncommitted 2026-08-26 remediation/performance
  pass (user-approved adoption): pinned prebuilt cargo-audit CI install,
  Playwright Chromium caching, schema-doc 4→5 fixes, MetricChart React.memo,
  thin LTO, CpuIdentity bootstrap dedup, startup_probe example, dead-code
  removal, misdrag journey fix. Verified before commit:
  - `cargo test` — all suites green incl. examples (exit 0)
  - `npx tsc --noEmit` — exit 0
  - `npm test -- --run` — 242 passed
  - `npm run sim:typecheck` — exit 0

## 2. Workstream A — repository truth convergence

- Stale claim removed: AGENTS.md asserted WebView2 "can't be automated" while
  the same file documented the packaged CDP real lane. Replaced with the
  three-lane capability statement (harness E2E / mock sim / packaged CDP).
- progress.md headers rewritten: PR #28 marked COMPLETE (merged/archived);
  current phase = this hardening change.
- .cursorrules gained the simulation-platform spec pointer (backlog item).
- Exploratory register updated: sidebar entry now names
  `sidebar-relaunch-persistence` as the certifying journey; free-roam pointer
  caveat kept honestly (keyboard drag used; pointer drag still unproven).
- Schema consistency audited against executable constants:
  - `SCHEMA_VERSION = 5` (snapshot.rs) ↔ `EXPECTED_SCHEMA_VERSION = 5` (useMetrics.ts) ↔ qualify.spec `.toBe(5)` ↔ docs
  - `LIFECYCLE_SCHEMA_VERSION = 1` (supervisor.rs) ↔ `EXPECTED_LIFECYCLE_SCHEMA_VERSION = 1` (useMetrics.ts) ↔ docs
  - No file advertises two different "current" values.

## 3. Workstream B — real-lane sidebar relaunch certification

Journey `sidebar-relaunch-persistence` (real lane only) drives the built exe:

- Final local result: **PASS 16/16** assertions against
  `src-tauri/target/release/sys-monitor-tauri.exe` (release, thin LTO).
- True-relaunch evidence recorded per run (run.jsonl):
  - first process exit record (`app process exited (code=null, signal=SIGTERM)`)
  - distinct CDP ports per process (reused port would mean no new target),
    e.g. 5625 → 13548
  - in-memory history rebuilt empty across the boundary (old=4 → new@live=0)
  - native supervisor re-bootstrap (`generation=1`, `schema_version=1`,
    state starting→healthy via get_collector_status over __TAURI_INTERNALS__)
- Persistence contract verified on real hardware:
  - keyboard drag reorders rendered `[data-sb-id]` cards
  - dragged order lands in the run-isolated real settings.json
    (`SYSMON_SIM_APP_DATA` / `sim_store_override` absolute-path store)
  - store NON-DESTRUCTION across relaunch: saved array survives byte-exact
    even when the second process discovers fewer devices
  - rendered restore is an order-preserving subset of the saved order
- Runner-level guarantees applied to every real-lane run: orphan-process
  guard (`assertNoOrphanProcesses`) + developer-store byte-identity self-test.

### Defects found by this journey (and fixed)

1. **Destructive sidebar persistence (production bug).** Hardware discovery
   varies between processes on this machine (Windows materializes GPU Engine
   counters lazily: 3 GPU entries vs 0 across consecutive launches; disk
   enumeration differs pre/post WMI enrichment: model names vs drive
   letters). The dashboard keeps ghost ids in cardOrder by design, but the
   sidebar auto-save effect persisted the discovery-filtered subset,
   permanently rewriting the user's arrangement. Fixed with
   `persistSidebarCardOrder` (non-destructive store merge) +
   `mergeDraggedSidebarOrder` (drags keep ghosts); unit-pinned ×5.
2. Journey-side races fixed iteratively (stale page bindings across
   restartApp; store-vs-stale-DOM equality; premature history sampling;
   epoch-vs-age timestamp misreading) — each is encoded as a semantic wait or
   corrected invariant in the final journey.

## 4. Workstream C — restart/settings durability soak

- Coverage evaluation: one-shot restart coverage existed
  (customization-roundtrip real lane, qualify.spec); repeated-cycle
  durability did not. Added `restart-soak-durability` (real lane only,
  bounded 3 cycles, rotating window/viewMode mutations).
- Local result: **PASS 25/25** — per cycle: UI mutation → persisted to
  isolated store → strict JSON validity + settingsVersion=2 mid-soak → clean
  shutdown → relaunch → restored values match store AND UI selector → native
  status re-answered → metrics timestamps advanced.

## 5. Workstream D — cargo-audit CI installation path

| | Old | New |
|---|---|---|
| Mechanism | `cargo install cargo-audit --version 0.22.1 --locked` | `taiki-e/install-action@b6ff580856c41316412a0b9b60540fbc6f8c82cc` with `tool: cargo-audit@0.22.1` |
| Cost (Rust — verify job, windows-latest) | **5m14.5s** install step of a 10m56s job (~48%); measured from hosted log, run `32925221386`, job `98046655685`, step start 03:08:37.9Z → next step 03:13:52.4Z (2026-08-26) | **~3.3s** install step; measured from hosted log of this branch's final-head run `32956962281`, job `98140643565` (action starts 10:13:18.2Z, `verify:rust` begins 10:13:21.5Z). Whole Rust job: 10m56s → **6m11s** (-4m45s, -43%) |
| Audit semantics | pinned 0.22.1 | identical: same version pin, official RustSec release binary |
| Supply chain | compiles from registry source each run | action pinned to full commit SHA (immutable); official prebuilt distribution; no unsigned arbitrary binaries |
| Failure visibility | install failure fails job | action failure fails job BEFORE the audit step — audit can never be silently skipped |

Additional verified CI facts: all 43 `uses:` references across the four
workflows are full-SHA pins; Playwright Chromium caching (e2e.yml,
simulation.yml) keys on the package-lock hash and retains the explicit
install step as cold-miss fallback.

## 6. Workstream E — focused hardening audit findings

Settings/persistence: single SettingsProvider/save path confirmed; save queue
serializes writes; future-version files fail closed (store ref never set);
corrupt fields fall back per-field with warnings; `sim_store_override` is
env-gated and validated (absolute path + existing directory) in main.rs.
Driver: launch ownership, fresh port allocation, HKLM fallback written before
spawn with unconditional aggregated cleanup, work-dir retry ladder — reviewed,
no defects beyond those already fixed. Lifecycle: listener-before-bootstrap
ordering with applied-status sequence fence confirmed intact post-relaunch
(exercised by both journeys). CI/supply-chain: full-SHA pins throughout;
no unverified downloads; cache keys derive from lockfiles (no stale-tooling
window).

## 7. Physical-hardware boundary (truthful limitations)

- **Dual identical-GPU runtime mapping remains physically unqualified.** This
  workstation exposes a single integrated GPU enumerating as multiple PDH
  adapter/engine LUID nodes — NOT qualifying hardware. Deterministic identity
  fixtures stay as coverage; no physical validation is claimed.
- **Real-hardware discovery variance** (§3) is now an explicit, evidenced
  behavior: the sidebar tolerates it without data loss; backend enumeration
  itself may legitimately differ between sessions. Recorded here rather than
  papered over.
- Physical hotplug/lid/power scenarios remain registered exploratory-only.
- Free-roam pointer-drag on the real lane remains unproven and registered;
  this campaign deliberately used the deterministic keyboard interaction.

## 8. Canonical local validation at final head

Recorded after the full gate completed — see §9 for hosted results.

## 9. Hosted qualification at final head `317c2661de49a3daef41214d398fd25765627584`

| Lane | Run | Result |
|---|---|---|
| rust.yml — Rust / Frontend / Windows production executable | `32956962281` | success (6m11s / 29s / 7m38s) |
| e2e.yml — mock-data harness | `32956962288` | success |
| simulation.yml — config lint + mock lane (PR) | `32956962301` | success (16 journeys green) |
| simulation.yml — packaged lane (dispatch) | `32959735876` @ `30d3dba` | success — real-lane journeys on windows-latest: first-launch-onboarding glancer 7/7, customizer 14/14; customization-roundtrip both personas 9/9; **sidebar-relaunch-persistence 17/17** (exact-equality branch exercised); **restart-soak-durability 25/25** |
| release-qualification.yml (dispatch) | `32959741283` @ `30d3dba` | success — MSI install/run/uninstall, NSIS install/run/uninstall, signed-hash manifest |

PR #29 required checks at final head `a72a8d0`: Rust verify 5m19s, Frontend verify,
Windows production executable 7m18s, E2E mock harness, Simulation lint+mock lane,
Kilo Code Review, Snyk — ALL PASS (`gh pr checks 29`). The `a72a8d0` delta is
test-file-only (no packaged-app or installer input), so the `30d3dba`
dispatch evidence remains valid for the shipped artifact; PR-triggered gates
re-ran at the true final head.

### Hosted-run defect loop (fixed within this campaign)

- Run `32952589280`: first cold launch lost its WebView2 target between CDP
  readiness and page attach (harness bring-up gap) → bounded fresh-process
  retry added to `RealAppDriver.launch`.
- Run `32954583100`: retry exposed the elevated-host port channel (HKLM policy
  still pointed at the stale port on respawn → attempt-2 timeout). Retry now
  rewrites the policy with the fresh port. Sidebar store invariant corrected to
  append-only preservation after the hosted runner legitimately discovered MORE
  devices post-relaunch.
- Run `32956986920` (final head): all six journeys green — flake absorbed by
  design, not luck.

### Pre-existing annotation (not introduced here)

`actions/download-artifact@<sha>` emits a Node 20 deprecation warning on Node 24
runners. Warning-only, affects every workflow equally, pre-dates this branch;
recorded as future maintenance rather than churned inside this campaign.
