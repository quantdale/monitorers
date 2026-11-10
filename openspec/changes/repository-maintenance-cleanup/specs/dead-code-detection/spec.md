## Dead-code detection — delta

## MODIFIED Requirements

### Requirement: Test-only references do not make a symbol production-dead

A comment SHALL NOT be counted as a reference. Prose that names a symbol — a doc comment, a TODO, an example in a header comment — SHALL NOT make that symbol count as referenced, in either direction: a symbol named only in comments is production-dead, and stripping comments SHALL NOT delete any real reference. The scanner SHALL preserve string literals, template literals, Rust raw strings, char literals, lifetimes, and JSX text so that no literal is mistaken for a comment and no real reference inside a literal is lost.

#### Scenario: A comment that names a symbol does not make it live
- **WHEN** an exported symbol's only textual occurrence outside its declaration is inside a comment
- **THEN** the check reports the symbol as unreferenced and fails, naming the file and symbol

#### Scenario: A test-only reference is still reported
- **WHEN** an exported symbol's only real reference is from its own unit test
- **THEN** the check reports the symbol as having no production reference, so a function kept alive only by a test of itself is surfaced

#### Scenario: A literal is never mistaken for a comment
- **WHEN** a first-party source contains a URL string, a Rust raw string, a `':'` char literal, a `&'static str` lifetime, or a JSX apostrophe such as `Couldn't`
- **THEN** the scanner preserves it verbatim and neither fabricates nor removes a reference

### Requirement: Detection spans the module boundary where default tooling is blind

The dead-code check SHALL be able to see across the boundary that makes a symbol unreachable: a `pub` item in a library crate whose only would-be callers are in a binary target, and an `export`ed TypeScript symbol consumed only by tests. Reporting SHALL distinguish "referenced nowhere" from "referenced only from tests" from "referenced only by other unreferenced code". A symbol whose only production references come from a file whose declarations are themselves all unreferenced SHALL be reported too, and the dead-chain finding SHALL identify a `referenced nowhere` member of that dead subtree as its root.

#### Scenario: Binary-only usage is still a real reference
- **WHEN** a `pub` library function is called only from a binary target in the same repository
- **THEN** the check treats it as referenced and does not report it

#### Scenario: A chain of unreferenced symbols is reported at its root
- **WHEN** symbol A is referenced only by symbol B, and symbol B is referenced by nothing
- **THEN** the check reports the chain, so the root of the dead subtree is identifiable rather than reporting only B

#### Scenario: The root is labelled as unreferenced, and the dependent member is reported too
- **WHEN** symbol A is referenced only by symbol B, and symbol B is referenced by nothing
- **THEN** B is labelled `referenced nowhere` (the root) and A is labelled as a dead chain, so the subtree's entry point is named explicitly and no member is hidden

#### Scenario: The gate's own scanner is covered by tests in the canonical lane
- **WHEN** the canonical frontend verification lane runs
- **THEN** the scanner's comment-vs-reference behaviour is pinned by tests that fail if comments start counting again
