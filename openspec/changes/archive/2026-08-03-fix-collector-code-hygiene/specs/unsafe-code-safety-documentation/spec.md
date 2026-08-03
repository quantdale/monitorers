## MODIFIED Requirements

### Requirement: Every unsafe block must carry a SAFETY comment
Every `unsafe { ... }` block in the Rust backend (`sys-monitor-tauri/src-tauri/src/**`) SHALL be immediately preceded by a `// SAFETY:` comment explaining why the block is sound (e.g. FFI calling-convention guarantees, pointer/lifetime justification, or return-code checks performed before reading output).

#### Scenario: PDH collect call in collect_pdh()
- **WHEN** `collect_pdh()` calls `PdhCollectQueryData` inside an `unsafe` block
- **THEN** that block is preceded by a `// SAFETY:` comment stating the FFI/PDH rationale (stack-variable pointer arguments, return code checked before any output is read)

#### Scenario: PDH collect call in poll()
- **WHEN** `poll()` triggers a PDH collect as part of the 250ms tick
- **THEN** it does so via a call to `collect_pdh()` (not a duplicated inline `unsafe` block), so the same documented and safety-commented code path is exercised in both places

#### Scenario: PDH query handle cleanup in Drop for PdhHandles
- **WHEN** `Drop for PdhHandles` calls `PdhCloseQuery` inside an `unsafe` block
- **THEN** that block is preceded by a `// SAFETY:` comment stating the FFI rationale (the handle is an owned value being closed exactly once, at end of life)

#### Scenario: NVAPI initialization in CollectorState::new()
- **WHEN** `CollectorState::new()` calls `NvAPI_Initialize()` inside an `unsafe` block
- **THEN** that block is preceded by a `// SAFETY:` comment (not looser `// unsafe:` prose) stating the FFI rationale (stateful C API, initialized once per process, return code checked)

#### Scenario: New unsafe code added later
- **WHEN** a future change introduces a new `unsafe` block anywhere in the Rust backend
- **THEN** code review SHALL require a `// SAFETY:` comment on that block before merge, consistent with this requirement
