## Context

TypeScript source in this repo compiles under two projects, both driven by the canonical gate:

- `sys-monitor-tauri/tsconfig.json` — `include: ["src"]`, `exclude: ["src/sim", "src/**/*.test.ts", "src/**/*.test.tsx"]`, `strict`, `noUnusedLocals`, `noUnusedParameters`, `noEmit`. This is what `npm run typecheck` and `npm run build` use.
- `sys-monitor-tauri/e2e/tsconfig.sim.json` — extends the above; `include: ["./sim/**/*.ts", "../src/**/*.ts"]`, `exclude: ["../src/**/*.test.ts", "../src/**/*.test.tsx"]`, `types: ["node"]`. This is what `npm run sim:typecheck` uses.

Together these cover `src/**/*.ts(x)` production, `src/sim/**` (pulled into the sim project), and `e2e/sim/**`. Neither covers `src/**/*.test.ts(x)`: the main project excludes them by glob, and the sim project both excludes them and (by using `../src/**/*.ts`) does not match `.tsx` at all. Vitest transpiles test files through esbuild, which strips types without checking them. So a test file is the one kind of TypeScript source in the repo that no compiler ever validates.

That matters here because of what the tests actually contain. The suite is the primary consumer of the hand-mirrored IPC shapes (`types/metrics.ts` ↔ Rust serde structs): `useMetrics.test.ts` builds `HistoryPayload`/`MetricsSnapshot`/`DiskHistory`/`GpuHistory` literals and calls the pure merge/slice functions; `useSettings.*.test.ts` construct and migrate `Settings`; `renderCardContent.test.tsx` and `HardwareSidebar.test.tsx` build `SlicedHistory` fixtures; `useMetrics.hook.test.ts` mocks the Tauri event/invoke surface. If `types/metrics.ts` drifts from Rust, or a hook's result shape changes, these files are the ones that should fail first — and today they cannot.

There is also a smaller honesty problem: `src/components/MetricCard.tsx` carries `// eslint-disable-next-line react-hooks/exhaustive-deps -- secondaryHistory only participates when hasSecondary is true`, but the repo has no ESLint (or any linter) configured, no `lint` script, and no linter dev dependency. The comment tells a reader a rule is being deliberately waived; in fact no rule is running. The repo has otherwise been disciplined about enforced invariants (fmt, clippy `-D warnings`, `check-version.mjs`, simulation config lints in CI), which makes this annotation actively misleading.

## Goals / Non-Goals

**Goals:**

- Make every test file the runner executes type-check under the same strictness as production source, and run that check in a lane CI already executes.
- Keep the type-check file sets explicit and justified in configuration.
- Resolve the ESLint-annotation situation one way or the other, and record the decision.

**Non-Goals:**

- No change to test *behaviour*, assertions, or coverage. This change may surface pre-existing type errors in tests; the correct response is to fix the code or the test, not to loosen the compiler options.
- No refactor of `useMetrics`/`useSettings`/`cardIdentity` or any other module.
- No Prettier/biome formatting migration. Formatting is not a correctness gate and would produce a large unrelated diff.
- No change to the Rust side or any IPC contract.

## Decisions

### D1 — Add a dedicated `tsconfig.test.json` that extends the main project, rather than removing the `exclude`

The main `tsconfig.json` deliberately excludes `src/sim` and test globs. Removing those excludes would (a) pull the browser/simulation bridge sources into the production build's type check, and (b) pull test-only types/globals (Vitest globals, `jsdom` matchers) into the production project, which is wrong. A dedicated project that `extends` the main config and only re-declares `include`/`exclude` gets identical `compilerOptions` (strictness is inherited, satisfying "production type coverage is not reduced") while giving tests their own file set.

- **Alternative considered — delete the `exclude` from `tsconfig.json`.** Rejected: it would drag `src/sim/**` (excluded today for a reason) and test globals into the production project and could break the production build's `tsc` step.
- **Alternative considered — add the test type check into the existing `sim:typecheck` project.** Rejected: that project uses `types: ["node"]` and is semantically the simulation/e2e lane; test *unit* files are a different concern, and the frontend CI job (ubuntu) does not run `sim:typecheck` (that is the simulation workflow), so the coverage would not land in the lane that matters most.
- **Alternative considered — use `vitest typecheck`.** Rejected: it re-runs a parallel tsc invocation with its own configuration surface, duplicating the project graph and making the "what is covered" question harder to answer. A plain `tsc -p` is greppable and matches how every other check in this repo is expressed.

