# dead-code-detection Specification

## Purpose
Guarantees that first-party exported symbols which no code path references are detected and removed by an automated check in the canonical verification lane — including across the Rust library boundary and the TypeScript module boundary, where the default compiler and linter settings are structurally blind to unreferenced exports.

## Requirements

### Requirement: Unreferenced first-party exports are detected automatically
The canonical verification lane SHALL include a check that identifies first-party functions, methods, and types which are exported (public in a library crate, or `export`ed from a TypeScript module) but referenced by no other first-party code, and SHALL fail when such a symbol is found unless it is explicitly declared as an intentional public entry point.

#### Scenario: Dead export in a library crate is caught
- **WHEN** a function is declared `pub` in a library crate and no other first-party Rust code calls it
- **THEN** the dead-code check reports it, naming the crate, module, and symbol, and the check fails

#### Scenario: Dead export in a TypeScript module is caught
- **WHEN** a function is `export`ed from a TypeScript module and no other first-party TypeScript module imports it
- **THEN** the dead-code check reports it, naming the file and symbol, and the check fails

#### Scenario: Test-only references do not make a symbol production-dead
- **WHEN** an exported symbol's only references are from its own unit test
- **THEN** the check still reports the symbol as having no production reference, so a function kept alive only by a test of itself is surfaced

#### Scenario: Intentional public entry points are declared, not silently tolerated
- **WHEN** an exported symbol is intentionally part of a crate's or module's supported surface and has no in-repo caller
- **THEN** it is listed in the check's explicit allow-list with a reason, so the exclusion is reviewable rather than an omission in the check's configuration

### Requirement: Detection spans the module boundary where default tooling is blind
The dead-code check SHALL be able to see across the boundary that makes a symbol unreachable: a `pub` item in a library crate whose only would-be callers are in a binary target, and an `export`ed TypeScript symbol consumed only by tests. Reporting SHALL distinguish "referenced nowhere" from "referenced only from tests" from "referenced only by other unreferenced code".

#### Scenario: Binary-only usage is still a real reference
- **WHEN** a `pub` library function is called only from a binary target in the same repository
- **THEN** the check treats it as referenced and does not report it

#### Scenario: A chain of unreferenced symbols is reported at its root
- **WHEN** symbol A is referenced only by symbol B, and symbol B is referenced by nothing
- **THEN** the check reports the chain, so the root of the dead subtree is identifiable rather than reporting only B
