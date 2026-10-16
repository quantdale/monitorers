# react-hooks-lint-gate Specification

## Purpose
Keeps first-party React code inside the React-hooks rules — hooks are called unconditionally in a stable order, and effect/memo dependency arrays cover what their bodies read — enforced by a committed lint configuration inside the frontend verification gate, so violations fail before review.

## Requirements

### Requirement: React-hooks rules are enforced by a committed lint configuration

The repository SHALL carry a committed lint configuration that enables the `react/rules-of-hooks` and `react/exhaustive-deps` rules as errors over the first-party frontend sources, and a `lint` script that runs it. The lint step SHALL be part of the frontend verification gate, so the CI frontend job and the pre-push hook enforce it without workflow-specific wiring.

#### Scenario: A conditional hook call fails the gate
- **WHEN** first-party React code calls a hook after an early return, condition, loop, or nested function
- **THEN** the lint step reports a `rules-of-hooks` error and the frontend verification gate fails

#### Scenario: A missing or unanalyzable dependency fails the gate
- **WHEN** a `useEffect`, `useMemo`, or `useCallback` dependency array omits a value its body reads, or contains an expression the rule cannot statically check
- **THEN** the lint step reports an `exhaustive-deps` error and the frontend verification gate fails

#### Scenario: A clean tree passes the gate
- **WHEN** the lint step runs over first-party sources with no React-hooks violations
- **THEN** it exits successfully and the frontend verification gate proceeds to the remaining checks

### Requirement: Hook-rule suppressions carry a written rationale

Any suppression of a React-hooks lint finding SHALL name the rule it suppresses and state the reason in the same comment. A suppression SHALL NOT be used to hide a fixable rule violation; structural fixes (unconditional hooks, static dependency arrays) are the default.

#### Scenario: A suppression is auditable
- **WHEN** a source file suppresses a React-hooks lint finding
- **THEN** the suppression comment names the rule and explains why the pattern is intentional
