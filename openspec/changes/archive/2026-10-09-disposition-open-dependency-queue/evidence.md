# Evidence — Disposition the open dependency queue

All commands run on Windows in `D:\Documents\tryPython\monitorers` on branch
`agent/monitorers-dependency-queue-2026-10-09`, which starts from the local
`main` head `b2ef5d7` (itself ahead of `origin/main`, which is the pre-campaign
state — the follow-up campaigns of 2026-10-08 are local commits).

## 1. Queue at campaign start (2026-10-09)

| PR | Group | Package(s) | From → To | Required checks at start |
|---|---|---|---|---|
| 35 | ui-libraries | lucide-react | 1.34.0 → 1.48.0 | `Frontend — verify` **FAILURE** |
| 37 | github-actions | actions/download-artifact, taiki-e/install-action | 4.1.8 → 8.0.1 / 2.86.7 → 2.87.21 | green |
| 38 | test-dom-tooling | @playwright/test, jsdom, vitest | 1.62.1 → 1.63.0 / 30.0.1 → 30.1.1 / 4.1.10 → 4.1.11 | green |
| 39 | collector-platform | nvml-wrapper | 0.12.1 → 0.13.0 | green |
| 40 | react-framework | react, react-dom, @types/react, @types/react-dom | 19.2.8 → 19.3.0 | green |
| 41 | build-tooling | @vitejs/plugin-react, vite | 6.1.0 → 6.1.1 / 8.2.2 → 8.3.1 | green |
| 42 | tauri-runtime (Rust) | tauri, tauri-plugin-store, tauri-build | 2.11.5 → 2.12.0 | green |
| 43 | tauri-js | @tauri-apps/api, plugin-store, cli | 2.11.1 → 2.12.0 / 2.4.4 → 2.5.0 | `Windows — production executable` **FAILURE** |
| 44 | types/node | @types/node | 24.13.3 → 26.6.3 | green |

## 2. Root cause of the two failures (`gh run view <id> --log-failed`)

**#35 `Frontend — verify`** — the failing step was
`release version + documentation consistency`:

```
Error: documented dependency versions in .cursorrules §1 disagree with the committed manifests:
Error: release version + documentation consistency failed with exit code 1
```

`scripts/check-version.mjs` compares the documented `major.minor` ranges against
`package.json` / `Cargo.toml`, so any adopted bump that changes a `major.minor`
also has to update `.cursorrules` §1. The bump was fine; the PR could not know
about the documentation obligation. This is why every adoption stage in this
campaign updates the table **in the same commit**.

**#43 `Windows — production executable`** — `tauri build` compiles the frontend
bundle against the Rust crates in one pass, so a JS-only Tauri bump is a version
skew. The Rust half has to move at the same time. Evidence that the combined
stage fixes it: `npm run verify:tauri` on this branch finishes
`Finished \`release\` profile [optimized] target(s) in 6m 02s` and reports
`Built application at: ...\target\release\sys-monitor-tauri.exe`.

## 3. Dispositions

