## Context

`sys-monitor-tauri/scripts/verify.mjs` composes every canonical lane. Its `frontend()` function runs, in order: `scripts/check-version.mjs`, a **repository-root** `npm audit --audit-level=high`, an **app-scoped** `npm audit --audit-level=high`, `npm run typecheck`, `npm test -- --run`, `npm run build`. `runNpm()` throws on any non-zero exit, so the app-scoped audit is already a hard gate on both the CI `frontend` job and `.husky/pre-push` (via `verify:fast`).

The app-scoped audit currently fails:

```
$ cd sys-monitor-tauri && npm audit --audit-level=high ; echo $?
undici vulnerable to ... (11 advisories listed)
node_modules/undici
3 vulnerabilities (2 moderate, 1 high)
1
$ npm ls undici
sys-monitor-tauri@0.1.4
`-- jsdom@30.0.1
  `-- undici@8.10.0
```

`npm audit --json` classifies: `undici` **high**, `vitest` **moderate, direct**, `@vitest/mocker` **moderate**. All three report `"fixAvailable": true`, i.e. patched versions exist inside the declared semver ranges — this is a lockfile-level fix, not a manifest change. The packages are dev/test-only: `jsdom` supplies the Vitest DOM environment, `vitest` is the runner, `undici` arrives only through `jsdom`. None of them is bundled by Vite (`vite.config.ts` only chunks `node_modules` for runtime vendor groups; the test runner never enters `dist/`).

Meanwhile the repository-root audit reports `found 0 vulnerabilities` and exits 0, because the root workspace contains only `husky`. `progress.md` records "npm audit 0" without qualifying the scope — the exact divergence that let a red gate be recorded as green.

Constraints that shape the approach:

- The repo treats the verification lanes as the single source of truth (`AGENTS.md`, `CLAUDE.md`, `.cursorrules` all defer to `verify:*`; CI calls them; husky calls them). So the fix belongs *in the lane*, not in an ad-hoc command.
- `dependency-runtime-modernization-and-qualification` is a completed campaign whose `evidence.md` records the current stack; the pinned `jsdom@30.0.1` / `vitest@4.1.10` are the versions that campaign adopted and qualified. Superseding them is a deliberate, evidence-backed re-qualification, not a regression of that work.
- `verify:fast` is already a multi-minute gate (five `cargo test` feature configurations + clippy + `cargo audit` + two npm audits + the frontend build). Adding a *new* expensive step is undesirable; adding a *reporting* step is free.

## Goals / Non-Goals

**Goals:**

- Make `npm audit --audit-level=high` in `sys-monitor-tauri/` exit 0 against the committed lockfile, using the smallest dependency movement that removes the advisories.
- Make it structurally impossible for a root-only audit result to be reported as the gate's result: the lane must print a labelled per-scope result and the exit status must derive from the app scope.
- Re-qualify the exact upgraded toolchain across the gates that depend on it (`tsc`, Vitest run, `vite build`) and record the evidence.

**Non-Goals:**

- No change to any production/runtime dependency, to the shipped bundle, or to `Cargo.lock` / `cargo audit` behaviour. The Rust side is green today (`cargo audit` exits 0 with 7 unmaintained/transitive platform warnings on the Linux-only `webkit2gtk`/`wry` subtree, which is irrelevant to a Windows-only build).
- No `overrides`/`resolutions` hack to pin an unmaintained transitive: the advisories have first-party fixes, so pinning a known-vulnerable version to satisfy a manifest would be worse than the status quo.
- No restructuring of the verification-lane architecture.
- No attempt to reduce the pre-push cost; that is a separate concern (see Risks).

## Decisions

### D1 — Fix by upgrading within the existing semver ranges, not by pinning or overriding

`npm audit --json` reports `"fixAvailable": true` for all three advisories, meaning patched releases satisfy the currently declared `^` ranges. The correct move is to re-resolve the lockfile (`npm install` / `npm update` for the affected packages) so the patched versions are adopted, rather than editing `package.json` ranges or adding an `overrides` block.

