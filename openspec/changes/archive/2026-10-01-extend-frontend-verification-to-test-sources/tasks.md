## 1. Introduce the test-inclusive type-check project

- [x] 1.1 Create `sys-monitor-tauri/tsconfig.test.json` that `extends` `./tsconfig.json` (inheriting `strict`, `noUnusedLocals`, `noUnusedParameters`, DOM libs) with `noEmit`.
- [x] 1.2 Set `include` to the application `src` tree including tests (`src/**/*.ts`, `src/**/*.tsx`, i.e. no test-glob exclusion), and set `exclude` to only what is covered elsewhere — with a comment per entry: the simulation bridge (`src/sim/**`, covered by the sim project) and anything outside `src` such as `e2e/**` (covered by the sim project).
- [x] 1.3 Add the `types` needed for Vitest globals (e.g. `["vitest/globals", "node"]`) so `describe`/`it`/`expect` resolve under `globals: true`; verify by running the project once.
- [x] 1.4 Add a `typecheck:test` npm script running `tsc -p tsconfig.test.json --noEmit`.

## 2. Fix real type errors the new project surfaces

- [x] 2.1 Run `npm run typecheck:test` and record every error it reports, with file and location.
- [x] 2.2 Fix each error properly: correct the test fixture/call/assertion to the real type, or fix the underlying type if the test exposed a real inconsistency. Do NOT add `as any`, `@ts-expect-error`, `@ts-ignore`, or loosen `strict` to make the check pass.
- [x] 2.3 If any error reveals a genuine production/test type mismatch (for example a `types/metrics.ts` shape that no longer matches how the hook builds it), record it in this change's `evidence.md` as a finding even if the fix is small.
- [x] 2.4 Confirm the production `npm run typecheck` still passes unchanged (the new project must not reduce existing coverage).

## 3. Wire the check into the canonical gate

- [x] 3.1 Add a step in `sys-monitor-tauri/scripts/verify.mjs`'s `frontend()` that runs the test-inclusive type check, placed immediately after the production `frontend typecheck` so it fails fast before the slower unit tests and build.
- [x] 3.2 Confirm `verify:fast` (which embeds `frontend()`) and the CI `frontend` job both execute the new step.
- [x] 3.3 Measure and record the added wall-clock cost of the new step.

## 4. Resolve the lint-annotation honesty problem

- [x] 4.1 Replace the inert `// eslint-disable-next-line react-hooks/exhaustive-deps` comment in `src/components/MetricCard.tsx` with an accurate plain comment explaining that the dependency array is intentionally partial and why (secondaryHistory only participates when hasSecondary is true), so it no longer claims a suppression nothing honors.
- [x] 4.2 Decide and record whether a minimal React-hooks lint step (rules-of-hooks + exhaustive-deps) is adopted in this change. If adopted, add it as a step in the frontend lane and either make it green immediately or mark it explicitly non-blocking while the codebase is brought to zero findings — and record which.
- [x] 4.3 If a linter is not adopted, record in this change's `evidence.md` that frontend linting (including React hook rules) is currently unenforced and is a known gap, so the repo is no longer ambiguous.

## 5. Documentation and final verification

- [x] 5.1 Update the developer gate documentation (AGENTS.md/CLAUDE.md frontend gate list) to state that test sources are type-checked and to state the lint decision.
- [x] 5.2 Confirm no tree is left unchecked and none double-counted by the same lane: reconcile `tsconfig.json`, `tsconfig.test.json`, and `e2e/tsconfig.sim.json` coverage of `src`, `src/sim`, `src/**/*.test.*`, and `e2e/sim/**`.
- [x] 5.3 Run `npm run verify:frontend` and `npm run sim:typecheck`; both green.
- [x] 5.4 Run `openspec validate extend-frontend-verification-to-test-sources --strict`.
- [x] 5.5 Confirm `git status --porcelain` shows only the intended config/script/comment/doc files and that no product logic changed (only a comment in MetricCard.tsx).
