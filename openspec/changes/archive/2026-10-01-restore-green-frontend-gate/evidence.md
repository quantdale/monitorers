# Evidence — Restore Green Frontend Gate

Executor evidence for `restore-green-frontend-gate`. Every claim below is a command that was actually run in this repository; outputs are quoted verbatim (abbreviated only where marked).

- Host: Windows (`win32`), Node **v24.3.0**, repository npm **11.4.2** (global CLI used for day-to-day runs), npm **11.20.0** invoked via `npx` only to *re-resolve* the lockfile (see "Lockfile re-resolution" below).
- Change root: `openspec/changes/restore-green-frontend-gate/`
- Pre-change baseline commit: `efa2cd6`

## A. Pre-change baseline (tasks 1.1, 1.2)

### A1. Application-scoped audit — RED

```
$ cd sys-monitor-tauri && npm audit --json --audit-level=high ; echo $?
1

metadata.vulnerabilities = {"info":0,"low":0,"moderate":2,"high":1,"critical":0,"total":3}

@vitest/mocker | sev=moderate | direct=false | range=2.1.0 - 4.1.10  | fixAvailable=true
               | via=["Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock"]
undici         | sev=high     | direct=false | range=8.0.0 - 8.10.1  | fixAvailable=true
               | via=[11 advisories, e.g. "undici vulnerable to Denial of Service via unhandled
                      error in WebSocket permessage-deflate decompression", "undici vulnerable
                      to downstream response splitting via retry interceptor", ...]
vitest         | sev=moderate | direct=true  | range=2.1.0-beta.1 - 4.1.10 | fixAvailable=true
               | via=["@vitest/mocker", "Vitest: Path Traversal / Arbitrary File Read via
                      @vitest/mocker Redirect Mock"]
```

This matches the proposal's prediction exactly (undici high, vitest moderate/direct, `@vitest/mocker` moderate, all `fixAvailable: true`).

### A2. Repository-root audit — GREEN, and therefore misleading

```
$ cd <repo root> && npm audit --audit-level=high ; echo $?
found 0 vulnerabilities
0
```

The root workspace contains only `husky`; it cannot observe the application's transitive tree. This divergence is what let a red gate be recorded as green.

### A3. Resolution path at baseline

```
$ cd sys-monitor-tauri && npm ls undici jsdom vitest
sys-monitor-tauri@0.1.4
+-- jsdom@30.0.1
| `-- undici@8.10.0
`-- vitest@4.1.10
  `-- jsdom@30.0.1 deduped
```

### A4. Patched versions the registry actually offers (task 1.2)

| Package | Declared range | Highest patched | In range? |
|---|---|---|---|
| `vitest` | `^4.1.10` | `4.1.11` | yes |
| `@vitest/mocker` | (transitive, pinned to `vitest`'s version) | `4.1.11` | yes |
| `jsdom` | `^30.0.1` | `30.1.1` | yes |
| `undici` | transitive (`jsdom@30.0.1` declares `undici: ^8.9.0`) | `8.11.2` | yes |

`npm audit --json` independently reported `fixAvailable: true` for all three advisories, i.e. the fix is inside the declared ranges — a lockfile-level fix, **not** a manifest change.

## B. Lockfile re-resolution (tasks 1.3, 1.4, 1.5)

### B1. Why `npx npm@11.20.0` was used to produce the lockfile

The repository's npm **11.4.2** cannot re-resolve `vitest` at all on this tree:

```
$ npm update vitest
npm error Cannot read properties of null (reading 'edgesOut')
  at #loadPeerSet (…\@npmcli\arborist\lib\arborist\build-ideal-tree.js:1300:38)
  … npm error verbose unfinished npm timer idealTree:node_modules/vitest …
$ npm install --no-save vitest@4.1.11
npm error Cannot read properties of null (reading 'edgesOut')
$ npm audit fix --dry-run
npm error Cannot read properties of null (reading 'edgesOut')
```

This is an upstream Arborist defect triggered while loading vitest's optional peer set; it is **not** caused by anything in this repository, and it affects `vitest`, `jsdom` and `@vitest/mocker` but not `undici` (`npm update undici` succeeded under 11.4.2). npm **11.20.0** (still the npm 11 line, and the version that CI will pick up once Node is on ≥24.15) re-resolves the same tree without error, so it was used **only to regenerate `package-lock.json`**. Nothing about the resolution semantics changed: `--legacy-peer-deps` / `--force` / `overrides` were deliberately **not** used (design D1).

Recorded for the backlog: a future `npm install`/`npm update` on npm 11.4.2 cannot move the test toolchain. Root cause is the npm bug, not a manifest range.

### B2. Post-change resolution

```
$ cd sys-monitor-tauri && npm ls undici jsdom vitest
sys-monitor-tauri@0.1.4
+-- jsdom@30.0.1
| `-- undici@8.11.2
`-- vitest@4.1.11

