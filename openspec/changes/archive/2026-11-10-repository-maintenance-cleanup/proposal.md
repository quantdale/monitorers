## Why

The canonical dead-code gate reports **zero** unreferenced symbols on a tree that contains two. It counts raw text occurrences, including comments, so a doc comment saying "identical to `sliceWindow`" counted as a reference to `sliceWindow` and hid a function no code path called. The same blindness let a second dead export (`clearSimScenario`) survive while its own doc comment claimed journeys called it. A verification gate that reports clean when it is not is worse than no gate, because it certifies the defect.

The same audit pass found a small set of low-risk drift and clutter items that accumulated across campaigns: a documented backend entry point that does not exist, an architecture note that places a constant in the wrong module, a register entry pointing at a section that was never written, a bash-generic prompt file committed as if it were project state, two unreferenced template assets, an unused package field, and two unused locals in the gate itself.

## What Changes

- **Fix the dead-code gate's reference counting (the substantive change).**
  Extract the scanner into `scripts/dead-code-scan.mjs`, stripping comments before counting while preserving strings, template literals, Rust raw strings, char literals, lifetimes, and JSX apostrophes. Report a chain's dead source file, not just its root. Give the scanner red-capable unit coverage (`scripts/dead-code-scan.test.mjs`) in the Vitest lane.
- **Remove the two symbols the corrected gate exposes.** `sliceWindow` was reachable only from its own test and duplicated the private `sliceWithRange` implementation, which is the one production code actually used — the two are merged into one exported `sliceByRange` with real production call sites. `clearSimScenario` had no caller at all.
- **Delete two phantom allowlist entries.** One key could never match any symbol; the other named a symbol with a real production caller.
- **Collapse one duplicated Rust mapping.** `SysDiskKind → DiskKind` was written twice (`hardware.rs` and `main.rs`'s startup profile builder); both now call one `disk_kind_of`, with a test pinning its Unknown handling.
- **Documentation truth.** `.cursorrules`/`CLAUDE.md` named a `detect()` that does not exist; `CONTEXT.md` placed `MAX_CHART_POINTS` in the wrong module; `exploratory-register.md` pointed at a missing 2026-08-26 section; `opsx-remediation-evidence.md` presented 2026-08-03 counts as current.
- **Clutter.** Remove the repository-generic `deep review resolve.txt` prompt (byte-identical to copies in two other repositories, zero inbound references), the unreferenced `src/assets/react.svg` and `public/tauri.svg`, and the `"main": "index.js"` field of a scripts-only root package.
- **Pin one copied literal.** `mockBackend.test.ts` hard-coded the schema version beside a sibling test that pins the same value to `EXPECTED_SCHEMA_VERSION`.

Not in scope: dependency adoption (the 11 open Dependabot PRs are their own campaign), any change to the collector loop, IPC contract, schema versions, or persisted settings shape.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dead-code-detection` — the detection requirement gains the rule that comments are not references, and the chain requirement gains the dead-source attribution.

## Impact

`sys-monitor-tauri/scripts/dead-code-scan.mjs` (new), `scripts/dead-code-scan.test.mjs` (new), `scripts/check-dead-code.mjs` (now a reporting CLI), `src/hooks/useMetrics.ts` + `src/hooks/useMetrics.test.ts` (one merged slicing helper, windowing tests), `src/sim/mockBackend.ts` (dead export removed), `src-tauri/src/hardware.rs` + `src-tauri/src/main.rs` (one shared disk-kind mapping), `.cursorrules`, `CLAUDE.md`, `CONTEXT.md`, `opsx-remediation-evidence.md`, `sys-monitor-tauri/e2e/exploratory-register.md`, `package.json`, and the three removed files. No IPC, schema, or persisted-state change; no new dependency.
