## Context

`RealAppDriver` needs remote debugging enabled on the packaged app's WebView2. Two channels exist:

1. `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` in the child process environment — the preferred path, scoped to the one process.
2. An HKLM policy value, used only when (1) is ignored, which happens when the host process runs elevated: WebView2 Runtime ≥150 ignores the environment variables for elevated hosts (documented upstream behaviour), and GitHub-hosted Windows runners run elevated.

The second channel is machine-wide. The driver writes it under value name `*`:

```ts
const WV2_ARGS_POLICY_KEY = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments';
this.hklmOps.write(WV2_ARGS_POLICY_KEY, '*', args);
```

So the window during which the value exists, every WebView2 application on the machine (Outlook, Teams, Widgets, anything Chromium-embedded) is launched with an open remote-debugging port and wildcard allowed-origins. On an ephemeral CI runner that is acceptable and is why the code is written this way. On a developer workstation — and `npm run sim:real` is explicitly documented in `AGENTS.md` as an opt-in **local** command — it is a real exposure window.

The driver already treats the removal as critical, and its `close()` is well structured: it aggregates failures from three independent steps and removes the policy last, outside the fallible paths. The gap is one level up: `close()` is only reached if control reaches it.

```ts
// e2e/sim/engine/runner.ts
} finally {
  …
  await selection.driver.close();   // only on an orderly unwind
}
```

A Playwright worker terminated by Ctrl-C, a crash, or a CI hard timeout never unwinds. There is no `process.on(...)` handler anywhere in `e2e/` or `src/` to compensate, and no watchdog. The value therefore survives with no in-product signal, and `AGENTS.md` gives a developer no reason to suspect it.

A secondary weakness: `removeHklmArgsFallback` clears its `hklmArgsValueWritten` flag in a `finally` immediately after the call, so if removal silently no-ops, the driver has already forgotten it owns the value and the run reports clean.

## Goals / Non-Goals

**Goals:**

- Guarantee removal on every termination path the process can be ended by, including signals.
- Make removal *verifiable*: a still-present value must be surfaced, not swallowed.
- Keep the value's blast radius and its manual recovery documented where the write happens and where a developer would look.
- Extend the existing unit-test seam so these properties are tested without touching a real registry.

**Non-Goals:**

- No change to the product application, the mock lane, or the plain E2E lane.
- No change to the per-run isolation guarantees that already work (temp app-data, fresh port, developer-store self-test) — those are proven and out of scope.
- Not attempting to *remove* the HKLM fallback. It is required for elevated hosted runners; the problem is its lifetime and blast radius, not its existence.
- No change to the shipped configuration (the `simulation-config-lint` job already guarantees no debugging flag is in shipped config, and that stays true).

## Decisions

### D1 — Register process-level cleanup handlers in the driver, and make them idempotent

`RealAppDriver` should register `process.once` handlers for `SIGINT`, `SIGTERM`, `exit`, and `uncaughtException` at the point it first writes the value, and remove them when the value is removed. Synchronous registry work is required: an `exit` handler cannot await, so removal in the signal path must use the synchronous `execFileSync`-based `RegHklmPolicyOps` that the driver already provides (which is exactly why that seam exists). The `exit` handler is the catch-all for paths that bypass the others.

- **Alternative considered — a detached watchdog child process that removes the value if the parent dies.** Rejected: it introduces a second process whose own lifetime and failure modes are harder to reason about than the thing being fixed, and it would itself need cleanup. Signal handlers address the actual failure mode (operator interrupt / job termination).
- **Alternative considered — rely on the CI job's `if: always()` teardown step.** Rejected: that covers only CI, not the documented local `npm run sim:real` path, which is where the exposure matters most. It is also not sufficient for a hard runner eviction.
- **Alternative considered — move the policy to a per-application value name instead of `*`.** Attempted first, and preferable if WebView2 supports scoping the policy per host executable on the target runtimes. This is a genuine open question (see below): if a narrower value name is honoured, the blast radius shrinks from "every WebView2 app" to "this app", which would be strictly better. The implementer should test this first; if `*` is the only supported form, keep `*` and rely on the lifetime guarantees below.

### D2 — Verify removal by reading the value back

`removeHklmArgsFallback` should, after attempting removal, read the value back and treat "still present" as a failure. This requires a `read` on the `HklmPolicyOps` seam — a small, additive extension of an interface that already exists purely so these paths can be unit-tested without a real hive. The existing `RealAppDriver.close.test.ts` cases (write-then-close, close with process-close failure, close with work-dir failure, aggregated failures, refused write) all keep working; new cases cover the still-present-after-removal and signal-path behaviours.

### D3 — Document scope and recovery at the write site and in the developer docs

The comment at `WV2_ARGS_POLICY_KEY` should state that `*` affects all WebView2 hosts and that the value is intended to exist only for the run's duration. The recovery commands belong where a developer would look after a bad run — the packaged-lane documentation (`AGENTS.md` and/or the app README's verification-gates section), not only in driver source.

### D4 — Bound the CI/qualification exposure explicitly

Where the driver runs unattended (the `simulation-real` job and the release-qualification jobs), the teardown should assert the value is absent as part of the job's own cleanup, so a leaked value is caught by the job's exit status rather than only by the next run's `applyHklmArgsFallback`. This is cheap: one `reg query` per job.

## Risks / Trade-offs

- **[A signal handler doing synchronous `execFileSync` could itself throw]** → Wrap handler bodies so they can never throw out of the handler; a throwing signal handler turns a clean Ctrl-C into an unhandled exception and can prevent other handlers from running. The removal call already has a documented "one attempt, never re-enter" rule, which the handler must preserve.
- **[`process.on('exit')` runs on every exit, including after a successful `close()`]** → Idempotence: the handler is registered when the value is written and unregistered when the value is confirmed removed, so a normal run has no live handler by the time it exits.
- **[Handler registration in a class that may be instantiated more than once]** → `run.spec.ts` constructs a fresh `RealAppDriver` per selection, so handlers must be per-instance and torn down per-instance, not registered once globally.
- **[Verifying removal costs an extra registry read per teardown]** → Negligible (a few ms once per run), and it replaces a whole class of silent failure.
- **[Adding a signal handler changes Ctrl-C behaviour for developers running the lane]** → In the normal case Ctrl-C will now also remove the policy before exiting, which is the desired outcome. If a developer relies on killing the process instantly, the removal still runs first because it is synchronous and fast.

## Migration Plan

1. Extend the `HklmPolicyOps` seam with a `read` operation and implement it against `reg.exe` (`reg query`), plus a test double.
2. Implement verified, idempotent removal in `RealAppDriver`, including the "still present" failure path.
3. Register/unregister the process-level termination handlers at write/removal time.
4. (Conditional) test whether a narrower, per-application policy value name is honoured by the target WebView2 runtimes; if so use it and update the blast-radius comment.
5. Extend `RealAppDriver.close.test.ts` with the new cases; confirm all existing cases still pass.
6. Add the documented recovery commands to the developer documentation.
7. Add the post-teardown absence assertion to the CI jobs that run the packaged lane.
8. Rollback: revert the driver/test/docs changes. No product or schema impact.

## Open Questions

- Whether WebView2 honours a per-application `AdditionalBrowserArguments` value name (narrowing the blast radius from all hosts to just the app under test) is a runtime-behaviour question that needs a real WebView2 host to answer. It does not change the specs (which require removal-on-every-path, verification, and documentation regardless of scope) or the rest of the task breakdown, so it can be tested during implementation and the result recorded.
