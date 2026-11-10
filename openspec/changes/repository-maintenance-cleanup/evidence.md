# Evidence — repository-maintenance-cleanup

## Baseline (before any change, verified `main` at `4781f8a`)

| Lane | Command | Result |
|---|---|---|
| Frontend gate | `node scripts/verify.mjs frontend` | PASS — 24 files, **312 tests**, both audit scopes 0 vulnerabilities, both typechecks, oxlint, build |
| Rust gate | `node scripts/verify.mjs rust` | PASS — fmt, **208/208/189/202/200** across the five feature matrices, clippy `-D warnings`, `cargo audit` exit 0 with 3 dispositioned informational warnings |
| E2E | `node scripts/verify.mjs e2e` | PASS — **46/46** |
| OpenSpec | `npx openspec validate --all --strict` | 25/25 |

Both lanes were green *while the repository contained two dead exports*, which is the defect this change fixes.

## 1. The gate defect, proved

**A. The committed gate reported a clean tree that was not clean.**
A copy of `check-dead-code.mjs` with comment stripping added and everything else held constant reported two symbols the committed gate did not:

```
[test-only] ts sliceWindow      src/hooks/useMetrics.ts:252
[chain]     ts clearSimScenario src/sim/mockBackend.ts:282
```

Both "references" were prose in the same file: `sliceWithRange`'s doc comment said "identical to `sliceWindow`", and `readSimScenario`'s doc said journeys clear state "via `clearSimScenario()`" — they did not. Verified by grep: `sliceWindow` had references only in `useMetrics.test.ts`; `clearSimScenario` had zero references anywhere in `src/`, `e2e/`, or `scripts/`.

**B. Red-capability of the corrected gate, on the real tree (not a fixture).**
Appending a dead export to `src/utils.ts`:

```
$ node scripts/check-dead-code.mjs
dead-code check FAILED — 1 unreferenced first-party symbol(s):
  [dead] ts __mutationProbeDead — referenced nowhere (sys-monitor-tauri\src\utils.ts:32)
```

Appending a dead export *and* a comment naming it in the same file:

```
$ node scripts/check-dead-code.mjs
dead-code check FAILED — 1 unreferenced first-party symbol(s):
  [dead] ts __probeViaComment — referenced nowhere (sys-monitor-tauri\src\utils.ts:31)
```

That second probe is the regression guard for the exact shipped defect: before the fix, the comment alone would have made `__probeViaComment` pass. Both probes restored the file immediately; `git diff` confirmed a clean `src/utils.ts` after each.

**C. Literal-preservation probes** (the stripping must not trade one false verdict for another). Line counts and content were compared on the whole first-party tree — 14 Rust modules plus the TS/TSX sources, `0` mismatches:

- `'http://127.0.0.1:5180'` inside strings in 6 files survived verbatim, and `src/sim/harness.trust.test.ts` still contains the two URL literals whose `//` a naive stripper would have eaten.
- Rust raw strings (`r#"{"elapsed_ms":0,…}"#` in `cadence.rs`), `'/'`/`'\n'` char literals, and `&'static str` lifetimes survived.
- The 5 JSX apostrophe sites (`Couldn't load settings …`, `Couldn't refresh metrics history …`) kept their real trailing code — the first attempt's scanner swallowed those lines, which is why the single-quote rule requires a same-line partner.
- `disks/Unknown(-1)` etc. unaffected (Rust, no stripping hazard).

**D. Scanner unit coverage** — new `scripts/dead-code-scan.test.mjs`, executed by the canonical Vitest project:

```
$ npx vitest run scripts/dead-code-scan.test.mjs
Test Files  1 passed (1)
     Tests  17 passed (17)
```

It pins: comment-only reference reported dead; a real reference preserved; test-only reported as test-only; dead chain reports both members with the root labelled `referenced nowhere`; allowlist by exact name and by substring; URL/template/escaped-string/raw-string/char-literal/lifetime/JSX-apostrophe survival.

## 2. Removal of the two symbols

- `sliceWindow` and `sliceWithRange` had **byte-identical bodies** (only the visibility and the parameter list differed); production called only the private one. Merged into one exported `sliceByRange(arr, timestampCount, range)`, called from the `useMetrics` windowed memo. No behaviour change: same empty-channel short-circuit, same `null`-range passthrough, same tail alignment, same overlap test.
- `clearSimScenario` deleted; `readSimScenario`'s comment corrected to state why nothing needs to clear the handoff entry (unique run id + fresh browser context per run).
- Result: `dead-code check: 439 first-party symbols enumerated (146 Rust, 293 TypeScript), 0 unreferenced (1 allowlisted with reasons)`.
- New windowing tests: `timestampWindowRange` (selection, whole-span, empty ring, non-positive/non-finite window, forward walk to the first real sample, cutoff strictly between samples) and `sliceByRange` (pre-derived range, tail alignment, `null` range, empty channel, non-overlapping range) — 10 tests, `useMetrics.test.ts` 45/45.

