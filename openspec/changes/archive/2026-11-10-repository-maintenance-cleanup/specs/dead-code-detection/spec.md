## Dead-code detection — delta

## MODIFIED Requirements

### Requirement: Unreferenced first-party exports are detected automatically

The canonical verification lane SHALL include a check that identifies first-party functions, methods, and types which are exported (public in a library crate, or `export`ed from a TypeScript module) but referenced by no other first-party code, and SHALL fail when such a symbol is found unless it is explicitly declared as an intentional public entry point. A reference SHALL mean a real reference in code: a comment SHALL NOT count. Prose that names a symbol — a doc comment, a TODO, an example in a header comment — SHALL NOT make that symbol count as referenced. Stripping comments before counting SHALL NOT delete any real reference, so string literals, template literals, Rust raw strings, char literals, lifetimes, and JSX text SHALL be preserved verbatim.

#### Scenario: Dead export in a library crate is caught
- **WHEN** a function is declared `pub` in a library crate and no other first-party Rust code calls it
- **THEN** the dead-code check reports it, naming the crate, module, and symbol, and the check fails

#### Scenario: Dead export in a TypeScript module is caught
- **WHEN** a function is `export`ed from a TypeScript module and no other first-party TypeScript module imports it
- **THEN** the dead-code check reports it, naming the file and symbol, and the check fails

#### Scenario: A comment that names a symbol does not make it live
- **WHEN** an exported symbol's only textual occurrence outside its declaration is inside a comment
- **THEN** the check reports the symbol as unreferenced and fails, naming the file and symbol

#### Scenario: A literal is never mistaken for a comment
- **WHEN** a first-party source contains a URL string, a Rust raw string, a `':'` char literal, a `&'static str` lifetime, or a JSX apostrophe such as `Couldn't`
- **THEN** the scanner preserves it verbatim and neither fabricates nor removes a reference

#### Scenario: Test-only references do not make a symbol production-dead
- **WHEN** an exported symbol's only real references are from its own unit test
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

#### Scenario: A dead subtree's root is labelled unreferenced and its dependents are reported too
- **WHEN** symbol A is referenced only by symbol B, and symbol B is referenced by nothing
- **THEN** B is labelled `referenced nowhere` (the root) and A is labelled as a dead chain, so no member of the subtree is hidden behind a single finding

#### Scenario: The gate's own scanner is covered by tests in the canonical lane
- **WHEN** the canonical frontend verification lane runs
- **THEN** the scanner's comment-versus-reference behaviour is pinned by tests that fail if comments start counting as references again
