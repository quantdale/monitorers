## 1. Resolve the advisory set

- [x] 1.1 Record the pre-change baseline: run `npm audit --json --audit-level=high` in `sys-monitor-tauri/` and save the output (expect `undici` high, `vitest` moderate/direct, `@vitest/mocker` moderate, all with `fixAvailable: true`).
- [x] 1.2 Confirm the exact patched versions the registry offers for `jsdom`, `vitest` and transitive `undici` (`npm view <pkg> versions --json | tail` / `npm audit fix --dry-run`); record them as evidence before changing anything.
- [x] 1.3 Re-resolve the app lockfile to the patched set. Prefer an in-range update so `package.json` semver ranges are unchanged; if a patched version is only available outside the current range, make the minimal explicit range edit and record why. Do NOT add an `overrides`/`resolutions` block.
- [x] 1.4 Verify `cd sys-monitor-tauri && npm audit --audit-level=high` now exits 0, and that `npm ls undici` resolves the patched version.
- [x] 1.5 Confirm no production/runtime dependency moved: `git diff sys-monitor-tauri/package.json` touches only devDependency entries, and `git diff --stat` shows only `package.json`/`package-lock.json`.

## 2. Make the gate authoritative and unambiguous

- [x] 2.1 Add an `audit:app` script to `sys-monitor-tauri/package.json` that runs `npm audit --audit-level=high` in the app directory, so the decisive check is reproducible in one command without the full frontend lane.
- [x] 2.2 Relabel the two audit steps in `scripts/verify.mjs`'s `frontend()` so each names its scope (e.g. "repository-root npm audit (root workspace)" vs "application npm audit (sys-monitor-tauri)") and confirm the app-scope step's non-zero exit is what throws.
- [x] 2.3 Add a short comment in `scripts/verify.mjs` recording why the app scope is authoritative (its transitive tree is the one that runs in CI and in pre-push; the root workspace holds only `husky`).
- [x] 2.4 Confirm `verify:fast` (which embeds `frontend()`) now fails when an artificial high advisory is present and passes when green — i.e. the lane is genuinely wired, not merely relabelled.

## 3. Re-qualify the upgraded test toolchain

- [x] 3.1 Run `npm test -- --run` and confirm the full frontend suite is green on the upgraded `jsdom`/`vitest`; investigate and record any behaviour change rather than editing assertions to fit.
- [x] 3.2 Spot-check the DOM-environment-dependent suites specifically (`ErrorBoundary`, `HardwareSidebar`, `MetricChart`, `renderCardContent`, `useSettings*`, `useMetrics.hook`) and confirm they still exercise real behaviour.
- [x] 3.3 Run `npx tsc --noEmit` and `npm run build`; confirm typecheck and the production bundle are unaffected (no test-tooling package may enter `dist/`).
- [x] 3.4 Run `npm run sim:typecheck` and the mock simulation lane (`npm run sim`) to confirm the Playwright/TS side is unaffected.

## 4. Record scoped evidence and correct the misleading claim

- [x] 4.1 Update `progress.md` so the dependency-audit line states BOTH scopes explicitly with the exact commands and exit statuses, replacing the unqualified "npm audit 0" that described only the repository root.
- [x] 4.2 Append the post-change evidence (commands run, exit statuses, before/after advisory table) to this change's `evidence.md`, matching the format used by `openspec/changes/dependency-runtime-modernization-and-qualification/evidence.md`.
- [x] 4.3 If `CLAUDE.md` or `AGENTS.md` describe the audit step, make sure the description names both scopes and does not imply a single aggregate result.

## 5. Final verification

- [x] 5.1 Run the complete frontend lane `npm run verify:frontend` end-to-end and confirm it exits 0.
- [x] 5.2 Run `npm run verify:fast` and confirm it is green (this is what `.husky/pre-push` executes).
- [x] 5.3 Run `openspec validate restore-green-frontend-gate --strict` and confirm it passes.
- [x] 5.4 Confirm the working tree contains no stray artifacts (`git status --porcelain` shows only the intended files) and that no product source file (`src/**`, `src-tauri/**`) was modified.