| PR | Disposition | Commit | Qualifying evidence |
|---|---|---|---|
| 35 | **Adopted** (lucide-react 1.48.0) | `e37682c` | see §4 |
| 37 | **Adopted** | `a8bc2a3` | YAML parse + pin audit; version bodies verified from the upstream release notes (download-artifact v8 ESM + hash-mismatch errors by default) |
| 38 | **Adopted** | `e37682c` | see §4 |
| 39 | **Adopted** (nvml-wrapper 0.13.0, nvml-wrapper-sys 0.10.0) | `a8bc2a3` | `npm run verify:rust` exit 0 |
| 40 | **Adopted** (React 19.3.0 + matching 19.3.0 types) | `e37682c` | see §4 |
| 41 | **Adopted** (Vite 8.3.1 + plugin-react 6.1.1) | `e37682c` | see §4 |
| 42 | **Adopted** (with #43, as one stage) | `0012082` | `verify:rust` + `verify:tauri` exit 0 |
| 43 | **Partially adopted**: API + CLI yes, plugin-store **no** | `0012082` | §5 |
| 44 | **Deferred** with a recorded revisit condition | — | §6 |

PRs 35, 37, 38, 39, 40, 41, 42, 43 were closed through the GitHub API
(`gh pr close`) with a comment naming the adopting commit or the reason for the
partial adoption. #44 was left open with a comment naming the deferral and the
condition to revisit.

## 4. Frontend stage qualification

| Command | Result |
|---|---|
| `npm run verify:frontend` | exit **0** — version consistency OK, documentation fidelity **11/11** `.cursorrules` §1 claims match the manifests, dead-code check, root audit `found 0 vulnerabilities`, application audit `found 0 vulnerabilities`, `tsc --noEmit` clean, `tsc -p tsconfig.test.json` clean, **281 passed (281)** unit tests in 21 files, `vite build` ✓ 2486 modules in 4.05s |
| `npm run e2e` | **22 passed (22)** |
| `npm run sim:typecheck` | exit 0 |
| `npm run sim` | **4 passed (3.4m)** — degraded-startup 4/4, fault-freeze-recovery 3/3, layout-persistence 6/6, persona-free-roam 12/12 + 35/35 |

A note on the E2E lane: the first run after adopting `@playwright/test` 1.63.0
failed for every spec with
`browserType.launch: Executable doesn't exist at ...\chromium_headless_shell-1243\...`.
That is the expected local consequence of a Playwright minor bump (the bundled
Chromium revision changes), and the workflow already models the fix: it runs
`npx playwright install chromium` before the suite. Running that locally made
all 22 tests pass. No test or product code was changed to accommodate it.

## 5. Why `@tauri-apps/plugin-store` 2.5.0 was not adopted

```
$ cargo info tauri-plugin-store
version: 2.4.4 (latest 3.0.0-alpha.2)
```

The Rust crate has no stable line above **2.4.4**; 3.0.0 is a pre-release. The JS
package's 2.5.0 has no matching stable Rust counterpart, so moving it alone would
put the settings store — the app's persistence contract, with its own schema
version, serialized writes and future-version fail-closed behaviour — on an
untested protocol boundary for no benefit. The pair stays 2.4.4 (JS) / 2.4.4
(Rust), which is the combination the app is running and has been qualified on.

## 6. Why `@types/node` 26.6.3 is deferred

- The Node runtime is 24.3.0 locally and `node-version: '24'` in every workflow.
- `dependabot.yml` keeps `@types/node` **ungrouped** precisely so this major stays
  independently attributable.
- Type definitions for a runtime the project does not run would let code compile
  against APIs that cannot exist at runtime.

Revisit condition: move the Node runtime to 26, then adopt in the same change.
A comment recording exactly this was left on PR #44, which stays open.

## 7. Workflow pin audit

```
rust.yml:                    7 action refs, all full 40-hex SHAs
e2e.yml:                     4 action refs, all full SHAs
simulation.yml:              9 action refs, all full SHAs
release-qualification.yml:  16 action refs, all full SHAs
dependency-audit-watch.yml:  2 action refs, both full SHAs
```

The three pin comments above the `download-artifact` steps named the
**upload-artifact** SHA and version rather than the action they annotate; they
were corrected to `# v8.0.1 — 3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` while the
pins moved. Version numbers for the new pins were taken from the upstream release
notes and confirmed by resolving the tags through the GitHub API
(`actions/download-artifact` → **v8.0.1**), never typed from memory.

## 8. Final whole-change verification

| Command | Result |
|---|---|
| `npm run verify:fast` | exit **0** (197 s) — frontend lane (version + 11/11 doc fidelity, dead-code, both audits, two typechecks, 281 unit tests, production build) plus the five-matrix Rust gate (fmt, `cargo test` ×5, clippy `-D warnings`, `cargo audit`) |
| `npx openspec validate --all --strict` | **23 passed, 0 failed** |
| `git diff --check` | 0 whitespace errors |

## Limitations

- `@playwright/test` 1.63.0's new Chromium revision had to be installed locally
  (`npx playwright install chromium`); CI already does this as a workflow step, so
  no workflow change was needed, but the local browser cache is one revision
  further ahead than a fresh CI runner's.

### Hosted qualification (PR #45, head `e94d266`)

The branch was pushed as `origin/agent/monitorers-dependency-queue-2026-10-09`
and PR #45 was opened against `main` so the required workflows would run against
the adopted stack. All required checks succeeded:

| Run ID | Workflow / job | Result | Head |
|---|---|---|---|
| 37834212019 | Rust and release — `Rust — verify` | completed / **success** | `e94d266` |
| 37834212019 | Rust and release — `Frontend — verify` | completed / **success** | `e94d266` |
| 37834212019 | Rust and release — `Windows — production executable` | completed / **success** | `e94d266` |
| 37834211907 | E2E Verification Harness | completed / **success** | `e94d266` |
| 37834211907 | (within the E2E run) `Simulation — config lint` | completed / **success** | `e94d266` |
| 37834211917 | Simulation — `Simulation — mock lane` | completed / **success** | `e94d266` |

`Windows — production executable` succeeding is the hosted proof for the Tauri
stage: it is the same job that failed on JS-only PR #43. `Simulation — packaged
lane` and `Windows — MSI and NSIS bundle` are `skipped` by policy (dispatch/tag
only), so the packaged real-app lane and installer qualification are **not**
covered by this run and are not claimed here.

Local `verify:packaged` for this stack was run separately and passes
(`2026-10-09-keep-packaged-lane-schema-assertion-current`), which also required
fixing a stale schema assertion found on the way; `assert:webview2-policy-absent`
exits 0 after that run.