$ npm audit --audit-level=high ; echo $?
found 0 vulnerabilities
0
```

### B3. No production/runtime dependency moved (task 1.5)

`git diff sys-monitor-tauri/package.json` — **no dependency entry changed at all** (the only addition is the new `audit:app` *script*). A per-entry comparison of the committed lockfile against the new one:

```
node_modules/@jridgewell/sourcemap-codec | 1.5.5 -> 1.6.0 | dev: true
node_modules/@types/estree               | 1.0.8 -> 1.0.9 | dev: true
node_modules/@vitest/expect               | 4.1.10 -> 4.1.11 | dev: true
node_modules/@vitest/mocker               | (nested) -> 4.1.11 (hoisted) | dev: true
node_modules/@vitest/pretty-format        | 4.1.10 -> 4.1.11 | dev: true
node_modules/@vitest/runner               | 4.1.10 -> 4.1.11 | dev: true
node_modules/@vitest/snapshot             | 4.1.10 -> 4.1.11 | dev: true
node_modules/@vitest/spy                  | 4.1.10 -> 4.1.11 | dev: true
node_modules/@vitest/utils                | 4.1.10 -> 4.1.11 | dev: true
node_modules/tinyrainbow                  | 3.1.0 -> 3.2.0 | dev: true
node_modules/undici                       | 8.10.0 -> 8.11.2 | dev: true
node_modules/vitest                       | 4.1.10 -> 4.1.11 | dev: true
node_modules/vitest/node_modules/@vitest/mocker | 4.1.10 -> (removed; hoisted) | dev: true
total changed entries: 13
```

Every changed entry carries `"dev": true`. No `dependencies` (runtime) entry and no `Cargo.lock` entry moved. `@vitest/mocker` is hoisted out of `node_modules/vitest/node_modules/` because 4.1.11 no longer conflicts with the hoisted `vite`.

## C. Gate is authoritative and unambiguous (tasks 2.1 – 2.4)

### C1. One-command reproduction (task 2.1)

`sys-monitor-tauri/package.json` gains `"audit:app": "npm audit --audit-level=high"`.

```
$ npm run audit:app
found 0 vulnerabilities
```

### C2. Scope-labelled steps (tasks 2.2, 2.3)

`scripts/verify.mjs::frontend()` now labels the two audit steps and carries a comment recording why the application scope is authoritative. It is the **first** step to throw, because `runNpm()` throws on a non-zero exit.

### C3. Proof that the lane is genuinely wired (task 2.4)

An artificial high advisory was introduced by temporarily adding `"undici": "8.10.0"` to `devDependencies`, installing, and running the real lane:

```
$ npm run verify:frontend
…
node_modules/undici
1 high severity vulnerability
…
Error: application npm audit (sys-monitor-tauri) failed with exit code 1
    at run (…/scripts/verify.mjs:16:34)
    at runNpm (…/scripts/verify.mjs:25:5)
    at frontend (…/scripts/verify.mjs:44:3)
VERIFY_FRONTEND_EXIT=1
```

The failure names the **application** scope, proving the app-scope exit status is what decides the lane. `package.json` and `package-lock.json` were then restored from the post-change snapshots, `npm install` re-run, and the audit re-confirmed green (`found 0 vulnerabilities`, exit 0).

`verify:fast` embeds `frontend()` as its **first** step (`case 'fast': frontend(); rust();`), so the same failure aborts `verify:fast` before any Rust work begins.

## D. Test-toolchain re-qualification (tasks 3.1 – 3.4)

### D1. Full unit suite

```
$ npm test -- --run
 Test Files  20 passed (20)
      Tests  248 passed (248)
```

Two non-green runs were observed and are recorded rather than hidden:

| Run | Toolchain | Result |
|---|---|---|
| 1 | vitest 4.1.11 | `src/cards/renderCardContent.test.tsx > gpu card with nvidia data …` **timed out at 20 s** (247 passed / 1 failed); 1 file ran 25.1 s |
| 2 | vitest 4.1.11 | 9 files / 99 tests reported passed, **11 unhandled errors**, exit 1 (worker-level teardown errors, no assertion failures) |
| 3 | vitest 4.1.11 | 20 files / 248 tests passed, exit 0 |
| 4 | vitest 4.1.11 | 20 files / 248 tests passed |
| 5 | vitest 4.1.11 | 20 files / 248 tests passed |
| 6 | vitest **4.1.10** (pre-upgrade lockfile restored) | 20 files / 248 tests passed |
| 7 | vitest **4.1.10** | 20 files / 248 tests passed |
| 8 | vitest 4.1.11 (restored) | 20 files / 248 tests passed |
| 9 | vitest 4.1.11 | 20 files / 248 tests passed |

Triage: both non-green runs occurred **immediately after a lockfile write that rewrote `node_modules`** — i.e. under cold-cache disk contention while 20 jsdom environments were being constructed (the runs report cumulative `environment` time of 645 s and 488 s). `src/cards/renderCardContent.test.tsx` passes in isolation (`11 passed`, tests 1.08 s). No assertion was edited, no timeout was raised, and no test was skipped. The identical flake was previously triaged the same way during the dependency campaign (`dependency-runtime-modernization-and-qualification/evidence.md` §A: "renderCardContent.test.tsx … timed out at 20 s during a cold-cache run"). Conclusion: **environment/load flake, not a toolchain regression.**

### D2. DOM-environment-dependent suites (task 3.2)

```
$ npx vitest run src/components/ErrorBoundary.test.tsx src/components/HardwareSidebar.test.tsx \
    src/components/MetricChart.test.tsx src/cards/renderCardContent.test.tsx \
    src/hooks/useSettings.test.ts src/hooks/useMetrics.hook.test.ts
 Test Files  6 passed (6)
      Tests  65 passed (65)
