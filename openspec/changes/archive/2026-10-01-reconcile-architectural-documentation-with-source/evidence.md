# Evidence — Reconcile Architectural Documentation With Source

- Change root: `openspec/changes/reconcile-architectural-documentation-with-source/`
- Baseline commit: `efa2cd6` (plus the `restore-green-frontend-gate` work applied earlier in the same working tree)
- No product source, schema constant, or IPC behaviour was changed by this change.

## §1 — Authoritative declared ranges (tasks 1.1 – 1.5)

Read from `sys-monitor-tauri/src-tauri/Cargo.toml` and `sys-monitor-tauri/package.json`:

| Package | Declared | Documented in `.cursorrules` §1 **before** | After |
|---|---|---|---|
| `sysinfo` | `"0.39"` | `` `sysinfo 0.33` `` ✗ | `` `sysinfo 0.39` `` ✓ |
| `windows` | `{ version = "0.62", … }` | `` `windows 0.61` `` ✗ | `` `windows 0.62` `` ✓ |
| `wmi` | `"0.18"` | `` `wmi 0.13` `` ✗ | `` `wmi 0.18` `` ✓ |
| `nvml-wrapper` | `{ version = "0.12", optional = true }` | `` `nvml-wrapper 0.10` `` ✗ | `` `nvml-wrapper 0.12` `` ✓ |
| `nvapi-sys` | `{ version = "0.1.3", optional = true }` | `` `nvapi-sys 0.1.3` `` ✓ | unchanged ✓ |
| `react` | `^19.2.8` | `React 18`, `"react": "^18.2.0"` ✗ | `React 19`, `"react": "^19.2.8"` ✓ |
| `react-dom` | `^19.2.8` | (absent from the Frontend row) | `"react-dom": "^19.2.8"` added |
| `typescript` | `^7.0.2` | `TypeScript 5` ✗ | `TypeScript 7`, `"typescript": "^7.0.2"` ✓ |
| `vite` | `^8.2.2` | `Vite 6`, `"vite": "^6.4.3"` ✗ | `Vite 8`, `"vite": "^8.2.2"` ✓ |
| `@vitejs/plugin-react` | `^6.1.0` | (absent) | added |
| `recharts` | `^3.10.1` | `"recharts": "^3.8.0"` ✗ | `"recharts": "^3.10.1"` ✓ |
| `lucide-react` | `^1.34.0` | `"lucide-react": "^0.460.0"` ✗ | `"lucide-react": "^1.34.0"` ✓ |
| `@tauri-apps/api` | `^2.11.1` | (absent) | added to a new Tauri JS row |
| `@tauri-apps/plugin-store` | `^2.4.4` | (absent) | added to the new Tauri JS row |
| `@tauri-apps/cli` | `^2.11.4` | (absent) | added to the new Tauri JS row |
| `@dnd-kit/*` | `^6.3.1` / `^10.0.0` / `^3.2.2` | `^6.3.1` / `^10.0.0` ✓ (utilities absent) | `"@dnd-kit/utilities": "^3.2.2"` added |
| `serde` / `serde_json` | `"1"` | `"1"` ✓ | unchanged |

Every value was transcribed from the manifests, not from the proposal. The Frontend/Charts/Icons/Drag-and-drop/Tauri JS rows were re-read after editing: no superseded major or minor remains (verified again mechanically by `scripts/check-version.mjs`, §5 below). A sentence was added naming `Cargo.toml` / `package.json` as the source of truth for the table.

## §2 — Mechanism claim (tasks 2.1 – 2.3)

### Before (`.cursorrules`, Architecture Invariants)

```
- All push_history writes must happen on full ticks (1Hz) only.
  Providers may poll at 250ms for live snapshot freshness but must
  never commit to history more than once per second.
  Violation: chart scroll rate mismatch at long time windows (CPU bug, fixed).
  Implementation: registry.commit_all is gated inside
  `if let Some(ref r) = raw` so it only runs on full ticks.
  Any new sensor provider added in future must follow the same rule.
```

### Source of truth — `src-tauri/src/collector/run_loop.rs` (lines 264–274, verbatim)

```rust
let snapshot = {
    let mut s = store.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ref r) = raw {
        commit_disk_network(&mut s, r);
        commit_cpu(&mut s, r);
        commit_gpu(&mut s, r);
        let ts = monotonic_timestamp_ms(wall_origin_ms, loop_epoch, Instant::now());
        s.push_timestamp(ts);
    }
    registry.commit_all(&mut s, &reg_raw);
    build_snapshot(&s, full_poll_tick)
};
```

`registry.commit_all(&mut s, &reg_raw);` is a **sibling** of the `if let Some(ref r) = raw` block, at the same indentation level. The documented claim was wrong.

The real gate is two-sided, and both sides were verified:

- `let raw = if full_poll_tick { Some(poll(&mut *state, wmi_con)) } else { None };` (line 241) — `raw` is `None` on registry-only ticks, so the four history commits are skipped.
- `let reg_raw = if !full_poll_tick { registry.poll_all(&mut *state, wmi_con) } else { (0..registry.len()).map(|_| None).collect() };` (line 252) — on full-poll ticks `reg_raw` is a vector of all-`None`.
- `SensorRegistry::commit_all` (`src-tauri/src/sensor.rs:209`) is `for (entry, raw_opt) in … { if let Some(raw) = raw_opt { entry.provider.commit(store, raw); } }` — an all-`None` vector is a no-op.

### After

```
- All push_history writes must happen on full ticks (1Hz) only.
  Providers may poll at 250ms for live snapshot freshness but must
  never commit to history more than once per second.
  Violation: chart scroll rate mismatch at long time windows (CPU bug, fixed).
  Implementation: the history commits (`commit_disk_network`, `commit_cpu`,
  `commit_gpu`, `push_timestamp`) live inside the full-poll branch
  `if let Some(ref r) = raw`. The registry commit is a *sibling* of that
  branch, not nested inside it: on a registry-only tick `raw` is `None` so the
  history commits are skipped, and on a full-poll tick `reg_raw` is a vector of
  all-`None` so `registry.commit_all` is a no-op. Either way exactly one path
  writes history per tick. Do not "simplify" this by moving the call inside
  the branch — that would silently disable the 250 ms live scalar path.
  Any new sensor provider added in future must follow the same rule.
```

The warning about the *failure mode* an agent would actually cause is now stated explicitly, which the previous wording invited.

## §3 — Intra-file contradiction and hardcoded counts (tasks 3.1 – 3.3)

### `AGENTS.md`

Before: `- Schema version is **4** (src-tauri/src/collector/snapshot.rs ↔ src/hooks/useMetrics.ts); bump both together for payload changes.` — while the same file's IPC-contract section said **5**.

After: the bullet no longer names a value; it defers to the single IPC-contract statement and keeps the "move both together" rule.

### Full sweep of every tracked instruction file (task 3.2)

```
$ grep -rn "SCHEMA_VERSION\|schema version\|schema_version" --include=*.md . | grep -v node_modules
```

Four more instruction files advertised `2` as the current schema version — stale by three increments and, in one case, by file location as well:

| File | Tracked? | Stale text | Action |
|---|---|---|---|
| `.cursor/skills/ipc-contract/SKILL.md` | no — `.gitignore:27` excludes `.cursor/` | "Schema Version 2"; `const SCHEMA_VERSION: u32 = 2;  (main.rs)` | Title now defers to source; `SCHEMA_VERSION` located in `src-tauri/src/collector/snapshot.rs`; the literal `2` removed |
| `.cursor/skills/rust-backend-invariants/SKILL.md` | no — gitignored | `SCHEMA_VERSION: 2 (Rust) = EXPECTED_SCHEMA_VERSION: 2 (TS)`; `cargo test (currently 45 tests must pass)`; `Tests: 45 Rust, 41 frontend` | Replaced with "read both from source"; test counts now come from the runners |
| `.cursor/agents/frontend-agent.md` | no — gitignored | `**41 frontend tests** must pass`; `Fixtures in tests must include schema_version: 2` | Count replaced by the runner's report; fixture instruction now says import `EXPECTED_SCHEMA_VERSION` |
| `.cursor/skills/frontend-patterns/SKILL.md` | no — gitignored | `Current counts: 41 tests (19 utils + 18 useMetrics + 4 useSettings)`; `schema_version: 2` | Counts replaced by "reported by the runner"; fixture now matches the imported constant |

`.cursor/` is gitignored, so those four edits cannot be committed and do not by themselves satisfy the "tracked documentation" requirement; they were corrected anyway because the same agent-facing claims are read from that directory locally. **The tracked sweep is what satisfies the requirement**: after the edits, `grep -rn "SCHEMA_VERSION\|schema version\|schema_version" --include=*.md` over tracked instruction files finds exactly two current-value statements — `AGENTS.md`'s IPC-contract section and `CLAUDE.md`'s — and both agree with `SCHEMA_VERSION`/`EXPECTED_SCHEMA_VERSION` in source.

`AUDIT_REPORT.md` also mentions older counts, but it is explicitly a historical record whose own header says "Treat findings below as historical record; verify against current source before acting on any individual item"; it is not an instruction file and was deliberately left untouched.

### E2E count (task 3.3)

- `.cursorrules`: "E2E (Playwright, mock-data harness on Vite): 12 tests expected (`npm run e2e` …)" → "the count is reported by the runner — run `npm run e2e` from `sys-monitor-tauri/` and read the result; it is intentionally not duplicated here."
- `CLAUDE.md`: "npm run e2e # Playwright e2e — mock-data harness on the Vite dev server (12 tests)" → "(count comes from the runner)".

This matches the policy the repo already applies to Rust and frontend unit-test counts in the same files.