Two allowlist entries deleted after proving the gate's verdict does not change: `lib.rs pub use (library facade)` (cannot match any symbol — `k.includes(name)` is false for a key containing no symbol name) and `disk_display_name` (a genuine `main.rs` caller). Removing both left `0 unreferenced` intact.

## 3. Rust duplication

`SysDiskKind → DiskKind` existed twice: `hardware.rs::disk_infos_from` and `main.rs`'s startup profile builder (line-for-line the same match). Both now call `hardware::disk_kind_of`. New test `test_disk_kind_of_is_the_single_sysinfo_mapping` pins SSD, HDD, `Unknown(0)`, `Unknown(-1)`.

`cargo fmt -- --check` → clean. Rust test totals moved **+1** in every matrix (the new test): 209 / 209 / 190 / 203 / 201.

## 4–5. Documentation and clutter

- `.cursorrules` (line 147) and `CLAUDE.md` (line 59) named `detect()`; there is no such item — `grep -rn "pub fn detect"` finds only `detect_with_cpu`. Both now list `detect_with_cpu`, `disk_infos_from`, `disk_kind_of`.
- `CONTEXT.md` said the 300-point budget lived in `chartPoints.ts`; it lives in `MetricCard.tsx:22` and is passed *in* to `computeChartPoints` as `maxPoints`.
- `e2e/exploratory-register.md` pointed at "(see the 2026-08-26 update above)"; that file has only 2026-08-04 and 2026-08-21 sections. Now names the journey file and the archived qualification that evidences it.
- `opsx-remediation-evidence.md` presented 2026-08-03 counts (109 Rust / 111 frontend) as current. Now marked historical, pointing at `progress.md` and the canonical commands.
- `deep review resolve.txt`: 819 lines, md5 `b97e4ebbb6a46c63b79ac4d4a01d4943` — **identical** to `CopyIt/deep review resolve.txt` and `tryMC_v3/deep review resolve.txt`, containing no repository-specific term (no "monitorers", "tauri", "PDH", "React"), and referenced by nothing in the tree. Removed.
- `src/assets/react.svg` and `public/tauri.svg`: zero references in source or config (`index.html` uses `/vite.svg`). Removed. The then-empty `src/assets/` directory was removed too.
- Root `package.json` declared `"main": "index.js"`; no `index.js` exists (the package is scripts-only). Replaced with `"private": true`; `npm install --package-lock-only` left the lockfile byte-compatible (`found 0 vulnerabilities`).
- `src/sim/mockBackend.test.ts` hard-coded the schema literal `6` in two places beside a sibling test that pins the same value to `EXPECTED_SCHEMA_VERSION`. Both now use the import, so a version bump cannot leave a stale copy silently passing.

## 6. Final validation (after every change)

| Lane | Command | Result |
|---|---|---|
| Dead-code | `node scripts/check-dead-code.mjs` | 440 symbols, **0 unreferenced**, 1 allowlisted |
| Scanner tests | `npx vitest run scripts/dead-code-scan.test.mjs` | 17/17 |
| Frontend gate | `node scripts/verify.mjs frontend` | **exit 0** — version + 10 documentation-fidelity claims, dead-code, both audit scopes 0 vulnerabilities, `tsc --noEmit`, `typecheck:test`, oxlint, **335 tests in 25 files**, production build 866 ms |
| Rust gate | `node scripts/verify.mjs rust` | **exit 0** — fmt clean, **209/209/190/203/201** across the five matrices, clippy `-D warnings` clean, `cargo audit` exit 0 with the same 3 informational warnings |
| E2E | `node scripts/verify.mjs e2e` | **46/46 passed (1.7 m)** |
| Sim | `npm run sim:typecheck`, `npm run sim` | typecheck clean; **4/4** mock journeys PASS |
| OpenSpec | `npx openspec validate --all --strict` | **26/26** (25 archived/current specs + this change) |

Baseline → final: frontend **312 → 335** tests (+23: 10 windowing, 17 scanner, minus the 4 removed `sliceWindow` cases), Rust **208 → 209** (+1 mapping test). No test was deleted, weakened, or skipped; every removed assertion was replaced by direct coverage of the same contract.

## Not claimed

The packaged/real-candidate lanes (`verify:tauri`, `verify:packaged`, `sim:real`) were **not** run for this change and are not claimed: nothing in it touches the collector, IPC contract, schema versions, persisted settings, or the packaged app's runtime behaviour, and both of those lanes are dispatch-only/expensive by repository policy. Hosted CI results are not claimed either — see the delivery section of the campaign report for what was pushed and what the remote shows.