The new project's `include` should be the application `src` tree *including* tests, and its `exclude` should carry a comment for the sim bridge (covered by the sim project) and for `e2e/**` (out of `src`, covered by the sim project). Each exclusion is justified in-config, as the spec requires.

### D2 — Add a typecheck step to the canonical frontend lane, placed before tests/build

`verify.mjs`'s `frontend()` runs audit → typecheck → tests → build. The test-inclusive type check is cheap (esbuild/tsc over 20 small files, seconds) and logically belongs beside the production typecheck. Running it immediately after the production typecheck fails fast on the most common class of error (a test fixture that no longer matches a type) before spending the ~40 s unit-test run and the production build.

### D3 — Resolve the lint question with a real, minimal lint step, and keep it narrow

The spec requires a definite answer on whether hook rules are enforced. Two honest options existed:

1. Adopt a linter (ESLint flat config with `typescript-eslint` + `eslint-plugin-react-hooks`) and enforce `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps`.
2. Declare linting out of scope for now, remove the inert `eslint-disable` comment, and replace it with a plain explanatory comment.

Option 1 is the better end state — the repo's whole convention is "enforced invariant, not documented hope", and hook-dependency correctness is a real class of bug in a hook-heavy app. But it is a dependency + config addition with its own adoption cost, and the exhaustive-deps rule in particular tends to surface many findings in an existing codebase. To keep this change coherent and reviewable, the design is:

- Replace the inert `eslint-disable` comment immediately (correct the false claim either way).
- If a linter is adopted in the same change, wire it as a non-blocking-for-now step that reports, and only make it blocking once the codebase is clean. If it cannot be made clean without churn beyond this change's scope, take option 2 and record "frontend linting is currently unenforced; the `react-hooks` rules are a known gap" as a follow-up in the change's evidence.

Whichever branch is taken, the *decision* is recorded so the repo is no longer ambiguous. Given the size of this change already, D3's default execution is option 2 (correct the comment, record the gap) with option 1 as an explicitly-scoped, non-blocking addition only if it can be added without unrelated churn.

## Risks / Trade-offs

- **[Pre-existing type errors surface in test files when the project is added]** → This is the point of the change, but it must be fixed properly: correct the fixture/test to the real type, or fix the type. Do not add `as any`, `@ts-expect-error`, or loosen `strict` to make the check pass. If a specific test genuinely needs a looser type, that finding is recorded, not silenced.
- **[`.tsx` test files need DOM lib types]** → The main config already includes `"DOM"`/`"DOM.Iterable"`; the new project inherits them. Vitest globals (`describe`/`it`/`expect`) come from `globals: true` in `vite.config.ts`, so the test project must add `"types": ["vitest/globals", "node"]` (or the equivalent) or the test files will fail with "cannot find name 'describe'". This is a known, solvable configuration detail, called out so it is not mistaken for a code error.
- **[Double-counting type checks inflates CI time]** → The added project reuses the same `tsc` binary and only adds the test files; cost is a few seconds. Measured in the evidence; if it proves material, the production and test projects can be merged behind a flag rather than run separately, but that is not the default.
- **[Removing the `eslint-disable` comment could be read as "forgot to re-add the suppression"]** → The replacement comment states plainly that the dependency array is intentionally partial and why, so the intent is preserved without claiming an unenforced suppression.

## Migration Plan

1. Add `tsconfig.test.json` extending `tsconfig.json` with the test-inclusive `include`/justified `exclude` and the required `types` for Vitest globals.
2. Add a `typecheck:test` (or similarly named) script and a step in `verify.mjs`'s `frontend()` immediately after the production typecheck.
3. Run it; fix any real type errors it surfaces in test files (properly — no suppressions).
4. Replace the inert `eslint-disable` comment in `MetricCard.tsx` with an accurate comment (and, only if it can be done without unrelated churn, add the minimal React-hooks lint step; otherwise record the gap).
5. Update the developer documentation (the gate list) to state the new coverage and the lint decision.
6. Run `npm run verify:frontend` and `npm run sim:typecheck` green.
7. Rollback = remove the config/script/wiring and restore the comment; no product behaviour changes.

## Open Questions

- Whether a React-hooks linter is adopted in this change or deferred is a judgment call the implementer makes based on how many findings the rules produce against the current codebase. It does not change the specs (which require a definite, recorded answer either way) or the rest of the task breakdown, so it is safe to decide at implementation time and record.
