## ADDED Requirements

### Requirement: Documentation matches the supervised runtime and qualification reality
Instruction and documentation files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `CONTEXT.md` glossary, `sys-monitor-tauri/README.md`, workflow comments, `progress.md`) SHALL accurately describe: the supervisor lifecycle and its states; the recovery policy (budget, backoff, healthy-reset); manual retry behavior; history semantics across collector restarts including gap truthfulness and rate-counter re-baselining; the typed status IPC contract and its schema version; the packaged-app qualification command and its CI policy; installer qualification commands/workflow; release artifact/manifest locations; signing status; and known external validation limitations. No instruction file SHALL contradict another or the source on these topics.

#### Scenario: Fail-stop claim is gone
- **WHEN** a reader consults any instruction file about collector panic behavior
- **THEN** it describes supervised bounded recovery with manual retry, not permanent thread death requiring an app restart

#### Scenario: progress.md is truthful for this campaign
- **WHEN** the campaign completes
- **THEN** `progress.md` records the actual delivered state, remaining limitations, and no stale placeholder content
