## Why

**No typecheck in this repository covers the unit-test sources.** `sys-monitor-tauri/tsconfig.json` sets `"include": ["src"]` but `"exclude": ["src/sim", "src/**/*.test.ts", "src/**/*.test.tsx"]`, and every typecheck entry point uses that project:

- `npm run typecheck` → `tsc --noEmit` (default project = `tsconfig.json`)
- `npm run build` → `tsc && vite build` (same project)
- `npm run verify:frontend` → `runNpm('frontend typecheck', ['run', 'typecheck'], appRoot)` and `npm run build`
- `npm run sim:typecheck` → `tsc -p e2e/tsconfig.sim.json`, whose `include` is `["./sim/**/*.ts", "../src/**/*.ts"]` and whose `exclude` **also** lists `"../src/**/*.test.ts"` and `"../src/**/*.test.tsx"`

So the 20 Vitest files under `sys-monitor-tauri/src/**` are transpiled by esbuild inside Vitest, which strips types without checking them, and are then never seen by `tsc` in any lane. A type error inside a test — a call with a wrong argument shape, a property that no longer exists on `SlicedHistory`, a mock returning the wrong `MetricsSnapshot` field type — cannot fail any gate. The suite still runs and still passes, because a type error in a test is invisible to both the transpiler and every typecheck.

This is not hypothetical for this codebase: the test files are where the IPC payload shapes, hook result types, and component props are exercised most directly (`useMetrics.test.ts` calls `appendToHistory`/`mergeDiskHistory`/`mergeGpuHistory` with `HistoryPayload`/`MetricsSnapshot` literals; `useSettings.*.test.ts` construct `Settings`; `HardwareSidebar.test.tsx` and `renderCardContent.test.tsx` build `SlicedHistory` fixtures). Those are exactly the shapes that `types/metrics.ts` "manually mirrors" from the Rust serde structs — the manual-mirror boundary the project already flags as its most drift-prone contract.

A secondary gap sits in the same area: the repository has **no frontend linter at all** — no ESLint/Prettier/biome config, no `lint` script — while the source contains `// eslint-disable-next-line react-hooks/exhaustive-deps` in `src/components/MetricCard.tsx` referencing a linter that is not installed or run. TypeScript's `strict`, `noUnusedLocals`, and `noUnusedParameters` cover part of the ground, but the React-specific rules (exhaustive deps, rules-of-hooks) that the code explicitly annotates are unenforced.

## What Changes

- **Add a test-inclusive typecheck project** that compiles `src/**` test files with the same strictness as production sources, and wire it into the canonical frontend verification lane so CI and `verify:fast` run it.
- **Keep the existing exclusions intentional and narrow.** `src/sim/**` and the browser-only/e2e-owned trees must not be swept in accidentally; the new project must state exactly what it includes and why.
- **Replace the dead ESLint annotation** in `MetricCard.tsx` with either a real enforced rule or an accurate comment, so the file does not claim a suppression that nothing honors.
- **Introduce a minimal, enforced frontend lint baseline** (rules-of-hooks and exhaustive-deps at minimum) OR — if adding a linter is judged too large for this change — record the decision explicitly and make the type coverage the enforced part. This must be a decision, not an omission: right now the repository is ambiguous about whether React hook correctness is gated.
- **Record the coverage boundary** in the developer documentation so a contributor knows test sources are typechecked and which rules are and are not enforced.

## Capabilities

### New Capabilities
- `frontend-verification-coverage`: The contract that the canonical frontend verification lane type-checks the same set of TypeScript sources the test suite imports and executes, and that any lint/suppression annotation in the source refers to a rule that is actually enforced — so a type error in a test file cannot pass every gate.

### Modified Capabilities
- `ci-pipeline-efficiency-and-coverage`: Extends the existing CI-coverage contract so the frontend job's type coverage explicitly includes test sources and the documented gate description matches what CI actually runs.

## Impact

- **Config**: `sys-monitor-tauri/tsconfig.json` (or a new `tsconfig.test.json` extending it), `sys-monitor-tauri/package.json` (script(s), and a dev dependency only if a linter is adopted), `sys-monitor-tauri/scripts/verify.mjs` (one new step in `frontend()`).
- **Source**: `sys-monitor-tauri/src/components/MetricCard.tsx` (the inert `eslint-disable` comment). No behavioural change to any component, hook, or type.
- **Not affected**: Rust, IPC contracts, the simulation lanes' runtime behaviour, the packaged lane.
- **Evidence (reproducible from the committed tree):**
  - `sys-monitor-tauri/tsconfig.json` → `"exclude": ["src/sim", "src/**/*.test.ts", "src/**/*.test.tsx"]`.
  - `sys-monitor-tauri/e2e/tsconfig.sim.json` → `"exclude": ["../src/**/*.test.ts", "../src/**/*.test.tsx"]`.
  - `sys-monitor-tauri/package.json` → `"typecheck": "tsc --noEmit"`, `"sim:typecheck": "tsc -p e2e/tsconfig.sim.json --noEmit"`; no `lint` script; no eslint/biome/prettier dev dependency.
  - `find sys-monitor-tauri/src -name "*.test.ts" -o -name "*.test.tsx"` → 20 files, none of which is in any `tsconfig` `include`.
  - `grep -rn "eslint-disable" sys-monitor-tauri/src` → 1 hit, in `MetricCard.tsx`.
