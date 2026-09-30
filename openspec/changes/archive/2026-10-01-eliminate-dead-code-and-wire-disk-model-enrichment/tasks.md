## 1. Add the disk-model name preference as a pure, testable helper

- [x] 1.1 In `src-tauri/src/collector/disk.rs`, add a pure function that selects a disk's **display name** from (physical drive index, WMI model map, current fallback name) and returns the name to show.
- [x] 1.2 Add `#[cfg(test)]` cases in the same file: model present for the index → model returned; index absent from a non-empty map → fallback returned; empty map (no WMI) → fallback returned; two disks sharing one model string → both keep distinct drive-letter keys (identity unaffected).
- [x] 1.3 Confirm the helper has no WMI dependency of its own (it takes the already-queried map), so it is testable without a connection.

## 2. Wire the enrichment into profile construction

- [x] 2.1 At the pre-WMI startup path in `main.rs::run_session_body`, keep the current sysinfo-name behaviour (no WMI connection exists yet) — the fallback must be byte-identical to today's behaviour.
- [x] 2.2 At the WMI-enrichment path (the `on_wmi_ready` callback that re-runs `detect_with_cpu`), call `query_disk_models_wmi` and apply the helper so the sidebar's disk cards show the OS model.
- [x] 2.3 Verify the enriched name is used for **presentation only**: the disk's `key` must still come from `physical_disk_list`'s drive-letter join, and `DiskInfo.key`/`DiskHistory.key`/`DiskSnapshot.key` must remain identical across dashboard, sidebar, and history.
- [x] 2.4 Confirm a WMI query failure degrades to the fallback name and still lists the disk (no disk is dropped and no panic occurs).

## 3. Remove the immediately-overwritten profile construction

- [x] 3.1 In `src-tauri/src/state.rs`, stop building a `HardwareProfile` inside `CollectorState::new()` (give the field a sensible default) so no wrong-key profile exists transiently.
- [x] 3.2 Fix every `CollectorState::new()` construction site (`main.rs::run_session_body`, `examples/startup_probe.rs`, and the Rust tests) — let the compiler enumerate them.
- [x] 3.3 Update the stale comment in `state.rs` that justifies the construction by referencing `hardware::detect(None, None, None)`, which no longer exists.
- [x] 3.4 Confirm `cargo test` still passes and the startup probe still reports the same bootstrap phases (it overwrites the profile itself).

## 4. Delete the confirmed-dead symbols

- [x] 4.1 Before deleting, re-confirm each of `hardware::detect`, `hardware::detect_disks`, `CpuIdentity::probe` has no caller in `src/`, `examples/`, or `tests/` (record the grep output as evidence).
- [x] 4.2 Delete `detect`, `detect_disks`, and `CpuIdentity::probe` from `src-tauri/src/hardware.rs`, removing or updating any test that existed only for them.
- [x] 4.3 Remove now-unused re-exports from `src-tauri/src/lib.rs` / `collector/mod.rs` if any referenced the deleted symbols.
- [x] 4.4 Delete `gpuId` from `src/utils.ts` and its test cases from `src/utils.test.ts` (it is referenced only by its own test).
- [x] 4.5 Confirm `migrateLegacyGpuCardOrder` in `cardIdentity.ts` still builds its legacy slug inline and needs no replacement.

## 5. Add the dead-code check

- [x] 5.1 Implement a zero-dependency check that, per language (Rust and TypeScript), enumerates first-party declared symbols, greps first-party sources (including `examples/`, `tests/`, and test files) for references, and reports symbols with no production reference.
- [x] 5.2 Make the check distinguish and report separately: referenced nowhere; referenced only from its own test; referenced only by other unreferenced symbols (a dead chain — report the root).
- [x] 5.3 Add an explicit allow-list with a written reason per entry for the intentional public surface (e.g. the `lib.rs` facade re-exports consumed only by probes or reserved for them).
- [x] 5.4 Wire the check into `sys-monitor-tauri/scripts/verify.mjs` so it runs in a lane CI executes on every PR.
- [x] 5.5 Verify the check passes on the current tree after step 4, and that it *would* have flagged the four findings (confirm by temporarily reintroducing one dead export, observing the report, then removing it).

## 6. Verify

- [x] 6.1 Rust: `cargo test`, `cargo test --all-features`, `cargo fmt -- --check`, `cargo clippy --all-targets --all-features -- -D warnings` all green.
- [x] 6.2 Frontend: `npx tsc --noEmit` and `npm test -- --run` green (after removing the `gpuId` tests).
- [x] 6.3 `npm run sim:typecheck` green.
- [x] 6.4 If a built exe is available, `npm run verify:packaged` green and manually confirm the sidebar shows disk model names (not device paths) on a host where sysinfo reports device paths.
- [x] 6.5 Run `openspec validate eliminate-dead-code-and-wire-disk-model-enrichment --strict`.
- [x] 6.6 Confirm `git status --porcelain` shows only the intended Rust/TS/tooling files and that no IPC schema or persisted-identity behaviour changed.
