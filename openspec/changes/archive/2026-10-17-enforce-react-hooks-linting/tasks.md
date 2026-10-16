## 1. Lint gate

- [x] 1.1 Add `oxlint` `1.88.0` (exact pin) to `sys-monitor-tauri/package.json` devDependencies and commit the lockfile change.
- [x] 1.2 Add `sys-monitor-tauri/.oxlintrc.json`: `react` plugin, default rule categories off, `react/rules-of-hooks` and `react/exhaustive-deps` as `error`. Confirm `npm run lint` reports findings from those two rules only.
- [x] 1.3 Add the `lint` script (`oxlint src e2e`) and wire `runNpm('frontend React-hooks lint', ['run', 'lint'], appRoot)` into `scripts/verify.mjs`'s `frontend()` lane, after the typechecks.

## 2. Findings

- [x] 2.1 Fix the `rules-of-hooks` violation in `src/hooks/useSettings.ts`: `useSettings()` becomes a context-only hook that throws without `SettingsProvider`; export `useSettingsState` as the provider-less engine. Update the `useSettings*.test.ts` harnesses to use the engine, wrap `HardwareSidebar.test.tsx` renders in `SettingsProvider`, and add a pin that `useSettings()` without a provider throws.
- [x] 2.2 Fix the per-render allocation in `src/App.tsx` (`settings.cardOrder ?? []` → a module-level stable empty array) so the `visibleCardOrder`/`cards` memos keep their identity contract.
- [x] 2.3 Fix the `MetricCard.tsx` chart memo: extract the effective secondary series to a variable and make the dependency array static and complete (`hasChart, history, timestamps, secondarySeries`), preserving the existing recompute semantics. Replace the stale "no linter enforces exhaustive-deps" comment with the gate's rationale.
- [x] 2.4 Confirm `npm run lint` exits 0 and reports zero findings.

## 3. Docs and validation

- [x] 3.1 Update `AGENTS.md`, `CLAUDE.md`, and `.cursorrules`: replace the "linting is not enforced / React-hooks rules are a recorded gap" language with the enforced gate (tool, rules, script, where it runs), and add `npm run lint` to each documented frontend gate list.
- [x] 3.2 From `sys-monitor-tauri/`, run `npx tsc --noEmit`, `npm run typecheck:test`, `npm test -- --run`, `npm run build`, and `npm run e2e` — all green (harness changes included).
- [x] 3.3 Run `npm run verify:frontend` end-to-end to prove the gate sits inside the canonical lane.
- [x] 3.4 Run `openspec validate --change 2026-10-17-enforce-react-hooks-linting --strict --no-interactive`.
- [x] 3.5 Write `evidence.md` with the pre-fix finding list (the four oxlint findings verbatim), the post-fix lint output, and the gates actually run. Do not claim a packaged-lane run.
