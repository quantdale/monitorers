# Design — enforce React-hooks linting

## Context

The repo records a React-hooks linting gap on three documentation surfaces.
The blocker is real: `typescript-eslint` cannot resolve against TypeScript 7
(`peer typescript ">=4.8.4 <6.1.0"`), so the conventional ESLint stack is
unavailable. Meanwhile `oxlint` parses TypeScript natively (no TS peer) and
implements both canonical `eslint-plugin-react-hooks` rules —
`react/rules-of-hooks` (v0.3.3+) and `react/exhaustive-deps` (v0.12.0+). A
trial at `1.88.0` over `src/` + `e2e/` surfaced four real findings,
including a genuine rules-of-hooks violation, so the gate has material to
protect.

## Options considered

### A. oxlint scoped to the two React-hooks rules

Native TS parsing, no peer conflict, sub-second runs. Config enables exactly
`react/rules-of-hooks` and `react/exhaustive-deps` as errors and turns the
default rule categories off, so the gate enforces the recorded gap and
nothing else. Rule verdicts pin to the exact `1.88.0` release so a gate
verdict cannot drift under an unrelated `npm install`.

### B. Wait for typescript-eslint to support TS 7

Keeps the gap open indefinitely with no end condition; rejected.

### C. Enable oxlint's full default rule set

Imports a foreign style guide (unicorn/oxc opinions) into a codebase with its
own documented conventions; hundreds of warnings, most noise. The recorded
gap is hooks rules specifically. Rejected — a gate should enforce a
contract the repo has committed to.

## Decision

**Option A.** Findings are fixed, not suppressed:

1. `useSettings()`'s conditional `useSettingsState()` call is a real
   rules-of-hooks hazard. Fix: `useSettings()` becomes context-only and
   throws without `SettingsProvider` (fail loudly at the call site instead of
   silently corrupting hook order); the provider-less engine is exported as
   `useSettingsState` for the unit tests that pin standalone behavior;
   `HardwareSidebar.test.tsx` wraps its renders in `SettingsProvider`. The
   hook order is now constant by construction.
2. `App.tsx`'s `settings.cardOrder ?? []` allocates per render and defeats the
   render-churn memos downstream. Fix: a module-level stable empty array.
   This is a real (if bounded) render-cost bug, not just a lint complaint.
3. `MetricCard.tsx`'s chart memo uses a complex inline dependency expression
   with a hand-shaped array. Fix: extract `hasSecondary ? secondaryHistory :
   undefined` to a `secondarySeries` variable used by the body, and depend on
   `[hasChart, history, timestamps, secondarySeries]` — statically checkable
   and semantically identical (the memo still skips when the secondary
   channel changes identity while unused). No suppression comment needed; the
   stale "no linter enforces exhaustive-deps here" prose is replaced.

## Consequences

- `npm run lint` is part of `verify:frontend` (and therefore `verify:fast`,
  CI's `frontend` job, and `.husky/pre-push`) with no workflow edits.
- A future conditional hook call or missing dependency fails the gate before
  review.
- Other oxlint rule families remain unenforced; if the repo later adopts
  them, that is its own change with its own triage.
- `useSettings()` without a provider now throws. Every production consumer
  already sits under `SettingsProvider` (`main.tsx` mounts it once); tests
  opt into the exported engine or the provider explicitly.
