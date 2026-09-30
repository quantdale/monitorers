## 1. Correct the drifted version table in `.cursorrules`

- [x] 1.1 Read `sys-monitor-tauri/package.json` and `sys-monitor-tauri/src-tauri/Cargo.toml` and record the authoritative declared ranges for every package named in `.cursorrules` §1.
- [x] 1.2 Update the `.cursorrules` §1 Backend row to the declared `sysinfo`, `windows`, `wmi`, `nvml-wrapper`, `nvapi-sys` requirements.
- [x] 1.3 Update the `.cursorrules` §1 Frontend, Charts and Icons rows to the declared `react`/`react-dom`, `typescript`, `vite`, `@vitejs/plugin-react`, `recharts`, `lucide-react` ranges; add a sentence naming `package.json`/`Cargo.toml` as the source of truth for this table.
- [x] 1.4 Update the Tauri JS row to the declared `@tauri-apps/api`, `@tauri-apps/plugin-store`, `@tauri-apps/cli` ranges.
- [x] 1.5 Re-read the whole §1 table and confirm no superseded major/minor remains.

## 2. Correct the mechanism claims

- [x] 2.1 Re-read `sys-monitor-tauri/src-tauri/src/collector/run_loop.rs` and confirm the exact placement of `registry.commit_all` relative to the `if let Some(ref r) = raw` block.
- [x] 2.2 Rewrite the `.cursorrules` history-cadence invariant bullet so it describes the real gate: history commits (`commit_disk_network`/`commit_cpu`/`commit_gpu`/`push_timestamp`) are inside the full-poll branch, and on registry-only ticks `reg_raw` is all-`None` so `commit_all` is a no-op. Do not claim `commit_all` is nested inside the full-poll branch.
- [x] 2.3 Record the before/after text of every edited invariant sentence in this change's `evidence.md`.

## 3. Remove the intra-file schema contradiction and the hardcoded counts

- [x] 3.1 In `AGENTS.md`, replace the "Schema version is **4**" corrected-claims bullet with a wording that defers to the single IPC-contract statement (currently 5) instead of restating a value.
- [x] 3.2 Confirm no other file advertises a second current snapshot/lifecycle schema value; grep all tracked instruction files for the numbers and reconcile.
- [x] 3.3 In `.cursorrules` and `CLAUDE.md`, remove the hardcoded "12 tests" E2E count and replace it with the command that runs the suite (`npm run e2e`) plus a note that the count comes from the runner, matching the existing unit-test policy.

## 4. Refresh the source-layout listing

- [x] 4.1 Update the `.cursorrules` source tree to include the current backend modules that are missing (`src-tauri/src/collector/supervisor.rs`, `src-tauri/src/error_log.rs`, `src-tauri/tests/cadence_hardware.rs`) and fix the mis-indented `examples/` entries so they sit under `src-tauri/`, not `src/`.
- [x] 4.2 Update the frontend portion of the listing to name the simulation bridge (`src/sim/`) and the simulation platform (`e2e/sim/`).
- [x] 4.3 Verify every path named in the refreshed listing exists on disk and no listed path is missing.

## 5. Add the documentation-fidelity check

- [x] 5.1 Extend `sys-monitor-tauri/scripts/check-version.mjs` (or add a sibling script in the same style) to compare the versions documented in `.cursorrules` §1 against the committed manifests, comparing by leading major.minor so `^19.2.8` satisfies "React 19".
- [x] 5.2 Make the failure message name the document, the field, and the declared-versus-documented values.
- [x] 5.3 Wire the check into `sys-monitor-tauri/scripts/verify.mjs` so it runs in a lane CI executes on every pull request (the `frontend` job runs on `ubuntu-latest`; the check must be platform-agnostic with no new dependency).
- [x] 5.4 Confirm the new check runs before the slower audit/typecheck/test/build steps so a documentation failure fails fast.

## 6. Verify and record

- [x] 6.1 Run the check against the corrected docs and confirm it passes.
- [x] 6.2 Deliberately introduce a one-character version drift in a scratch edit, confirm the check fails with the expected message, then restore.
- [x] 6.3 Run `npm run verify:frontend` and confirm the whole frontend lane is green.
- [x] 6.4 Run `openspec validate reconcile-architectural-documentation-with-source --strict`.
- [x] 6.5 Confirm `git status --porcelain` shows only the intended doc/tooling files and no product source was modified.
