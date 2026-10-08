## Tasks — Disposition the open dependency queue

> Executor rule: one domain per stage, gate before the next stage, and never
> adopt a bump the gates cannot qualify.

## 1. Establish the queue and the baseline

- [ ] 1.1 List every open Dependabot PR with number, group, package(s) and from→to (`gh pr list`), and record the failing checks for each.
- [ ] 1.2 Confirm each failure's root cause from the job log (`gh run view <id> --log-failed`) rather than assuming a bump is at fault.
- [ ] 1.3 Record the current `package.json` / `Cargo.toml` / lockfile / `.cursorrules` §1 state as the adoption baseline.

## 2. Frontend stage — framework, build tooling, test DOM, UI

- [ ] 2.1 Adopt `react`/`react-dom`/`@types/react`/`@types/react-dom` 19.3.0 (#40).
- [ ] 2.2 Adopt `vite` 8.3.1 + `@vitejs/plugin-react` 6.1.1 (#41).
- [ ] 2.3 Adopt `jsdom` 30.1.1, `vitest` and `@playwright/test` updates (#38).
- [ ] 2.4 Adopt `lucide-react` 1.48.0 (#35).
- [ ] 2.5 Update `.cursorrules` §1 for every adopted range, in the same commit.
- [ ] 2.6 Run `npm run verify:frontend`, `npm run e2e`, `npm run sim:typecheck` and `npm run sim`; record each result.

## 3. Tauri cross-language stage

- [ ] 3.1 Adopt the Rust Tauri stage (#42: `tauri`, `tauri-plugin-store`, `tauri-build`) **and** the JS stage (#43: `@tauri-apps/api`, `plugin-store`, CLI) together.
- [ ] 3.2 Run `npm run verify:rust` and `npm run verify:tauri`; the production-executable build is the check that proves the halves are aligned.
- [ ] 3.3 Re-run the managed-state and settings isolation suites that this boundary owns.

## 4. Supply-chain stage

- [ ] 4.1 Adopt the Actions updates (#37) with full commit-SHA pins taken from the PR diff.
- [ ] 4.2 Confirm every `uses:` ref in every workflow is still a full SHA, and that the pin comments name the version.

## 5. Collector platform stage

- [ ] 5.1 Adopt `nvml-wrapper` 0.13.0 (#39).
- [ ] 5.2 Run the full Rust feature matrix, clippy `-D warnings`, `cargo audit`, and the Nvidia identity tests.

## 6. Deferral and disposition

- [ ] 6.1 Defer `@types/node` 26.6.3 (#44) with the runtime-major rationale, and leave a comment on the PR naming the reason and the revisit condition.
- [ ] 6.2 Record every PR as Adopted / Superseded / Deferred with its qualifying command or blocker, in this change's `evidence.md`.
- [ ] 6.3 Close or supersede the PRs that were adopted locally, with a comment pointing at the adopting commit.

## 7. Final verification

- [ ] 7.1 Run `npm run verify:fast` end-to-end.
- [ ] 7.2 Run `npx openspec validate --all --strict` and `git diff --check`.
- [ ] 7.3 Update `progress.md` with the adopted stack and the standing deferral.
