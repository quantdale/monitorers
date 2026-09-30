## Why

The repository's required frontend gate is currently **red**. `scripts/verify.mjs`'s `frontend()` lane runs `npm audit --audit-level=high` inside `sys-monitor-tauri/`, and that command exits 1 today because the test-only dependency chain `jsdom@30.0.1 → undici@8.10.0` carries a **high-severity** advisory and `vitest@4.1.10` (direct, dev) carries a moderate advisory. Because `verify:frontend` is what the `frontend` job in `.github/workflows/rust.yml` executes, and `verify:fast` (= `frontend()` + `rust()`) is what `.husky/pre-push` executes, **every push and every pull request is blocked on a fixable test-tooling vulnerability**, and no new work can land until it is resolved.

The root cause is process, not the packages themselves: the most recent dependency campaign (commits `ad9ee00` "deps(test): migrate jsdom 25.0.1 -> 30.0.1" and the surrounding bumps) adopted new versions and recorded `npm audit 0` in `progress.md` — but that number was taken from the **repository-root** audit, which has only `husky` and is legitimately 0. The `sys-monitor-tauri/` app audit, which is the one the gate actually runs, was never re-verified. There is no automated check that would have caught the divergence, so the same class of drift can recur on the next Dependabot PR.

## What Changes

- **Resolve the advisory set** by moving the test-only browser/transform toolchain onto patched releases (`jsdom`, `vitest`, and the transitive `undici`), re-resolving `sys-monitor-tauri/package-lock.json`, and confirming `npm audit --audit-level=high` exits 0 in the app directory.
- **Make "green" objective and locally reproducible** by adding a single canonical command that reports the *app-level* audit result (not just the root one), and by making `progress.md`/status reporting distinguish the two audits so the misleading `npm audit 0` cannot be repeated.
- **Add a regression gate** so a future dependency bump cannot silently re-introduce a failing advisory: the frontend verification lane must assert the app audit result, and the root-vs-app audit distinction must be documented in the verification entry points (`scripts/verify.mjs`, `CLAUDE.md`, `AGENTS.md`).
- **Guard against the sibling failure mode**: `verify:fast` is a five-feature-matrix Rust gate plus two audits and currently takes many minutes; the change also records a machine-readable statement of which audits run where so the husky pre-push hook and CI stay honest about cost.

This is not a functional change to the application: no product code, IPC contract, or user-visible behaviour changes. It restores a required release/CI gate and hardens the process that produced the regression.

## Capabilities

### New Capabilities
- `dependency-audit-gate-integrity`: The contract that the canonical verification lanes (and the status documents that report their outcome) distinguish and enforce the *application-scoped* dependency audit — the one that actually gates CI and pre-push — rather than a root-scoped audit that cannot fail, so a high/moderate advisory in the shipped test toolchain cannot be recorded as "0 vulnerabilities".

### Modified Capabilities
- `dependency-vulnerability-audit`: Extends the existing audit requirement from "an audit is run" to "the audit that covers the application's own dependency tree is run, is green at the `high` threshold, and is not conflated with the repository-root audit"; adds the concrete packages/advisories that motivated the change and the recurring-transgression guard.

## Impact

- **Dependencies**: `sys-monitor-tauri/package.json` (`jsdom`, `vitest`) and `sys-monitor-tauri/package-lock.json` — dev/test toolchain only. No runtime/production dependency changes; the shipped frontend bundle is unaffected.
- **Tooling**: `sys-monitor-tauri/scripts/verify.mjs` (frontend lane), `sys-monitor-tauri/package.json` (an audit-report script), `.github/workflows/rust.yml` and `.github/workflows/simulation.yml` if the reporting step changes.
- **Documentation**: `progress.md`, `CLAUDE.md`, `AGENTS.md` (the audit-result claim and the root-vs-app distinction).
- **Not affected**: `src/**` product code, `src-tauri/**`, IPC schema versions, the packaged/simulation lanes.
- **Evidence collected during the audit** (all reproducible from a clean checkout):
  - `cd sys-monitor-tauri && npm audit --audit-level=high` → exit **1**, `3 vulnerabilities (2 moderate, 1 high)`; `undici` (high, via jsdom), `vitest` (moderate, direct), `@vitest/mocker` (moderate).
  - `npm audit --audit-level=high` at the repository root → exit 0, `found 0 vulnerabilities`.
  - `npm ls undici` → `jsdom@30.0.1 → undici@8.10.0`.
