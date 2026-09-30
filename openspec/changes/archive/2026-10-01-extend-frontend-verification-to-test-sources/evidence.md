# Evidence — Extend Frontend Verification to Test Sources

- Change root: `openspec/changes/extend-frontend-verification-to-test-sources/`
- Host: Windows, Node v24.3.0, npm 11.4.2 / 11.20.0, 20 logical CPUs.

## A. The gap (proposal, confirmed)

```
sys-monitor-tauri/tsconfig.json
  "include": ["src"],
  "exclude": ["src/sim", "src/**/*.test.ts", "src/**/*.test.tsx"]

sys-monitor-tauri/e2e/tsconfig.sim.json
  "include": ["./sim/**/*.ts", "../src/**/*.ts"],
  "exclude": ["../src/**/*.test.ts", "../src/**/*.test.tsx"]
```

Every typecheck entry point (`npm run typecheck`, `npm run build`, `verify:frontend`, `npm run sim:typecheck`) used one of those two projects, and both exclude the Vitest sources. Before this change, **15 application test files plus 4 simulation-bridge test files were compiled by no `tsc` invocation in any lane**; esbuild transpiles them inside Vitest without checking types.

## B. The new project (tasks 1.1 – 1.4)

`sys-monitor-tauri/tsconfig.test.json` (new):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["vitest/globals", "node"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["src/sim/**", "e2e/**"]
}
```

- `extends` inherits `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, the DOM libs and `moduleResolution: bundler` — nothing is relaxed.
- `include` replaces the parent's and names **no test glob**, so every `*.test.ts(x)` under `src` is compiled.
- `exclude` names only trees owned elsewhere: `src/sim/**` and `e2e/**` both belong to `e2e/tsconfig.sim.json`.
- `types: ["vitest/globals", "node"]` makes the `globals: true` Vitest API (`describe`/`it`/`expect`) resolve; `node` is needed because the setup file and the simulation seams run in a Node context.
- New script `"typecheck:test": "tsc -p tsconfig.test.json --noEmit"`.

### Program contents (proof the tests are really in the program)

```
$ npx tsc -p tsconfig.test.json --noEmit --listFiles | grep '\.test\.tsx?$'
src/cardIdentity.test.ts
src/cards/formatters.test.ts
src/cards/renderCardContent.test.tsx
src/chartPoints.test.ts
src/components/ErrorBoundary.test.tsx
src/components/HardwareSidebar.test.tsx
src/components/MetricChart.test.tsx
src/hooks/useCardOrderInitialization.test.ts
src/hooks/useHardwareProfile.hook.test.ts
src/hooks/useMetrics.hook.test.ts
src/hooks/useMetrics.test.ts
src/hooks/useSettings.errors.test.ts
src/hooks/useSettings.persistence.test.ts
src/hooks/useSettings.test.ts
src/utils.test.ts
```

`src/sim/mockBackend.ts` is additionally pulled in transitively (it is imported by `src/hooks/useMetrics.ts`); `tsc` always follows imports, so `exclude` cannot prevent that, and it is correct for it to be checked.

### Negative control — the gate is not vacuous

A deliberate type error was appended to `src/utils.test.ts`:

```ts
const __neg: number = "not-a-number";
```

```
$ npm run typecheck:test
src/utils.test.ts(77,7): error TS2322: Type 'string' is not assignable to type 'number'.
EXIT=1

$ npm run typecheck          # production project, tests excluded
PROD_EXIT=0
```

This is the exact failure mode the proposal predicted: previously invisible, now blocking. The file was restored from a snapshot and `npm run typecheck:test` returns to exit 0.

## C. Real type errors found and fixed (tasks 2.1 – 2.4)

```
$ npm run typecheck:test ; echo $?
TYPECHECK_TEST_EXIT=0
```

**Zero** type errors were reported. No `as any`, no `@ts-expect-error`, no `@ts-ignore`, no `strict` relaxation was needed or used. This is a real result, not a skipped check: §B's negative control proves the project actually compiles the test files, and §D's coverage audit proves no test file is still outside it.

Task 2.3's "record a genuine production/test type mismatch" case therefore has no findings. Task 2.4 is confirmed: `npm run typecheck` still passes unchanged.

## D. Coverage reconciliation (task 5.2)

`e2e/tsconfig.sim.json` was changed to own exactly what is left, and no longer double-counts application sources:

```json
"include": ["./sim/**/*.ts", "./tests/**/*.ts", "../src/sim/**/*.ts", "./playwright.config.ts", "./qualify.playwright.config.ts"],
"exclude": []
```

Before this change that project included `../src/**/*.ts` while excluding `../src/**/*.test.ts(x)` — which meant the four `src/sim/*.test.ts` files (`harness.reporting`, `harness.trust`, `mockBackend`, `simConfig`) were covered by **no** project at all. Adding `../src/sim/**/*.ts` and dropping the app-wide glob closes that hole, and including `./tests/**/*.ts` plus the two Playwright config files closes a second, pre-existing hole.

### Full audit of every first-party `.ts`/`.tsx` (script-driven, reproducible)

```
first-party .ts/.tsx on disk: 73
covered by >=1 project: 73
UNCOVERED: (none)
```

Every test file and its owning project:

| Test file | Owning project |
|---|---|
| `src/cardIdentity.test.ts`, `src/chartPoints.test.ts`, `src/utils.test.ts` | `tsconfig.test` |
| `src/cards/formatters.test.ts`, `src/cards/renderCardContent.test.tsx` | `tsconfig.test` |
| `src/components/ErrorBoundary.test.tsx`, `HardwareSidebar.test.tsx`, `MetricChart.test.tsx` | `tsconfig.test` |
| `src/hooks/useCardOrderInitialization.test.ts`, `useHardwareProfile.hook.test.ts`, `useMetrics.hook.test.ts`, `useMetrics.test.ts`, `useSettings.errors.test.ts`, `useSettings.persistence.test.ts`, `useSettings.test.ts` | `tsconfig.test` |
| `src/sim/harness.reporting.test.ts`, `harness.trust.test.ts`, `mockBackend.test.ts`, `simConfig.test.ts` | `tsconfig.sim` |
| `e2e/sim/drivers/RealAppDriver.close.test.ts` | `tsconfig.sim` |

Application *implementation* files necessarily appear in both `tsconfig.json` and `tsconfig.test.json`: a project that compiles a test file must also compile what it imports. That is cross-project, not intra-lane, and no **single** lane step compiles a file twice.

## E. Gate wiring and cost (tasks 3.1 – 3.3)

`scripts/verify.mjs::frontend()` now runs, in order: documentation/release consistency → repository-root audit → **application audit** → `frontend typecheck` → **`frontend test-source typecheck`** → unit tests → build.

- CI: `.github/workflows/rust.yml`'s `frontend` job runs `npm run verify:frontend` (`grep` confirms `run: npm run verify:frontend`), so CI executes the new step.
- `.husky/pre-push` runs `verify:fast`, whose first action is `frontend()`, so pre-push executes it too.
- Placement: immediately after the production typecheck, i.e. before the unit tests and the production build — it fails fast.

Measured wall clock (3 runs, warm):

```
typecheck:test   6733 ms / 5412 ms / 5701 ms   (mean ≈ 5.9 s)
typecheck (prod) 7813 ms / 6840 ms
```

**Added cost ≈ 6 s per frontend-lane invocation** — ~7 % of the ~90 s frontend lane and negligible against the multi-minute Rust matrix inside `verify:fast`/`verify:full`. No new dependency was added.

## F. Lint decision (tasks 4.1 – 4.3)

### The measurement the design demands (D3, option 1 vs option 2)

The design makes this a data-based decision: adopt a linter if it can be made clean without out-of-scope churn, otherwise record the gap. The decision was reached by actually attempting the install:

```
$ npx npm@11.20.0 install -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks
npm error
# npm resolution error report
# While resolving: sys-monitor-tauri@0.1.4
# Found: typescript@7.0.2
# Could not resolve dependency:
# peer typescript@">=4.8.4 <6.1.0" from typescript-eslint@8.71.0
# Fix the upstream dependency conflict, or retry this command with --force or
# --legacy-peer-deps to accept an incorrect (and potentially broken) resolution.
```

The peer range is not a transient artefact of one release:

```
$ npm view typescript-eslint version            → 8.71.0   (latest)
$ npm view typescript-eslint peerDependencies   → typescript: ">=4.8.4 <6.1.0"
$ npm view typescript-eslint@>=8 peerDependencies.typescript
…8.68.0 8.69.0 8.70.0 8.70.1 8.71.0 all → '>=4.8.4 <6.1.0'
```

