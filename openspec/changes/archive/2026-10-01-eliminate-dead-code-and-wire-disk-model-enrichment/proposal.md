## Why

A repository-wide audit found four pieces of first-party code that are **unreachable in production**, all hidden from `cargo clippy`/`tsc` because they sit behind `pub` boundaries in a library crate and a named export in a frontend module. One of them is not merely dead — it is a **finished enrichment function that the product needs and never calls**, which is why the sidebar can display a raw device path as a disk's name.

**1. `query_disk_models_wmi` is implemented, documented, and never called.**
`src-tauri/src/collector/disk.rs` defines it and states its purpose precisely:

```rust
/// Query Win32_DiskDrive for Index and Model. Returns map from physical drive index to model name.
/// Used as the preferred display name when sysinfo returns a device path (e.g. \\.\PhysicalDrive0).
pub fn query_disk_models_wmi(wmi_con: Option<&wmi::WMIConnection>) -> HashMap<u32, String> {
```

It is re-exported from `collector/mod.rs` and again from `lib.rs`, and that is the **only** place it appears — there is no call site anywhere in `src/`, `examples/`, or `tests/`. Meanwhile `physical_disk_list()` decides the sidebar's disk name unconditionally from sysinfo:

```rust
let sysinfo_name = mapped_letters.first()
    .and_then(|letter| known.get(letter))
    .map(|info| info.name.clone())
    .unwrap_or_else(|| disk_key.clone());
```

So on a host where sysinfo reports a device path, the hardware sidebar's "Storage" card shows `\\.\PhysicalDrive0` (or similar) to the user, and the function written specifically to replace that string is dead. The `drive_index` that `physical_disk_list` already returns per disk (it is parsed from the same PDH instance name via `pdh_instance_to_drive_index`) is exactly the key this function maps from — so the wiring is a lookup away.

**2. `hardware::detect`, `detect_disks`, and `CpuIdentity::probe` are transitively unreachable.**
`detect_with_cpu` is the function every caller actually uses (`state.rs`, `main.rs`, `examples/startup_probe.rs`). `detect()` has **no call site** outside its own module, and it is the only caller of `detect_disks()` and of `CpuIdentity::probe()` — the latter's own doc says it is "Only for callers with no System available (see `from_sysinfo`)", and every such caller has been refactored to reuse an existing `System`. Three dead symbols, each carrying a doc comment that describes a use that no longer exists.

**3. `CollectorState::new()` builds a profile that is immediately discarded, using the wrong key scheme.**
`state.rs` constructs a full `HardwareProfile` via `disk_infos_from(&disks)`, which keys disks by `d.name()` — the *sysinfo* name, i.e. the same device-path-shaped value as (1). Every production caller then overwrites it before use:

```rust
let mut collector_state = CollectorState::new();      // state.rs builds profile (wrong disk keys)
let physical = physical_disk_list(&collector_state.sysinfo_disks, &collector_state.pdh);
…
collector_state.profile = hardware::detect_with_cpu(…);   // main.rs overwrites it with drive-letter keys
```

So each session start pays for a `HardwareProfile` construction that is thrown away, and in the window between the two lines the profile carries the *wrong* disk identity scheme relative to every other consumer (dashboard, sidebar, persisted layout all use drive-letter keys). The comment in `state.rs` justifying the construction still refers to the removed `hardware::detect(None, None, None)` path it replaced.

**4. `utils.gpuId` is dead in the frontend.**
`src/utils.ts` exports `gpuId(name)`, a legacy display-name→card-id slugifier. The only reference anywhere is its own test (`src/utils.test.ts`). Card ids moved to the collector's stable GPU key long ago (`gpu_<key>`), and the legacy-id migration that used to need the slug now lives in `migrateLegacyGpuCardOrder`, which builds the slug inline.

Root cause common to all four: **this repository has no dead-code detection that sees across a crate/module boundary.** `clippy` reports nothing because `pub` items in a lib crate are reachable *by the crate's API contract*; `tsc`'s `noUnusedLocals` does not apply to `export`ed symbols. Dead code therefore accumulated silently through several well-executed refactors, and in one case a feature was completed and then left disconnected.

## What Changes

- **Wire the disk-model enrichment.** Call `query_disk_models_wmi` where the sidebar profile's disk name is decided, preferring the WMI `Model` for a physical drive index and falling back to the current sysinfo name. The mapping key (`drive_index`) is already returned by `physical_disk_list`; the WMI query must be requested only when a WMI connection exists, so the degraded pre-WMI startup path keeps working and is enriched when WMI becomes available.
- **Make the profile's disk identity single-sourced.** Ensure the disk list published to the sidebar uses the same drive-letter key scheme as the dashboard, so `physical_disk_list` and `poll_disk` remain the single authority for disk identity, and the transient wrong-key profile in `CollectorState::new()` no longer exists.
- **Delete the unreachable symbols** (`hardware::detect`, `detect_disks`, `CpuIdentity::probe`, and `utils.gpuId` with its test), after confirming each has no remaining consumer.
- **Add a dead-code check** so this class of drift is caught automatically rather than by audit: a lint that flags exported-but-unreferenced first-party symbols, run in the canonical gate. If a full cross-crate dead-code tool is judged too heavy, the minimum acceptable form is a targeted check for the specific pattern that produced these four findings (an exported function with no call site).
- **Document the identity authority** so the next person does not re-introduce a second key scheme: drive-letter keys come from `physical_disk_list`/`poll_disk`, and the WMI model is *presentation only* and never becomes an identity.

## Capabilities

### New Capabilities
- `dead-code-detection`: The contract that first-party exported symbols which no code path references are detected and removed by an automated check in the canonical verification lane, across both the Rust library boundary and the TypeScript module boundary where the default compiler/linter settings are blind.

### Modified Capabilities
- `stable-hardware-identity`: Adds the requirement that the physical-disk **display name** is enriched from the authoritative OS model source when available (so a raw device path is never shown to the user), while keeping the drive-letter key as the sole identity and keeping the enriched name presentation-only.

## Impact

- **Rust**: `src-tauri/src/collector/disk.rs` (wire the WMI model lookup; possibly add a small pure helper for name preference so it is unit-testable), `src-tauri/src/state.rs` (stop building the immediately-overwritten profile, or build it with the correct key scheme), `src-tauri/src/hardware.rs` (delete `detect`, `detect_disks`, `CpuIdentity::probe`), `src-tauri/src/lib.rs` + `collector/mod.rs` (drop now-unused re-exports).
- **Frontend**: `src/utils.ts` (delete `gpuId`), `src/utils.test.ts` (delete its cases).
- **Tooling**: a dead-code check added to `sys-monitor-tauri/scripts/verify.mjs` (and a dev dependency only if a tool is adopted; prefer a zero-dependency targeted check if that meets the contract).
- **No behavioural regression intended**: dashboard metrics, cadence, IPC schema, and persisted-identity semantics are unchanged. The only user-visible effect is the disk name shown in the sidebar.
- **Evidence (reproducible from the committed tree):**
  - `grep -rn "query_disk_models_wmi" src-tauri` → only the definition and two re-export lines; no call site.
  - `grep -rn "hardware::detect(" src-tauri` → no call site; the only textual match is a comment in `state.rs`.
  - `src-tauri/src/main.rs`: `CollectorState::new()` result's `profile` is reassigned by `detect_with_cpu` a few lines later.
  - `grep -rn "gpuId(" sys-monitor-tauri/src` → the definition in `utils.ts` plus references only inside `utils.test.ts`.
