# Evidence — enforce React-hooks linting

Date: 2026-10-17. Machine: Windows (dev host). All commands from
`sys-monitor-tauri/` unless noted.

## Pre-fix findings (the gate's first run, verbatim)

`npx oxlint@1.88.0 src e2e` with only `react/rules-of-hooks` and
`react/exhaustive-deps` enabled (trial before the config landed) reported
exactly four `react-hooks` errors in first-party code:

```
src/hooks/useSettings.ts:258:10: error react-hooks(rules-of-hooks): React Hook "useSettingsState" is called conditionally. …
src/App.tsx:85:6: error react-hooks(exhaustive-deps): React hook useMemo depends on `cardOrder`, which changes every render …
src/components/MetricCard.tsx:125:16: error react-hooks(exhaustive-deps): React Hook useMemo has a complex expression in the dependency array. …
src/components/MetricCard.tsx:105:25: error react-hooks(exhaustive-deps): React Hook useMemo has missing dependencies: 'hasSecondary', 'secondaryHistory', and 'hasChart' …
```

Finding 1 is a genuine Rules-of-Hooks violation: the provider-less fallback in
`useSettings()` called `useSettingsState()` after an early return, so the hook
count differed between renders with and without a `SettingsProvider`. Finding 2
was a real render-churn bug: `settings.cardOrder ?? []` allocated a fresh
array every render while the order was unset, defeating the
`visibleCardOrder`/`cards` memos that keep the Recharts subtree off the
per-tick render path.

## Fixes (no suppressions used)

- `useSettings()` is now a provider-required context hook that throws with an
  actionable message; the provider-less engine is exported as
  `useSettingsState` and is what `SettingsProvider` mounts. Test harnesses
  (`useSettings.test.ts`, `useSettings.errors.test.ts`,
  `useSettings.persistence.test.ts`) pin the engine directly,
  `HardwareSidebar.test.tsx` wraps its renders in `SettingsProvider`, and a
  new pin asserts `useSettings()` without a provider throws
  (`/SettingsProvider/`). Hook order is constant by construction.
- `App.tsx` hoists a module-level `EMPTY_CARD_ORDER` so the fallback order has
  one identity forever (memo identity contract restored).
- `MetricCard.tsx` extracts `secondarySeries = hasSecondary ? secondaryHistory
  : undefined` and the memo depends on `[hasChart, history, timestamps,
  secondarySeries]` — statically checkable, semantically identical to the
  hand-shaped array it replaces. The stale "no linter enforces exhaustive-deps
  here" comment is gone.

## Gate correctness (mutation check)

A throwaway `src/__lint_probe.tsx` with a hook after an early return produced:

```
src/__lint_probe.tsx:4:3: error react-hooks(rules-of-hooks): React Hook "useEffect" is called conditionally. …
PROBE_EXIT=1
```

and was then deleted — the gate provably fires and fails, not silently green.

## Post-fix result

- `npm run lint` (oxlint 1.88.0 exact pin, `.oxlintrc.json` scoped to the two
  React-hooks rules): **0 findings, exit 0**.
- `npm run verify:frontend` (the canonical lane, now including the
  `frontend React-hooks lint` step): **pass end-to-end** — doc fidelity 10/10,
  dead-code check, both npm audit scopes (root exit 0; application exit 0),
  `tsc`, `tsc -p tsconfig.test.json`, lint, 296 unit tests, production build.

## Gates run

- `npx tsc --noEmit` — clean
- `npm run typecheck:test` — clean
- `npm run lint` — clean (mutation-checked above)
- `npm test -- --run` — 296 passed (22 files), including the new
  provider-contract pin and the existing `SettingsProvider` shared-instance
  pin
- `npm run build` — success
- `npm run e2e` — 33 passed (includes the HardwareSidebar render harness
  change)
- `npm run sim` (mock simulation lane) — 4 passed on the combined final tree
  (see run log; also green before the harness changes)
- `openspec validate 2026-10-17-enforce-react-hooks-linting --type change --strict` — valid

## Supply-chain note

`oxlint@1.88.0` is pinned **exact** in `sys-monitor-tauri/package.json`
(devDependency) with the lockfile committed — a lint gate's verdicts must not
drift with an unrelated install. Application-scope `npm audit --audit-level=high`
stays exit 0 (`found 0 vulnerabilities`) with the new dev dependency present.

Not run, not claimed: the packaged/real lane (tooling + hook-structure change;
mock lane is the stated verification scope in the proposal).