- **Alternative considered — `overrides` to force a patched `undici` under `jsdom`.** Rejected: it introduces a manifest-level pin that must be maintained forever, hides the real resolution, and would need removing once `jsdom` catches up. Since the fix is available in-range, an override is strictly worse.
- **Alternative considered — downgrade `jsdom` back to the pre-campaign 25.x.** Rejected: that reverses a completed, qualified campaign for no benefit, and the patched line is forward-only.
- **Alternative considered — raise the audit threshold to `critical`.** Rejected: that weakens the gate to make it pass. The existing spec (`dependency-vulnerability-audit`) makes fixable high-severity advisories blocking, and the moderate advisories in `vitest`/`@vitest/mocker` also have fixes, so there is no reason to move the threshold.

### D2 — Make the app-scope audit the authoritative signal *inside* `verify.mjs`, and label both scopes

The lane already runs both audits. What is missing is (a) explicit scope labelling in the output so a reader cannot mistake the root result for the gate result, and (b) a guarantee that the app scope is the one whose exit status decides. `runNpm()` already throws on non-zero, so the throw behaviour is correct; the change is to make the labels unambiguous (e.g. "repository npm audit" → "repository-root npm audit (husky only)") and to add a single dedicated script (`npm run audit:app`) so a developer can reproduce the gate's decisive check in one command without running the full frontend lane.

- **Alternative considered — add a brand-new `verify:audit` lane.** Rejected: it duplicates an existing step and adds a third entry point contributors must learn. The problem is reporting and discoverability, not a missing lane.
- **Alternative considered — drop the root audit.** Rejected: the root workspace has its own lockfile and its own advisories over time; both scopes should stay intentional (an existing spec requirement).

### D3 — Treat the test-toolchain upgrade as a change that must be re-qualified, not a lockfile refresh

`jsdom` supplies the Vitest DOM environment and `vitest` is the runner, so a major-ish bump can change test behaviour (timers, `jsdom` globals, ESM interop). The upgrade therefore ships with a full re-qualification of the frontend lane plus a spot-check of the tests that depend most on the DOM environment (`ErrorBoundary.test.tsx`, `HardwareSidebar.test.tsx`, `MetricChart.test.tsx`, `renderCardContent.test.tsx`, `useSettings*.test.ts`, `useMetrics.hook.test.ts`), not just an audit re-run.

### D4 — Record scoped audit evidence, and correct the misleading existing claim

`progress.md` currently states "npm audit 0" without a scope. The change corrects that line to state both scopes explicitly and records the exact commands and exit statuses, so the same conflation cannot be repeated by the next campaign. This is documentation-only and touches no product code.

## Risks / Trade-offs

- **[A `jsdom`/`vitest` upgrade changes DOM-environment behaviour and breaks existing tests]** → Re-qualify with the full frontend gate (`verify:frontend`) plus a full `npm test -- --run`; if a patched version is unavailable in-range, pin the nearest patched version explicitly in `package.json` and record the pin as a temporary, reviewable decision rather than silently forcing a transitive.
- **[Upstream advisory database changes the verdict between runs]** → Record the audit output verbatim in the change's evidence, and treat a *new* advisory discovered after this change as a separate, new finding rather than reopening this one.
- **[`npm audit` reaches the network and can fail transiently, producing a false red gate]** → Pre-existing condition of the current lane (the audit already runs there today); not introduced here. If a flaky registry is observed, a retry/timeout policy can be a follow-up change; it must not be "fixed" by dropping the audit.
- **[Pre-push latency]** → Unchanged: no new expensive step is added to `verify:fast`; only labels and a lightweight script are added.
- **[The pinned stack recorded in the completed modernization campaign's `evidence.md` becomes stale]** → Accepted and intended. The evidence file is a historical record of that campaign; `progress.md` is the live status and is corrected here.

## Migration Plan

1. Re-resolve the app lockfile to patched `jsdom`/`vitest` (and their transitive `undici`).
2. Run `npm audit --audit-level=high` in `sys-monitor-tauri/`; confirm exit 0.
3. Run the full frontend lane (`npm run verify:frontend`) and `npm run sim:typecheck`; confirm typecheck, tests, and build are green.
4. Update `progress.md` (and, if they describe the gate, `CLAUDE.md`/`AGENTS.md`) with scoped audit evidence.
5. Rollback is a single `git revert` of the lockfile/manifest change plus the lane-reporting change; no data migration, no protocol change, no persisted state is touched.

## Open Questions

None that affect the specs, approach, or task breakdown. (Whether the eventual permanent fix is an upstream `jsdom` release or a manifest pin is resolved at implementation time by what the registry actually offers, and is recorded as evidence either way.)
