# Remediation evidence

## Baseline

- Date: 2026-08-13 (Asia/Manila)
- Base: `70996e9cacd67f0d421f5a82b5b6ef8745b45eaf` (`origin/main` at branch creation)
- Branch: `agent/monitorers-comprehensive-remediation`
- Initial worktree: only pre-existing untracked `.agents/` and `GEMINI.md`; neither is part of this change.
- Historical main CI was red:
  - E2E run `31225806461`, job `93019743616`: 8 passed, `drag-reorder.spec.ts:33` pointer reorder failed at line 44 because the first card stayed `cpu` for 3 seconds. Artifact `9012069851` (`playwright-report`) was downloaded locally.
  - Rust run `31225806465`: Rust tests passed; Rust lint failed in `cargo clippy` at `src/collector/gpu.rs:23` (`question_mark`), and frontend failed before typecheck/tests/build at `npm audit` because `nanoid <3.3.17` had a high advisory.
  - Simulation run `31225806481` passed.

## Unmodified-source baseline commands

| Command | Result | Evidence |
| --- | --- | --- |
| `npm ci` (app) | PASS after stopping a repository-local stale Vite/esbuild process holding `esbuild.exe` | 342 packages installed; npm reported one high `nanoid` advisory |
| `npx tsc --noEmit` | PASS | clean exit |
| `npm test -- --run` | PASS | 13 files, 129 tests |
| `npm run build` | PASS | Vite production bundle built; chunk-size warning only |
| `npm run e2e` | PASS locally | 9/9 passed; historical hosted failure remains recorded above |
| `npm run sim:typecheck` | PASS | clean exit |
| `SIM_SEED=42 npm run sim` | PASS | determinism + mock matrix passed; 2 tests, 1m44s |
| `cargo fmt -- --check` | PASS | clean exit |
| `cargo test` | PASS | 142 library tests + 1 main test; one ignored real-hardware test |
| `cargo clippy --all-targets --all-features -- -D warnings` | PASS locally | clean exit; hosted stable toolchain caught a `question_mark` lint at audit base |
| `cargo audit` | PASS exit, warnings | current database reported allowed unmaintained/unsound dependency warnings; no nonzero result |
| `npm audit --audit-level=high` (app) | FAIL | high `nanoid <3.3.17` advisory |
| `npm audit --audit-level=high` (root) | FAIL | high `picomatch` advisory (plus moderate `yaml`) |

## Hosted E2E failure investigation

The failure is a pointer-drag interaction/test synchronization defect, not a chart assertion: the test's semantic postcondition never became true. The same test passed locally, so the fix must make the drag target and completion observable rather than adding an arbitrary wait. The regression will preserve the before/after identity assertion and add a stable application-owned reorder signal where needed.

## Remediation evidence

### Harness and frontend

- `npx tsc --noEmit`: PASS.
- `npm test -- --run`: PASS after remediation; the suite includes schema rejection,
  stale request/replay, settings migration, stable identity, finite formatting,
  chart-gap, simulation-speed, and harness-trust regressions. The exact test
  count is reported by Vitest and is intentionally not hard-coded here.
- `npm run build`: PASS. Vite emits only the existing large-chunk and toolchain
  deprecation warnings; no build error is suppressed.
- `npm run e2e`: PASS, 12/12, including the repaired pointer/keyboard reorder,
  timestamp-window fidelity, hotplug gap, accessibility, and app-owned chart
  metadata checks.
- `npm run sim:typecheck`: PASS.
- `SIM_SEED=42 npm run sim`: PASS, 11 runnable mock journey/persona selections,
  57 meaningful assertions. A targeted `ipc-schema-mismatch` run also passed
  and verified that incompatible events did not change chart point/latest
  metadata. The runner now fails zero-assertion, zero-result, unknown-selector,
  unexpected-browser-error, cleanup, and isolation cases.
- `npm run verify:version`: PASS; frontend, Cargo, and Tauri metadata are all
  `0.1.4`.
- `npm audit --audit-level=high` at both repository root and app: PASS, 0
  vulnerabilities.

### Collector timing and metric fidelity

- `cargo fmt -- --check`: PASS.
- `cargo test --all-features`: PASS, with Cargo reporting the current test
  count; default, no-default-features, `nvml`-only, and `nvapi`-only matrices
  also pass.
- `cargo clippy --all-targets --all-features -- -D warnings`: PASS.
- `cargo audit`: exit 0. It reports 21 allowed transitive
  unmaintained/unsound/platform warnings from the Tauri/GTK/Wry dependency
  graph; no fixable high/critical vulnerability was allowlisted by this
  change. These warnings remain a documented maintenance item.
