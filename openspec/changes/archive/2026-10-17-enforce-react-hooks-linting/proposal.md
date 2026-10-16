## Why

The repository has never enforced React-hooks rules: no linter config, no
`lint` script, no linter dev dependency. `CLAUDE.md`, `.cursorrules`, and
`AGENTS.md` all record this as a known gap, with the blocker spelled out —
`typescript-eslint` declares `peer typescript ">=4.8.4 <6.1.0"` and cannot be
adopted while the repo is on TypeScript 7 (verified again today:
`typescript-eslint@8.71.2` still carries that peer range).

The gap is not theoretical. An `oxlint@1.88.0` trial (native TypeScript
parsing — no typescript-eslint involved) over `src/` + `e2e/` with only
`react/rules-of-hooks` and `react/exhaustive-deps` enabled reports four
findings in first-party code:

1. `src/hooks/useSettings.ts` — **`rules-of-hooks` violation**: the
   provider-less fallback in `useSettings()` calls `useSettingsState()` after
   an early `if (context) return context;`, so the hook count differs between
   renders with and without a provider. It is latent only because the app
   always mounts `SettingsProvider`; any future consumer rendered without one
   silently corrupts hook order.
2. `src/App.tsx` — `settings.cardOrder ?? []` allocates a fresh array every
   render while `cardOrder` is null, defeating the `visibleCardOrder` /
   `cards` memos that exist precisely to keep the Recharts subtree from
   rebuilding per tick.
3–4. `src/components/MetricCard.tsx` — the chart memo's dependency array uses
   a complex inline expression and omits dependencies, guarded only by a prose
   comment ("There is no linter in this project enforcing exhaustive-deps").

## What Changes

- `oxlint` becomes a dev dependency (pinned to `1.88.0`) with a committed
  `.oxlintrc.json` that enables exactly the two React-hooks rules —
  `react/rules-of-hooks` and `react/exhaustive-deps` — as **errors**. Other
  rule families oxlint ships (unicorn, oxc, react compiler lints) are
  deliberately out of scope: this gate closes the recorded gap, it does not
  import a foreign style guide.
- `npm run lint` runs the gate over `src/` and `e2e/`; `scripts/verify.mjs`
  runs it inside the `frontend()` lane, so CI's `frontend` job and
  `.husky/pre-push` (`verify:fast`) enforce it with no workflow edits.
- The four findings are fixed honestly, not suppressed:
  - `useSettings()` becomes a provider-required context hook that fails
    loudly without a provider; the provider-less engine is exported
    (`useSettingsState`) for the unit tests that pin standalone behavior, and
    the component tests that rendered consumers without a provider wrap them
    in `SettingsProvider`.
  - `App.tsx` hoists a stable empty-order constant so the memo identity is
    real.
  - `MetricCard.tsx` extracts the effective secondary series to a variable so
    the dependency array is static and complete — same recompute semantics as
    the hand-shaped array it replaces, now checkable.
- The three documentation surfaces (`AGENTS.md`, `CLAUDE.md`,
  `.cursorrules`) stop describing the gap and start describing the gate,
  including the new command in the frontend gate list.

## Capabilities

### New Capabilities

- `react-hooks-lint-gate`: first-party React code is checked against the
  React-hooks rules (rules-of-hooks and exhaustive-deps) by a committed lint
  configuration that is part of the frontend verification gate.

### Modified Capabilities

- None. `frontend-verification-coverage` and `dead-code-detection` keep their
  existing scopes; this gate is additive.

## Impact

- Tooling: `sys-monitor-tauri/package.json` (+ lockfile),
  `sys-monitor-tauri/.oxlintrc.json`, `scripts/verify.mjs`.
- Source fixes: `src/hooks/useSettings.ts`, `src/App.tsx`,
  `src/components/MetricCard.tsx`, plus test harness updates
  (`useSettings*.test.ts`, `HardwareSidebar.test.tsx`).
- Docs: root `AGENTS.md`, `CLAUDE.md`, `.cursorrules`.
- Not affected: Rust, collector, IPC schema, settings persistence semantics,
  the sim/e2e platforms beyond the harness updates above.
- Verification: `npm run lint` clean, both typechecks, the full unit suite,
  build, and the E2E suite. The packaged lane is not required for tooling and
  hook-structure changes; do not claim it was run.
