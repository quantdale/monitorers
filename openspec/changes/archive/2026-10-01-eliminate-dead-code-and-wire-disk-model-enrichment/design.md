## Context

The four findings share one enabling condition: **the toolchain cannot see dead code across its own module boundary.**

- Rust: `cargo clippy --all-targets --all-features -- -D warnings` reports no dead code. It cannot. A `pub` item in a library crate is part of that crate's public API, so it is *reachable by contract* even when nothing in the repository calls it. The repo has exactly this shape: `src-tauri/src/lib.rs` is a library facade consumed by the `main.rs` binary target and by `examples/cadence_probe.rs` / `examples/startup_probe.rs`.
- TypeScript: `tsc` with `noUnusedLocals` / `noUnusedParameters` reports unused *locals*, not unused *exports*. An `export`ed symbol is considered used.

So dead code here is invisible by construction, and it accumulated across several well-executed refactors (the sysinfo 0.33→0.39 migration, the hardware-profile rework that introduced `detect_with_cpu`/`CpuIdentity`, the stable-GPU-key migration that replaced display-name slugs with `gpu_<key>`). Each of those refactors left behind exactly what a compiler cannot flag.

The most consequential instance is not dead code but a **disconnected feature**. `query_disk_models_wmi` is a complete, documented, unit-testable WMI query whose own doc states its purpose:

> "Used as the preferred display name when sysinfo returns a device path (e.g. `\\.\PhysicalDrive0`)."

`physical_disk_list` already returns, per disk, a `drive_index` parsed from the same PDH instance name (`pdh_instance_to_drive_index`), and `query_disk_models_wmi` returns `HashMap<u32 /* Index */, String /* Model */>`. The key type matches exactly. The join was available and was never written, so the sidebar shows a device path wherever sysinfo reports one.

Relatedly, `CollectorState::new()` builds a `HardwareProfile` via `disk_infos_from(&disks)` (keyed by `d.name()`, i.e. the device-path-shaped value) that `main.rs::run_session_body` overwrites within a few lines using `physical_disk_list` (keyed by drive letters). So the transient profile carries a *different key scheme* from every other consumer.

## Goals / Non-Goals

**Goals:**

- The sidebar shows the OS-reported disk model when available, and never a raw device path as a disk's name.
- Disk identity is single-sourced: one key scheme (drive letters, from `physical_disk_list`/`poll_disk`) across dashboard, sidebar, and history.
- The four unreachable symbols are removed, each confirmed dead first.
- A check exists that catches this class of drift going forward, and it distinguishes "unreferenced", "test-only referenced", and "chain of unreferenced".

**Non-Goals:**

- No change to metric collection, cadence, IPC schemas, the GPU identity scheme, or persisted-layout semantics.
- No change to `physical_disk_list`/`poll_disk` key derivation — that is the correct, already-tested authority.
- No wholesale public-API redesign of the library facade. `lib.rs` exists deliberately so probes can share the real loop; trimming it is a separate concern.
- No adoption of a heavyweight dead-code toolchain if a zero-dependency targeted check satisfies the contract (see D3).

## Decisions

### D1 — Wire the model lookup as a pure, unit-testable preference helper

The join should not be written inline in `main.rs`. Extract a pure function that takes the disk's `drive_index`, the WMI model map, and the current fallback name, and returns the name to display. That makes the three cases (model present → model; index absent from map → fallback; map empty/no WMI → fallback) unit-testable with no WMI connection, matching the repo's existing convention of testing pure helpers rather than OS-backed functions (`cpu.rs::variant_to_tenths_kelvin`, `disk.rs::pdh_instance_to_drive_letters`, `gpu.rs::extract_luid_from_name`).

- **Alternative considered — enrich inside `physical_disk_list`.** Rejected: that function takes `&PdhHandles` and no WMI connection, and it runs on the **pre-WMI** startup path where the connection does not exist yet. Threading `Option<&WMIConnection>` into it would force the degraded-startup path to carry a WMI dependency and would complicate the call sites that exist precisely to avoid WMI.
- **Alternative considered — call `query_disk_models_wmi` once at WMI-ready time in `main.rs`.** Acceptable and likely necessary (the sidebar profile is rebuilt when WMI becomes available), but the *selection rule* still belongs in a pure helper. Both pieces are needed: a call site and a tested rule.
- **Alternative considered — use `Win32_DiskDrive.Model` for the key as well as the name.** Rejected: this violates `stable-hardware-identity`. Drive letters are the scheme the dashboard, history channels, and persisted layout already depend on; changing identity now would be a breaking, high-risk migration for a presentation-only improvement.

### D2 — Stop building the immediately-overwritten profile in `CollectorState::new()`

Two viable shapes:

1. Remove the profile construction from `CollectorState::new()` and let the profile default to an empty/placeholder `HardwareProfile` that callers replace.
2. Keep a construction there but build it from `physical_disk_list` so the key scheme is correct even transiently.

