## Why

The three tracked instruction files that agents are explicitly told to treat as the architectural source of truth (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`) contain **verified factual drift from the current source**, and two of the drifts are actively dangerous:

1. **`.cursorrules` publishes a stale dependency stack.** Its section-1 table claims `sysinfo 0.33`, `windows 0.61`, `wmi 0.13`, `nvml-wrapper 0.10`, `React 18` / `"react": "^18.2.0"`, `TypeScript 5`, `Vite 6` / `"vite": "^6.4.3"`, `"recharts": "^3.8.0"`, `"lucide-react": "^0.460.0"`. The committed `Cargo.toml`/`package.json` are `sysinfo 0.39`, `windows 0.62`, `wmi 0.18`, `nvml-wrapper 0.12`, `react ^19.2.8`, `typescript ^7.0.2`, `vite ^8.2.2`, `recharts ^3.10.1`, `lucide-react ^1.34.0`. This is the residue of the `dependency-runtime-modernization-and-qualification` campaign, which migrated every one of these and left the doc behind.
2. **`.cursorrules` documents a code gate that does not exist.** Its "Architecture Invariants" section states: *"Implementation: `registry.commit_all` is gated inside `if let Some(ref r) = raw` so it only runs on full ticks."* In `collector/run_loop.rs` that call is **outside** the `if let Some(ref r) = raw` block; the actual 1 Hz gate is that `reg_raw` is all-`None` on full-poll ticks. A future agent trusting this text could "fix" the loop by moving the call inside the block — silently disabling the 250 ms live scalar path that the same file documents as a core behavior.
3. **`AGENTS.md` contradicts itself on the IPC schema version.** Its corrected-claims list asserts "Schema version is **4**", while its IPC section (correctly) says the current value is **5**. Actual `SCHEMA_VERSION` = `EXPECTED_SCHEMA_VERSION` = 5. This directly violates the *active* requirement in `openspec/specs/project-documentation-accuracy/spec.md`: "A repository file SHALL NOT advertise two different current values for the same contract."

`.cursorrules` and `CLAUDE.md` also both state the E2E suite is "12 tests"; the suite actually contains **14** `test()` blocks across 7 spec files.

## What Changes

- **Rewrite `.cursorrules` section 1's version table** to the versions actually declared in `sys-monitor-tauri/package.json` and `src-tauri/Cargo.toml`, and state the source of truth for each.
- **Correct the `registry.commit_all` invariant text** in `.cursorrules` to describe the gate that actually exists (registry-only ticks produce all-`None` `RawPoll`s, so `commit_all` is a no-op there; the `if let Some(ref r) = raw` block guards the *history* commits only).
- **Remove the contradictory "Schema version is 4" line** from `AGENTS.md` and make it defer to the single IPC-contract statement.
- **Correct the E2E test count** in `.cursorrules` and `CLAUDE.md`, or (preferred, and consistent with the repo's existing policy) remove the hardcoded count and replace it with the command that produces it.
- **Refresh `.cursorrules`'s source-tree listing** so it names the files that exist today (`collector/supervisor.rs`, `error_log.rs`, `src-tauri/tests/cadence_hardware.rs`, `src/sim/*`, `e2e/sim/*`) rather than an out-of-date subset with a mis-indented `examples/` block.
- **Add a machine-checkable guard** so this class of drift cannot silently return: a lightweight check that compares the versions declared in `.cursorrules`'s table against the manifest/lockfile and fails when they disagree, wired into the canonical verification lane.

## Capabilities

### New Capabilities
- `architectural-documentation-fidelity`: The contract that the tracked architecture/instruction documents state the dependency versions, module layout, and enforcement mechanisms that actually exist in the committed source, and that the claim is machine-verified rather than maintained by hand.

### Modified Capabilities
- `project-documentation-accuracy`: Extends the existing accuracy contract beyond test counts and deleted-file references to cover **dependency-version claims** and **documented invariant/mechanism descriptions** (i.e. a doc that names a specific code mechanism must describe the mechanism that is actually implemented), and adds a scenario for the self-contradicting schema-version claim.

## Impact

- **Files (documentation only, no product code)**: `.cursorrules`, `AGENTS.md`, `CLAUDE.md`.
- **Tooling**: a new check script under `sys-monitor-tauri/scripts/` plus one line in `sys-monitor-tauri/scripts/verify.mjs` (`frontend()` or a new lightweight pre-step) so the claim stays true.
- **No product behaviour changes.** `SCHEMA_VERSION`, `EXPECTED_SCHEMA_VERSION`, IPC payloads, and all Rust/TS source are untouched.
- **Evidence (reproducible from the committed tree):**
  - `.cursorrules` lines 10–14 vs `sys-monitor-tauri/src-tauri/Cargo.toml` and `sys-monitor-tauri/package.json`.
  - `.cursorrules` invariant text vs `sys-monitor-tauri/src-tauri/src/collector/run_loop.rs` (the `let snapshot = { ... }` block).
  - `AGENTS.md` "Schema version is **4**" vs "currently **5**" vs `SCHEMA_VERSION: u32 = 5` / `EXPECTED_SCHEMA_VERSION = 5`.
  - `grep -c "^  test(" e2e/tests/*.spec.ts` totals 14; docs say 12.