## §4 — Source-layout listing (tasks 4.1 – 4.3)

`ls sys-monitor-tauri/src-tauri/{src,src/collector,examples,tests}` showed the listing was missing `collector/supervisor.rs`, `error_log.rs`, `tests/cadence_hardware.rs`, and had `examples/*.rs` indented under `src/` (they are crate-level example targets, siblings of `src/`). All three files are now listed under their real parents, and `src/sim/` + `e2e/sim/` are named for the simulation bridge and platform.

Every path named in the refreshed listing was then checked for existence (task 4.3) — 53 paths, `MISSING:` output empty:

```
$ for p in <every path in the listing>; do [ -e "$p" ] || echo "MISSING: $p"; done
PATH_CHECK_DONE
```

## §5 — Documentation-fidelity check (tasks 5.1 – 5.4, 6.1 – 6.2)

Extended `scripts/check-version.mjs` (same file, same pattern, no new dependency, plain Node — runs identically on the `ubuntu-latest` frontend job and the `windows-latest` Rust job). It now also compares the `.cursorrules` §1 table against `Cargo.toml` and `package.json`:

- leading `major.minor` comparison, so documented `React 19` and declared `^19.2.8` agree;
- both documented forms are accepted (``sysinfo 0.39`` and `"react": "^19.2.8"`);
- three-component versions (`nvapi-sys 0.1.3`) are compared as `0.1` vs `0.1`;
- a package declared in a manifest but **absent** from §1 is also a failure (so deleting a row cannot silently drop coverage);
- every failure names the document, the field, and the declared-versus-documented values.

Wired into `verify.mjs`: it is the **first** step of `frontend()` (renamed `release version + documentation consistency`), i.e. before both audits, typecheck, tests and build, and therefore before them in `verify:fast`, in `verify:full`, and in the CI `frontend` job.

### 6.1 — passes against the corrected docs

```
$ node scripts/check-version.mjs ; echo $?
release version 0.1.4 is consistent across frontend, Cargo, and Tauri config
documentation fidelity: 10 .cursorrules §1 version claims match Cargo.toml / package.json
0
```

### 6.2 — fails on deliberate drift, with an actionable message

| Injected drift | Result |
|---|---|
| `"react": "^19.2.8"` → `"^20.2.8"` (one character) | **exit 1** — `.cursorrules §1: react documented as ^20.2.8, package.json declares ^19.2.8` + `Fix the .cursorrules table (it must mirror Cargo.toml / package.json), not this script.` |
| `` `sysinfo 0.39` `` → `` `sysinfo 0.33` `` (the original stale value) | **exit 1** — `.cursorrules §1 Backend row: sysinfo documented as 0.33, Cargo.toml declares 0.39` |
| Charts row range deleted (`| see package.json |`) | **exit 1** — `.cursorrules §1: recharts is declared as ^3.10.1 in package.json but is not documented in the core-stack table` |

`.cursorrules` was restored from a snapshot after each injection; the final run is the clean one shown above.

## §6 — Files touched

`.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `.cursor/skills/ipc-contract/SKILL.md`, `.cursor/skills/rust-backend-invariants/SKILL.md`, `.cursor/agents/frontend-agent.md`, `.cursor/skills/frontend-patterns/SKILL.md`, `sys-monitor-tauri/scripts/check-version.mjs`, `sys-monitor-tauri/scripts/verify.mjs`, plus this evidence file.

## §7 — Observation carried to the backlog (not in scope here)

`.cursor/skills/frontend-patterns/SKILL.md` still ends with a "KNOWN GAPS TO FIX ON NEXT TOUCH" list (`useSettings: wrap load/save in try/catch`, `MetricCard: wrap chartData in useMemo`). Both appear to have been resolved since (`useSettings.errors.test.ts` exists; `MetricChart.tsx` memoizes). Correcting that list was not part of this change's tasks and was not verified here, so it was left alone rather than guessed at.

## §8 — Frontend lane result (task 6.3)

The first `npm run verify:frontend` run of this change hit the pre-existing `renderCardContent.test.tsx` jsdom/Recharts load flake documented in `restore-green-frontend-gate/evidence.md` §D1 (`Test timed out in 20000ms` at line 128, 244 passed / 1 failed); the file passes in isolation and the immediate re-runs were green. No assertion was changed. The confirming end-to-end run:

```
$ npm run verify:frontend ; echo $?
=== release version + documentation consistency ===
release version 0.1.4 is consistent across frontend, Cargo, and Tauri config
documentation fidelity: 10 .cursorrules §1 version claims match Cargo.toml / package.json
=== repository-root npm audit (root workspace) ===
found 0 vulnerabilities
=== application npm audit (sys-monitor-tauri) ===
found 0 vulnerabilities
=== frontend typecheck ===
=== frontend unit tests ===
 Test Files  20 passed (20)
      Tests  248 passed (248)
=== frontend build ===
0
```