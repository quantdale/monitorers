# dependency-audit-gate-integrity Specification

## Purpose
Guarantees that the dependency-advisory gate that actually blocks merges (the **application-scoped** npm audit covering `sys-monitor-tauri/`) is green and is never silently replaced in status reporting by the repository-root audit, so a fixable high/moderate advisory in the shipped test toolchain cannot be recorded as "0 vulnerabilities" and shipped.

## Requirements

### Requirement: The application-scoped npm audit is green at the high threshold
The canonical frontend verification lane SHALL run `npm audit --audit-level=high` **inside the application directory** (`sys-monitor-tauri/`) against the committed `sys-monitor-tauri/package-lock.json`, and the lane SHALL fail when that command reports any high-severity advisory. The audit MUST cover the application's own dependency tree — both production and dev/test dependencies — not only the repository-root workspace.

#### Scenario: High-severity advisory in the app tree fails the gate
- **WHEN** the `sys-monitor-tauri/package-lock.json` resolves any package to a version with a known high-severity npm advisory
- **THEN** `npm run verify:frontend` (and the `verify:fast` lane that embeds it) exits non-zero and names the affected package and remediation

#### Scenario: Green app audit lets the lane continue
- **WHEN** the app tree resolves with no high-severity advisories
- **THEN** `npm run verify:high` (the app-scoped audit command) exits 0 and the frontend lane proceeds to typecheck, tests, and build

### Requirement: Repository-root and application audits are never conflated
The canonical verification lanes SHALL run the audit for **each** npm workspace that has a committed lockfile (repository root **and** `sys-monitor-tauri/`), and each result SHALL be reported separately with its scope labelled. A status document, commit message, or evidence record SHALL NOT state a single combined "0 vulnerabilities" figure that omits one of the audited scopes.

#### Scenario: Root audit is green while app audit is red
- **WHEN** the root workspace has no advisories but the application workspace has one or more
- **THEN** the gate fails, and any status claim about audit health names the application scope explicitly rather than reporting only the root scope

#### Scenario: Status documents carry scoped audit evidence
- **WHEN** a status/progress document records dependency-audit results
- **THEN** it states the result per audited scope (root and application) with the exact command and exit status used, rather than a single aggregate number

### Requirement: Dependency changes are re-verified against the gate before being recorded as complete
A dependency-upgrade change SHALL NOT be recorded as complete until the application-scoped audit has been executed against the updated lockfile in that change's own working tree, and the result (pass or fail) is recorded. This prevents an upgrade from being marked green on the strength of a differently-scoped audit.

#### Scenario: Upgrading the test browser environment
- **WHEN** a change upgrades the test-only browser/DOM environment (for example `jsdom`) or the test runner (`vitest`)
- **THEN** `npm audit --audit-level=high` is run in `sys-monitor-tauri/` against the new lockfile and the result is recorded before the change is declared complete
