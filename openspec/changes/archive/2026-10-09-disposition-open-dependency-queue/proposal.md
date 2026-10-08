# Disposition the open dependency queue

## Why

`dependency-runtime-modernization-and-qualification` recorded a disposition for
the eight PRs that existed in August and then closed task 11.4 with "Nothing may
remain forgotten." Since then Dependabot has opened **nine more PRs** (created
2026-09-01 and 2026-10-01), and none of them is accounted for in any recorded
disposition. They are also not idle:

| PR | Group | Bump | Required checks |
|---|---|---|---|
| 35 | ui-libraries | lucide-react 1.34.0 → 1.48.0 | `Frontend — verify` **fails** |
| 37 | github-actions | actions/download-artifact 4.1.8 → 8.0.1, taiki-e/install-action | green |
| 38 | test-dom-tooling | @playwright/test 1.62.1→1.63.0, jsdom 30.0.1→30.1.1, vitest | green |
| 39 | collector-platform | nvml-wrapper 0.12.1 → 0.13.0 | green |
| 40 | react-framework | react 19.2.8→19.3.0, react-dom, @types/react, @types/react-dom | green |
| 41 | build-tooling | @vitejs/plugin-react 6.1.0→6.1.1, vite 8.2.2→8.3.1 | green |
| 42 | tauri-runtime (Rust) | tauri 2.11.5→2.12.0, tauri-plugin-store, tauri-build | green |
| 43 | tauri-js | @tauri-apps/api 2.11.1→2.12.0, plugin-store 2.4.4→2.5.0, cli | `Windows — production executable` **fails** |
| 44 | types/node | @types/node 24.13.3 → 26.6.3 | green |

Two failures are informative rather than disqualifying, and both point at real
process gaps this change closes:

- **#35 fails on documentation fidelity, not on the bump.** `check-version.mjs`
  compares `.cursorrules` §1's documented ranges against the manifests, so any
  adopted bump that changes a `major.minor` also has to update that table. The
  check is doing its job; the Dependabot PR simply cannot know that.
- **#43 fails because the Rust and JS Tauri halves were proposed separately.**
  `tauri build` compiles the frontend bundle against the JS packages and the Rust
  crates together; bumping only the JS side produces the version skew the
  August campaign's design D8 explicitly tries to prevent. The fix is to adopt
  #42 and #43 as **one cross-language stage**, which is what the grouping policy
  intended.

## What Changes

- **Adopt, in reviewable stages, every update that the existing gates can
  qualify**, and defer the rest with a recorded reason:
  - frontend framework/toolchain/UI stage (#40 React 19.3.0, #41 Vite 8.3.1 +
    plugin-react 6.1.1, #38 jsdom 30.1.1 + vitest + @playwright/test, #35
    lucide-react 1.48.0) — each bump verified by the canonical frontend lane and
    the E2E/mock-simulation lanes, with `.cursorrules` §1 updated in the same
    commit so the documentation-fidelity gate stays green by construction.
  - Tauri cross-language stage (#42 + #43 together) — verified by the Rust gate
    **and** a production executable build (`verify:tauri`), which is the check
    that caught the skew.
  - supply-chain stage (#37) — Actions updates pinned by full commit SHA, as the
    repository's immutable-pin policy requires.
  - collector platform stage (#39 nvml-wrapper 0.13.0) — verified by the full
    Rust feature matrix (default / no-default / nvapi-only / nvml-only /
    all-features) plus clippy `-D warnings` and `cargo audit`.
- **Defer with evidence** the one update that cannot be justified today
  (#44 `@types/node` 26.6.3): the Node runtime stays 24, the type surface
  deliberately tracks the runtime major, and `dependabot.yml` keeps
  `@types/node` ungrouped exactly so this decision stays attributable.
- **Record the disposition** of all nine PRs in this change's `evidence.md`
  (Adopted / Superseded / Deferred with the qualifying command or the blocker),
  and close or supersede the PRs through the GitHub API where that is available.

## Capabilities

### Modified Capabilities
- `dependency-vulnerability-audit`: extends the queue-reconciliation requirement so
  every PR opened after a campaign's disposition table is itself dispositioned,
  and so an adopted bump also updates the documented version table in the same
  change (documentation fidelity is part of the adoption, not a follow-up).

## Impact

- **Dependencies only**: `sys-monitor-tauri/package.json`,
  `sys-monitor-tauri/package-lock.json`,
  `sys-monitor-tauri/src-tauri/Cargo.toml`, `Cargo.lock`,
  `.github/workflows/*` (#37), `.cursorrules` §1.
- **Product code**: none unless a bump forces a minimal API adaptation, which
  would be recorded with its own evidence.
- **Not affected**: IPC schema versions, the collector's timing/identity
  contracts, settings schema, the simulation platform's semantics.