- The collector now uses monotonic 250 ms deadlines, rebases after an overrun
  instead of catching up, records provider/lock timings, and starts core
  metrics before optional WMI bootstrap. Network deltas are normalized using
  the real sysinfo refresh interval; sysinfo's saturating counter-delta
  semantics and saturating interface aggregation handle reset/wrap safely.
- Backend and frontend history windows select by recorded timestamps and keep
  all aligned channels on the same range. Missing device samples remain null
  gaps; numeric zero remains zero.

### Real Windows cadence probe

The corrected headless probe was built from the branch and run for 60 seconds
on Windows build `10.0.26200` (Windows 11 Pro), with a 13th Gen Intel Core
i5-13500HX and Intel UHD/NVIDIA GeForce RTX 4050 display adapters visible to
PnP. The PDH probe observed three GPU engine entries; this is not claimed as a
three-physical-NVIDIA validation.

Raw JSONL was retained at:
`C:\Users\palac\AppData\Local\Temp\monitorers-cadence-final-20260813000000.jsonl`.
The checker output was:

```text
PASS
total_records=237 observation_ms=60172 mean_interval_ms=255.0 event_interval_ms={p50:250 p95:265 max:1409} full_interval_ms={p50:1000 p95:1021 max:2169} on_tick_count=60 (expected 60 ± 1) cpu_len=60 ts_len=60 gpu_total_len=180 timestamp_span_ms=60172 elapsed_whole_secs=60
```

The run exercised real GPU history growth (`gpu_count=3`, 177 points), real
timestamps, and the full 60-second elapsed-time gate. Two-device identical-name
NVML association remains covered by pure identity fixtures; a physically
identical multi-NVIDIA setup was not available and is therefore NOT-VALIDATED.
The short diagnostic timing run showed the first GPU/WMI bootstrap as the
startup hotspot and steady-state GPU provider calls around 1–2 ms; no
enrichment slowdown was adopted without that measurement.

### Build, CI, and hygiene

- `npm run verify:tauri`: PASS on Windows; the production executable was built
  with shipped features using the installed Tauri CLI and `--no-bundle`.
  MSI/NSIS generation is automatically wired for tag/manual workflow runs and
  is NOT-VALIDATED in this local no-bundle run.
- GitHub workflows now use pinned Node-24-era action commits, the repository
  Rust toolchain file, pinned `cargo-audit`, least-privilege read permissions,
  concurrency cancellation, a blocking PR/push mock simulation lane, and a
  Windows production-executable gate. Remote debugging remains only in the
  real simulation driver environment.
- Tracked OpenCode loop/session state was removed; durable commands and skills
  remain tracked, and only `.opencode/opencode-loop/` is ignored.
- The final adversarial review specifically checked timestamp windows,
  null-vs-zero gaps, stale async responses, schema fail-closed behavior,
  same-name GPU keys, WMI/PDH degradation, page-error/cleanup failure paths,
  artifact copying, remote-debug shipped-config scans, and secret/session-log
  hygiene.

### Final canonical gate rerun

- `npm run verify:frontend`: PASS — both npm audits reported 0 vulnerabilities,
  18 Vitest files / 199 tests passed, TypeScript passed, and the Vite build
  passed. The verifier was corrected to invoke npm's JS entry point through
  Node on Windows because Node 24 rejects nested `npm.cmd` spawns with EINVAL.
- `npm run verify:rust`: PASS — format, 162 all-feature tests, default /
  no-default / NVML-only / NVAPI-only matrices, clippy, and cargo audit. The
  audit result is exit 0 with the 21 documented transitive warnings above.
- Direct harness trust regression after the final lifecycle additions:
  `npm test -- --run src/sim/harness.trust.test.ts src/sim/mockBackend.test.ts
  src/sim/simConfig.test.ts`: PASS, 3 files / 50 tests.
- `npm run sim:typecheck`: PASS after the final driver-test additions.
- Final serial reruns: `npm run e2e` PASS (12/12, 24.7s), `SIM_SEED=42
  npm run sim:typecheck; npm run sim` PASS (2 Playwright tests, 11 runnable
  selections, 57/57 assertions, 1.7m), and `npm run verify:tauri` PASS. The
  release output includes `target/release/sys-monitor-tauri.exe` (9,251,840
  bytes); installer bundling remains the documented manual/tag policy.
- `openspec validate --all --strict --no-interactive`: PASS, 15/15 durable
  specs. `git diff --check`: PASS with no whitespace errors.

## Evidence policy

Each task below is checked only after its targeted test or static proof exists. Final entries will include exact commands, hosted run URLs/IDs, release-build output, and the real-hardware cadence environment/result. A missing physical multi-GPU or installer environment is recorded as `NOT-VALIDATED`, never as a pass.
