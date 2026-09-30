# frontend-verification-coverage Specification

## Purpose
Guarantees that the canonical frontend verification lane type-checks every TypeScript source the test suite actually imports and runs — including test files — and that any lint suppression written into the source refers to a rule that is genuinely enforced, so a type error inside a test cannot pass every gate in the repository.

## Requirements

### Requirement: Test sources are type-checked by the canonical frontend gate
The frontend verification lane SHALL type-check all TypeScript test sources under the application's `src` tree with the same strictness applied to production sources. Type errors in a test file MUST fail the gate.

#### Scenario: A type error in a test file fails the gate
- **WHEN** a test file under the application's `src` tree contains a type error (for example, a fixture that does not satisfy the type it is passed as, or a call with an incompatible argument)
- **THEN** the frontend verification lane exits non-zero and reports the test file and location

#### Scenario: Production type coverage is not reduced
- **WHEN** the test-inclusive type check is introduced
- **THEN** every TypeScript source that the existing production type check covers is still covered, with the same compiler strictness options

#### Scenario: Type coverage matches the files the test runner executes
- **WHEN** the set of files the test runner executes is compared with the set of files the type check covers
- **THEN** every executed test file is inside the type-checked set

### Requirement: The type-check project states an explicit, justified file set
The test-inclusive type-check configuration SHALL state, in configuration, exactly which paths it includes and excludes, and each exclusion SHALL be justified by a comment naming why the excluded tree is covered elsewhere or intentionally out of scope.

#### Scenario: Exclusions are declared and explained
- **WHEN** a reader inspects the test-inclusive type-check configuration
- **THEN** each excluded path carries a comment explaining where that tree is type-checked instead, or why it is intentionally not

#### Scenario: Simulation and e2e trees are still covered exactly once
- **WHEN** the type-check configurations are enumerated
- **THEN** the simulation bridge, the simulation platform, and the Playwright specs are each covered by a configuration, with no tree left unchecked and no tree checked twice by the same lane

### Requirement: Lint suppressions in source refer to enforced rules
A source annotation that suppresses a lint rule SHALL correspond to a lint rule that the repository actually enforces. The repository SHALL either enforce the rule set its source annotations assume, or remove/reword the annotations so they do not claim a suppression nothing honors.

#### Scenario: A suppression comment with no linter behind it
- **WHEN** the source contains an annotation disabling a named lint rule
- **THEN** that rule is enforced by a lint step in the canonical gate, or the annotation is removed/reworded so it no longer claims a suppression

#### Scenario: React hook correctness is an explicit decision
- **WHEN** a contributor asks whether React hook dependency correctness is enforced
- **THEN** the repository's verification configuration and documentation state a definite answer: the rules are enforced by a lint step, or they are explicitly recorded as unenforced