```

They still exercise real behaviour, verified with `--reporter=verbose`: real React error-boundary fallback + retry-cooldown timing (`ErrorBoundary` 160 ms / 54 ms / 20 ms), real DOM rendering and `[data-sb-id]` attribute assertions (`HardwareSidebar (render)`, 275 ms / 117 ms), and a real React.memo render-fan-out guard that counts commits (`MetricChart`, 166 ms). None of these can pass if the jsdom/vitest environment stopped working.

### D3. Typecheck, production bundle (task 3.3)

```
$ npx tsc --noEmit ; echo $?
0
$ npm run build ; echo $?
✓ built in 2.85s
BUILD_EXIT=0
$ grep -rlE "vitest|jsdom|undici" dist/assets
(no matches)
```

No test-tooling package enters `dist/`.

### D4. Simulation typecheck and mock lane (task 3.4)

```
$ npm run sim:typecheck ; echo $?
SIMTS_EXIT=0
```

`npm run sim` (mock matrix, 16 journeys) — **the journey assertions all pass on every run; a pre-existing host-level teardown flake fails some journeys.** Measured:

| Run | Lockfile | Outcome |
|---|---|---|
| 1 | vitest 4.1.11 | 12/16 journeys PASS, 4 FAIL **only** on `harness cleanup/isolation diagnostics failed: driver close failed: browser.close timed out after 15000ms` / `trace cleanup failed: tracing.stop timed out after 15000ms`; the failing lines read e.g. `FAIL (16/16)` — 16 of 16 assertions passed |
| 2 | vitest 4.1.11 | 14/16 PASS, 2 FAIL on the same teardown timeouts (`FAIL (9/9)`, `FAIL (40/40)`) |
| 3 | vitest 4.1.11, journeys `customization-roundtrip,persona-free-roam` | 4/4 PASS |
| 4 | **vitest 4.1.10 (pre-upgrade lockfile)** | 4/4 PASS |
| 5 | vitest 4.1.11, journeys `customization-roundtrip,persona-free-roam` | 4/4 PASS |
| 6 | vitest 4.1.11, journeys `customization-roundtrip,persona-free-roam` | 4/4 PASS |
| 7 | vitest 4.1.11, **full 16-journey matrix** | 15/16 PASS, 1 FAIL on the same teardown timeout (`FAIL (43/43)`) |
| 8 | **vitest 4.1.10 (pre-upgrade lockfile)**, **full 16-journey matrix** | **13/16 PASS, 3 FAIL on the same teardown timeouts** (`FAIL (10/10)`, `FAIL (17/17)`, `FAIL (37/37)`) |

**Decisive comparison: runs 7 and 8 are the same full matrix on the same host minutes apart, differing only in the lockfile — and the pre-upgrade lockfile fails *more* journeys (3) than the upgraded one (1).** The upgrade therefore does not degrade the simulation lane.

Root cause is outside this change: `MockHarnessDriver` bounds `browser.close()` and `tracing.stop()` at 15 s, and on this host (a personal Chrome session plus ~55 Node processes resident) Chromium occasionally exceeds that bound during teardown, most often for the longest journey at the end of the matrix. `@playwright/test` is not part of this change's dependency movement, so no mechanism exists by which a `jsdom`/`vitest`/`undici` bump could affect it. Recorded as a pre-existing host-capacity limitation and carried to the backlog; not fixed here, because no task in this change covers harness teardown robustness.

## E. Documentation (task 4)

- `progress.md` — the "Final local qualification" line previously read "`npm audit` 0". It now names **both** scopes, the exact commands, both exit statuses, the pre-change failure (`3 vulnerabilities (2 moderate, 1 high)`, exit 1) and the post-change result (`found 0 vulnerabilities`, exit 0), with a pointer to the `audit:app` entry point.
- `AGENTS.md` — the CI-gate section gained an explicit "two scopes" bullet stating that the application scope is authoritative and that neither may be reported unqualified.
- `CLAUDE.md` — the "CI readiness gate" section gained the matching paragraph.
- No `src/**` or `src-tauri/**` product file was modified (verified in §F).