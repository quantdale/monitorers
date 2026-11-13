## Context

See proposal.md. `waitForCards` checks the required subset inside its polling loop but asserts only the count at the deadline. The advisory workflow grants `contents: read` and invokes `gh issue create/comment`. The screenshot race allocates a 15-second timer that is never cleared if capture wins.

## Goals / Non-Goals

**Goals:** prevent false success and release verification resources promptly.

**Non-Goals:** expanding lint policy, triggering advisory issues during this audit, or changing application behavior.

## Decisions

- Use the same readiness predicate for the loop and final assertion; exercise the exported step with a fake page and fake timers so the regression catches the actual false-green return path. Default to the core metrics, but let customization supply its expected visible set after deliberately hiding a core card; require that full set before asserting restored order.
- Add job-scoped `contents: read` and `issues: write`, the minimum existing operation requirements.
- Own the screenshot timer in a `try/finally`; exercise prompt success, rejection, and timeout through the existing full journey runner with a fake driver, without adding a public helper only for tests.
- Run a pinned official actionlint release against all workflows, and the affected simulation typecheck/unit tests and mock lane.

## Risks / Trade-offs

- Granting issue-write capability changes the job token → limit it to the scheduled/manual watch job and retain immutable action pins.
- Source-level workflow validation cannot prove remote issue creation → verify the configuration and documented permission model; do not send unsolicited issues as a test.
