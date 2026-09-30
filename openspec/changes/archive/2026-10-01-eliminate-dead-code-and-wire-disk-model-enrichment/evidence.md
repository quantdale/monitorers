# Evidence — Eliminate Dead Code and Wire Disk Model Enrichment

- Change root: `openspec/changes/eliminate-dead-code-and-wire-disk-model-enrichment/`

## A. The disk-model enrichment is now live (tasks 1.1 – 1.3, 2.1 – 2.4)

### The pure, WMI-free helper (1.1, 1.3)

`src/collector/disk.rs`:

```rust
pub fn disk_display_name(
    drive_index: Option<u32>,
    models: &HashMap<u32, String>,
    fallback: &str,
) -> String {
    drive_index
        .and_then(|idx| models.get(&idx))
        .filter(|model| !model.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
}
```

It takes the already-queried map, not a `WMIConnection`, so it is unit-testable without COM — the property task 1.3 asks for.

### Unit tests (1.2) — 5 cases, all green

```
$ cargo test collector::disk
test result: ok. 16 passed; 0 failed; ...
```

New cases: `disk_display_name_prefers_the_wmi_model_for_the_index`, `…_falls_back_when_index_is_absent_from_a_non_empty_map` (proving another disk's model cannot leak), `…_falls_back_when_no_wmi_map_exists` (empty map **and** `None` index), `…_ignores_a_blank_model`, and `two_disks_sharing_a_model_keep_distinct_drive_letter_keys`.

The last case is the identity guarantee (2.3) written as a test: two disks reporting the *same* model string still yield distinct drive-letter keys (`C:` vs `D:`), because `pdh_instance_to_drive_letters` derives the key and the name is never an input to it.

### Wiring (2.1 – 2.2)

- **Pre-WMI path unchanged (2.1).** `run_session_body` builds `disk_infos` with `disk_display_name(drive_index, &no_models, sysinfo_name)` where `no_models` is an empty map. The helper's fallback branch therefore yields exactly the old `sysinfo_name`, so startup behaviour is byte-identical — no enrichment is attempted while no WMI connection exists.
- **WMI path (2.2).** The `on_wmi_ready` callback now actually calls the previously-dead `query_disk_models_wmi(Some(wmi))` and rebuilds the disk list through the same helper:

```rust
let disk_models = query_disk_models_wmi(Some(wmi));
let enriched_disk_infos: Option<Vec<DiskInfo>> = disk_infos.as_ref().map(|infos| {
    infos.iter().enumerate().map(|(i, info)| {
        let drive_index = physical.get(i).and_then(|(_, _, _, di)| *di);
        DiskInfo { key: info.key.clone(), name: disk_display_name(drive_index, &disk_models, &info.name), kind: info.kind.clone() }
    }).collect()
});
state.profile = detect_with_cpu(Some(&state.pdh), Some(wmi), enriched_disk_infos, &state.cpu_identity);
```

`physical` is now borrowed rather than consumed, so the per-disk drive indexes remain available to the callback.

### Presentation-only, and degradation (2.3, 2.4)

- `key:` is copied verbatim from the pre-WMI `DiskInfo`; it comes from `physical_disk_list`'s drive-letter join. `git diff` over `disk.rs` shows **no** change to `disk_key` or the `letters.join(" ")` derivation. Identity across dashboard, sidebar, and history is therefore untouched, and a schema/identity contract change would have been caught by the unchanged `SCHEMA_VERSION` pair (still 5/1, verified in §D).
- A WMI query failure returns an empty map (`query_disk_models_wmi` logs and returns `HashMap::new()`), so `disk_display_name` falls back and the disk is still listed — never dropped, no panic path introduced.

## B. The immediately-overwritten profile is gone (tasks 3.1 – 3.4)

`CollectorState::new()` no longer builds a `HardwareProfile`; the field starts as `HardwareProfile::default()` and the stale comment justifying the old construction (which referenced `hardware::detect(None, None, None)`, a function that no longer exists) was replaced with a comment explaining why nothing is built there.

Because `profile` is now a default, the CPU identity needed a stable carrier. `CollectorState` gained:

```rust
/// CPU identity resolved once from the already-refreshed `System` inside
/// `new()`. Lives here, rather than being read back out of `profile`,
/// because `profile` is replaced wholesale by each re-detection…
pub cpu_identity: CpuIdentity,
```

`HardwareProfile` and `CpuVendor` gained `Default` (`#[default] Unknown` on the enum, so "default" can never be mistaken for a claim about the machine).

**Construction sites (3.2) — the compiler enumerated them, and two read the old field:**

- `main.rs::run_session_body` → `&collector_state.cpu_identity`
- `examples/startup_probe.rs` → `&collector_state.cpu_identity` (and switched to the borrowed `.iter()` form for `physical` so it mirrors production)
- The remaining `CollectorState::new()` calls are `#[cfg(test)]` units in `collector/mod.rs`, `collector/nvidia.rs`, `collector/run_loop.rs`; none read `profile`, and all compile unchanged.

**Startup probe (3.4):**

```
$ cargo run --example startup_probe
session bootstrap: CollectorState::new      median 6120 ms
session bootstrap: profile discovery        median 0 ms
session bootstrap: TOTAL                    median 6120 ms
```

Both bootstrap phases are still reported and the probe still overwrites the profile itself, as before. (The absolute numbers are inflated by this host — the first iteration pays NVML + PDH init, and other projects were competing for CPU; the invariant checked here is the phase structure, not the milliseconds.)

## C. The dead symbols are gone (tasks 4.1 – 4.5)

### 4.1 — grep evidence recorded BEFORE deletion

```
$ grep -rn "detect_disks" src/ examples/ tests/
src/hardware.rs:264:fn detect_disks() -> Vec<DiskInfo> {
src/hardware.rs:292:    let disks = disks_override.unwrap_or_else(detect_disks);
src/hardware.rs:341:        // old detect_disks produced (sidebar labels and card keys derive from

$ grep -rn "CpuIdentity::probe" src/ examples/ tests/
src/hardware.rs:279:    detect_with_cpu(pdh, wmi_con, disks_override, &CpuIdentity::probe())

$ grep -rn "hardware::detect\b|[^_a-z]detect(" src/ examples/ tests/   # excluding detect_with_cpu/detect_disks/fn detect
src/main.rs:104:  /// Returns the hardware profile … until a collector session has run detect().
src/state.rs:245:    /// Copy of hardware profile for IPC; set by background thread after detect().
```

Conclusion: `detect` had **zero** callers (only two prose comments), `detect_disks` was reachable only from `detect`, and `CpuIdentity::probe` only from `detect`. All three are one dead chain rooted at `detect`.

### 4.2 — deleted

`pub fn detect`, `fn detect_disks`, and `CpuIdentity::probe` are all removed. The deleted `detect_with_cpu` doc header that referenced `[detect]` was rewritten to describe the caller-supplied `cpu` argument directly, and the two prose comments in `main.rs`/`state.rs` that referred to "run detect()" were corrected. `CpuIdentity::probe` needed no test removal because no test used it (deleting it outright is what task 4.2 asks for — keeping it as `#[cfg(test)]` would have left a test-only symbol with no test).

`detect_with_cpu`'s `disks_override = None` fallback now inlines `disk_infos_from(&sysinfo::Disks::new_with_refreshed_list())` with a comment, so no disk list is ever silently empty.

### 4.3 — re-exports

No re-export referenced any deleted symbol. `lib.rs` and `collector/mod.rs` were re-checked; `collector/mod.rs` gained `disk_display_name` to the `pub use disk::{…}` list so `main.rs` can reach it.

### 4.4 — `gpuId`

`gpuId` was referenced only by its own test (5 cases). Removed from `src/utils.ts` and its 5 cases removed from `src/utils.test.ts`. `grep` confirms no references remain.

**The new `typecheck:test` gate from `extend-frontend-verification-to-test-sources` caught a mistake immediately**: the scripted removal left a dangling `});` in `utils.test.ts`, which `tsc -p tsconfig.test.json` reported at `src/utils.test.ts(52,1): error TS1128` while plain `tsc --noEmit` (which excludes tests) stayed clean. Fixed, and both typechecks now exit 0. That is exactly the class of error this change's predecessor was created to catch.

### 4.5 — legacy GPU slug

Confirmed `migrateLegacyGpuCardOrder` builds its own slug inline (`'gpu_' + gpu.name.toLowerCase()…` at `src/cardIdentity.ts:98`) and needed no replacement.

## D. The dead-code check (tasks 5.1 – 5.5)

`scripts/check-dead-code.mjs` (new, zero dependencies, plain Node, platform-agnostic).

- 5.1: walks `src-tauri/{src,examples,tests}` and `{src,e2e}`, enumerating `pub fn|struct|enum|const|type|trait|mod` (Rust) and `export function|const|class|interface|type|enum` (TypeScript), then counts word-boundary references across all first-party sources including `examples/`, `tests/`, and `*.test.ts(x)`. Rust files are split at their first `#[cfg(test)]` — exact for this repo's stated co-located-test convention, not a heuristic.
- 5.2: reports three categories separately: `[dead] referenced nowhere`, `[test-only] referenced only from test code`, `[chain] referenced only by other unreferenced symbols (report the root)`.
- 5.3: an explicit `ALLOWLIST` whose entries each carry a written reason; **an entry without a ≥20-character reason fails the check itself**.
- 5.4: wired into `verify.mjs::frontend()` as the second step (right after the documentation check, before both audits, typecheck, tests, and build) so it fails fastest. The CI `frontend` job runs `npm run verify:frontend` on `ubuntu-latest`, so it gates every PR.

### 5.5 — passes, and is proven non-vacuous

```
$ node scripts/check-dead-code.mjs
dead-code check: 383 first-party symbols enumerated (146 Rust, 237 TypeScript), 0 unreferenced (2 allowlisted with reasons)
```

Negative control — a dead export was reintroduced and immediately caught, then removed:

```
$ node scripts/check-dead-code.mjs
dead-code check FAILED — 1 unreferenced first-party symbol(s):
  [dead] ts __deadControlProbe — referenced nowhere (sys-monitor-tauri\src\utils.ts:31)
NEG_EXIT=1
```

### The check found four MORE dead symbols than the proposal listed

Running it on the current tree surfaced genuine, previously-unnoticed dead code in the e2e harness. Each was confirmed dead by grep (declaration only, no wildcard re-exports anywhere in `e2e/` — every import is a named import), then deleted:

| Symbol | Location |
|---|---|
| `waitForSidebarCards` | `e2e/sim/engine/steps.ts` |
| `FLAKE_BUDGET` | `e2e/sim/flake-quarantine.ts` |
| `readTextLines` | `e2e/sim/reporting/reports.ts` |
| `chartPointCount` | `e2e/tests/helpers.ts` |

This is the change's own thesis paying off: without the check these would have stayed invisible, since `tsc` never flags an unused export.

## E. Verification (task 6)

```
cargo fmt -- --check                                     → clean (FMT=0)
cargo clippy --all-targets --all-features -- -D warnings → CLIPPY=0
cargo test                          → 204 passed
cargo test --all-features            → 204 passed
cargo test --no-default-features     → 185 passed
cargo test --no-default-features --features nvml  → 198 passed
cargo test --no-default-features --features nvapi → 196 passed
npx tsc --noEmit                     → 0
npm run typecheck:test               → 0
npm run sim:typecheck                → 0
npm test -- --run                    → 20 files / 247 tests passed
npm run verify:frontend              → 0   (incl. the new dead-code step)
```

Rust counts rose from 199 to 204 (+5 new `disk_display_name` cases). Frontend counts moved 248 → 247 (+4 new driver cases from `harden-real-lane-host-state-cleanup`, −5 removed `gpuId` cases). Clippy was clean with **no** `#[allow]` added.

The packaged lane (`npm run verify:packaged`) still fails on this host for the **pre-existing, unrelated** work-directory `EPERM` recorded in `harden-real-lane-host-state-cleanup/evidence.md` §G, which reproduces identically with this change stashed. Task 6.4's second half — "manually confirm the sidebar shows disk model names on a host where sysinfo reports device paths" — therefore could not be performed: the run does not reach that point, and the enrichment path is a pure function covered by the unit cases in §A.

### 6.6 — no IPC or identity change

`SCHEMA_VERSION` is still `5` and `EXPECTED_SCHEMA_VERSION` still `5`; `LIFECYCLE_SCHEMA_VERSION` / `EXPECTED_LIFECYCLE_SCHEMA_VERSION` untouched at `1`. Disk key derivation is unchanged. `git status` shows changes confined to the intended Rust/TS/tooling files.

## F. Incidental fixes made along the way

- Two pre-existing `oxlint` style findings in files this change already edited: a string concatenation folded into a template literal, and 4 `x as unknown as T` assertions in `e2e/sim/engine/steps.ts` given the `// SAFETY:` comments the repository already requires for its Rust `unsafe` blocks. All comment/string-level, zero semantic change.
- One scripted-edit error I introduced and fixed: the `waitForSidebarCards` removal left an orphaned function signature in `steps.ts`, caught immediately by `npm run sim:typecheck` (`error TS1136` at `steps.ts:352`) and corrected.

## G. Files touched

`src-tauri/src/collector/disk.rs` (+helper, +tests), `src-tauri/src/collector/mod.rs` (re-export), `src-tauri/src/hardware.rs` (dead-code removal, `Default` derives, doc fixes), `src-tauri/src/state.rs` (`cpu_identity` field, default profile, comment), `src-tauri/src/main.rs` (wiring), `src-tauri/examples/startup_probe.rs`, `src/utils.ts`, `src/utils.test.ts`, `e2e/sim/engine/steps.ts`, `e2e/sim/flake-quarantine.ts`, `e2e/sim/reporting/reports.ts`, `e2e/tests/helpers.ts`, `scripts/check-dead-code.mjs` (new), `scripts/verify.mjs`, `package.json` (no new dependency), this evidence file.

## H. Carried to the backlog

- The packaged-lane work-directory `EPERM` (pre-existing, see the sibling change's evidence).
- `verify:packaged` reaching the disk-model enrichment on real hardware, so the sidebar's model names can be confirmed visually on a host where sysinfo reports `\\.\PhysicalDriveN`. Blocked by the above.