Option 1 is preferable: it removes duplicated OS work from every session start (the same class of saving the `startup_probe` example exists to measure), and it makes it impossible to publish a wrong-key profile. It requires the struct to have a sensible default and `main.rs`/`startup_probe.rs` to set it — which they already do, unconditionally, immediately after construction.

- **Alternative considered — keep the construction and only fix its key scheme.** Rejected: it preserves work whose result is provably discarded, and the `state.rs` comment justifying it still references a call (`hardware::detect(None, None, None)`) that no longer exists.
- **Note**: `CollectorState` derives no `Default`, so a small explicit default is needed; this is a contained change and the compiler will enumerate every construction site.

### D3 — Prefer a zero-dependency targeted check over a full dead-code tool

Options considered:

- **`cargo udeps` / `cargo-llvm-lines` style tooling.** Effective but adds a build-time dependency, requires nightly-adjacent LLVM in some configurations, and does not cover the TypeScript side at all. Two toolchains for one problem.
- **A purpose-built check** that, for a given language, enumerates first-party declared symbols and greps first-party sources for references, then subtracts the symbol's own declaration, its own test file, and an explicit allow-list. Zero dependencies, runs in the existing Node verification harness, and covers both languages with one mental model.

Choose the purpose-built check. The spec is written in terms of the *capability* (detect unreferenced exports across both boundaries, distinguish unreferenced / test-only / dead-chain, allow-list intentional entry points with reasons), not a specific tool, so a future contributor can swap in a heavier tool if the codebase grows into needing one. The allow-list is essential: `lib.rs`'s facade re-exports (`run_collector_loop`, `LoopLimit`, `TICK_INTERVAL`, `SCHEMA_VERSION`, …) are consumed by the probe examples and by tests, and some are consumed by neither *today* but are the crate's deliberate public surface.

### D4 — Delete `utils.gpuId` together with its test

The function and its five test cases exist only for each other. The legacy-slug logic that genuinely still exists is `migrateLegacyGpuCardOrder` in `cardIdentity.ts`, which builds the slug inline. Deleting both the function and the test is a net reduction with no behavioural effect.

## Risks / Trade-offs

- **[The dead-code check produces false positives on legitimately public-but-unused API]** → Mitigated by the explicit allow-list with reasons, and by requiring the check to distinguish "referenced only by tests" (still reported) from "referenced by another unreferenced symbol" (reported as a chain). During implementation, every allow-list entry must be justified in the same commit.
- **[A symbol is deleted that a probe example or an out-of-tree consumer needs]** → Mitigated by the requirement that the check treats binary/example targets as real references, and by the task list requiring each deletion to be confirmed against `src/`, `examples/`, and `tests/` before removal.
- **[Wiring the model lookup changes what the sidebar displays]** → This is the intended user-visible change, but it must degrade safely: no WMI → current behaviour exactly. The WMI-enrichment path in `main.rs` already re-runs `detect_with_cpu` when WMI becomes ready, which is the natural place to apply the enriched names.
- **[Two disks sharing a model string]** → Explicitly covered: the enriched name is presentation-only; identity remains the drive-letter key, so the two remain distinct. This mirrors the existing `migrateLegacyGpuCardOrder` ambiguity rule.
- **[Removing the profile construction from `CollectorState::new()` touches every construction site]** → The compiler enumerates them; `main.rs`, `startup_probe.rs`, and the Rust tests that construct `CollectorState` are the known set.
- **[The check runs on every PR and could slow the lane]** → A grep/reference scan over a repo this size is sub-second; measured in the evidence.

## Migration Plan

1. Add the pure name-preference helper with unit tests covering: model present, index missing from the map, empty map (no WMI), and two disks sharing a model.
2. Wire it at the profile-construction points (startup path falls back; WMI-enrichment path prefers the model).
3. Remove the immediately-overwritten profile construction from `CollectorState::new()`; fix all construction sites; update the stale `state.rs` comment.
4. Delete `hardware::detect`, `detect_disks`, `CpuIdentity::probe`, and their now-empty re-exports; delete `utils.gpuId` and its test cases.
5. Add the dead-code check + allow-list and wire it into the canonical lane.
6. Verify: `cargo test` / `clippy -D warnings` / `fmt`, `npx tsc --noEmit`, `npm test -- --run`, and the packaged lane (which is what actually renders the sidebar).
7. Rollback: revert the wiring and the deletions together. No persisted state, schema, or identity semantics change, so rollback is safe at any point.

## Open Questions

- Whether `lib.rs` should keep facade re-exports that no in-repo consumer uses today is a genuine judgement call the implementer makes with the allow-list in hand. It does not change the specs (which require an explicit, justified allow-list either way) or the task breakdown.