**No published `typescript-eslint` supports TypeScript 7**, which this repository is pinned to (`typescript ^7.0.2`, adopted by the dependency campaign). Adopting ESLint therefore requires `--force` or `--legacy-peer-deps`, i.e. an *explicitly incorrect* dependency resolution that the repository's own rules forbid ("Never weaken tests/security/identity/cadence contracts merely to accept a dependency update"). `eslint-plugin-react-hooks` cannot substitute: ESLint's default parser cannot parse `.ts`/`.tsx`.

The failed install left no trace (`package.json` and `package-lock.json` verified byte-identical before/after).

### Decision: option 2 — no linter in this change

- `src/components/MetricCard.tsx`: the inert `// eslint-disable-next-line react-hooks/exhaustive-deps -- …` line is replaced by a plain comment recording that the dependency array is intentionally partial (`hasSecondary ? secondaryHistory : undefined`, because the secondary channel is not read at all when `hasSecondary` is false), and stating that no linter enforces exhaustive-deps here so the absence of a suppression is deliberate, not an oversight. No logic changed — the only diff in this file is the comment.
- **Recorded gap:** frontend linting is currently unenforced; `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps` are not run by any lane. Adopting them is blocked upstream by `typescript-eslint`'s TypeScript peer range and should be revisited when `typescript-eslint` supports TS 7 (or when the repo moves off TS 7).

## G. Documentation (task 5.1)

- `AGENTS.md` CI-gate line now lists `npm run typecheck:test`, explains which project owns which tree, states the "every first-party `.ts`/`.tsx` is covered" property, and records the lint gap with its upstream blocker.
- `CLAUDE.md` command list gained `npm run typecheck:test` and `npm run sim:typecheck`; the "CI readiness gate" section gained the three-project ownership paragraph and the lint decision.
- `.cursorrules` "When frontend files are changed" gained the command and the same explanation, so the architectural source of truth matches.

## H. Verification results (tasks 5.3 – 5.5)

```
$ npm run typecheck:test        → 0
$ npm run typecheck             → 0
$ npm run sim:typecheck         → 0
$ npm run build                 → 0
$ npx vitest run --maxWorkers=3 → Test Files 20 passed (20) / Tests 248 passed (248)
```

**Host condition recorded honestly.** `npm run verify:frontend` could not be completed as a single end-to-end invocation late in this session because the machine ran out of physical memory:

```
FreePhysicalMemory : 22 MB / TotalVisibleMemorySize : 32488 MB
```

At that moment the largest consumers were **other projects running concurrently on the same host**, none of which belong to this repository's work: `vmmemWSL` 6.9 GB, 51 `node.exe` processes 6.8 GB (pi-coding-agent sessions, plus `brain-training`'s `jest-worker` children and `Inspector`'s vitest workers), Chrome 1.7 GB, Edge 1.7 GB.

The direct symptom under that pressure was vitest failing to fork workers at all:

```
Error: [vitest-pool]: Failed to start forks worker for test files
       …/src/components/HardwareSidebar.test.tsx
Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
```

Vitest defaults to one worker per logical CPU (20 here); with <1.5 GB free that is unviable. Constraining the pool to 3 workers gives the same result with a quarter of the environment churn — cumulative `environment` time drops from ~650 s to ~131 s:

| Run | Result |
|---|---|
| default pool (20 workers), 1.2 GB free | `20 passed` / `248 passed`, duration 24.7 s, environment 271 s |
| default pool (20 workers), 22 MB free | 1–4 failures: `Test timed out in 20000ms` in `renderCardContent.test.tsx`; one run reported only 9 of 20 files and 11 pool errors |
| `--maxWorkers=3`, memory constrained | `20 passed` / `248 passed`, duration 62.6 s, environment 131 s |

This is the **same** host condition that produced the intermittent `tracing.stop` / `browser.close` timeouts recorded in `restore-green-frontend-gate/evidence.md` §D4, and it is not caused by any change in this working tree. Every individual step of the lane (documentation consistency, both audits, production typecheck, test-source typecheck, unit tests, build) was executed and is green; the full-lane rerun is the one item still pending a memory-available window.

## I. Files touched

`sys-monitor-tauri/tsconfig.test.json` (new), `sys-monitor-tauri/e2e/tsconfig.sim.json`, `sys-monitor-tauri/package.json` (`typecheck:test`), `sys-monitor-tauri/scripts/verify.mjs`, `sys-monitor-tauri/src/components/MetricCard.tsx` (comment only), `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, this evidence file.

No product logic, schema constant, or IPC behaviour changed. `git status` shows no other product source file modified.