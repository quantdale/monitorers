# Evidence — Restore Snapshot Timestamp Monotonicity

- Change root: `openspec/changes/restore-snapshot-timestamp-monotonicity/`
- Result: `SCHEMA_VERSION` 5 → **6**, moved together with `EXPECTED_SCHEMA_VERSION`; `LIFECYCLE_SCHEMA_VERSION` untouched at 1.

## A. The defect

The IPC timestamp channel was written by two different clocks:

- **Backend** — `collector/run_loop.rs` fixed a wall-clock origin once per session and advanced it with a monotonic `Instant` (`monotonic_timestamp_ms`), pushing into the history ring.
- **Frontend** — `useMetrics.handleSnapshot` stamped every live sample with `Date.now()`.

Anything that moved the wall clock mid-session (NTP step, user change, suspend/resume) therefore made live samples disagree with the ring they were appended to.

## B. One timestamp, computed once (tasks 1.1 – 1.4)

`MetricsSnapshot` gained `timestamp_ms: u64` and `build_snapshot` gained a `timestamp_ms` parameter. The loop computes it **once per tick** and hands the identical value to both consumers:

```rust
let tick_timestamp_ms = monotonic_timestamp_ms(wall_origin_ms, loop_epoch, Instant::now());
let snapshot = {
    let mut s = store.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ref r) = raw {
        commit_disk_network(&mut s, r);
        commit_cpu(&mut s, r);
        commit_gpu(&mut s, r);
        s.push_timestamp(tick_timestamp_ms);
    }
    registry.commit_all(&mut s, &reg_raw);
    build_snapshot(&s, full_poll_tick, tick_timestamp_ms)
};
```

Before, the timestamp was computed *inside* the `if let` block and only the ring saw it. Now it is identical **by construction**, not by recomputation.

**Task 1.3 — what a registry-only tick carries.** A non-full tick still carries a truthful "read at" time for its scalars, but it MUST NOT grow history. `on_tick` remains the sole growth gate, unchanged, and is asserted by a dedicated test (§D).

## C. The frontend consumes it (tasks 2.1 – 2.5)

- 2.1: `EXPECTED_SCHEMA_VERSION` 5 → 6, in the same change as the Rust bump.
- 2.2: `handleSnapshot` resolves the timestamp from the payload; the value is used for both `appendSnapshotToHistory` and the live-event buffer entry. The live-event `timestamp` is now backend-sourced, so `reconcileHistoryWithLiveEvents` compares like with like (2.4).
- 2.3: `resolveSnapshotTimestamp` implements the documented fallback — `console.warn` **once** (matching repo convention), then append at the newest timestamp already known (`historyRef.current?.timestamps.at(-1) ?? lastBackendTimestamp.current`), so the sample is preserved in order rather than dropped. It never falls back to `Date.now()`.
- 2.5: `shouldCommitHistory(onTick)` is untouched and remains the only growth gate.

`src/types/metrics.ts` (the manual Rust mirror) gained `timestamp_ms: number`, documented as required because the backend always sets it; the runtime defensiveness is for payloads that bypass the type.

## D. The mock mirrors the production clock (tasks 3.1 – 3.3)

The mock previously used a fresh `Date.now()` per snapshot and stamped its seed with another `Date.now()`. It now has ONE anchor, mirroring `wall_origin_ms`:

```ts
private readonly historyAnchorMs = Date.now();

currentHistoryTimestamp(): number {
  return this.historyAnchorMs + Math.round(this.simSeconds * 1000);
}
```

Both `composeSnapshot()` and `generateHistory()` stamp from it, so the seed tail and the live stream share a clock. The frozen-snapshot branch keeps frozen *values* but advances the *timestamp* — exactly what the real backend does (a frozen PDH poll still pushes a timestamp on a full tick).

The mock cannot import `EXPECTED_SCHEMA_VERSION` (the module must not import `useMetrics.ts` — import cycle at bundle evaluation), so it carries `MOCK_SCHEMA_VERSION = 6` and **a test pins the two equal**:

```
describe('mock schema parity with production') → the mock emits the same
  schema_version the frontend expects
```

Scenario `schema_version` override behaviour is intact (`?? MOCK_SCHEMA_VERSION`).

## E. Tests

### Rust (task 4.1, 4.2) — `cargo test` 208 passed (was 204)

| Test | Asserts |
|---|---|
| `test_build_snapshot_carries_the_exact_timestamp_it_was_given` | field plumbing |
| `test_snapshot_timestamp_equals_ring_timestamp_for_the_same_tick` | snapshot `timestamp_ms` **equals** `*s.timestamps.back()` after pushing the same `ts` — not merely that the field exists |
| `test_snapshot_timestamp_is_never_behind_the_newest_ring_timestamp` | monotonic across 5 consecutive full ticks AND equal to the ring each time (extends the existing monotonic-projection coverage rather than replacing it) |
| `test_off_tick_snapshot_carries_a_timestamp_but_grows_no_history` | an off-tick snapshot has `timestamp_ms > ring tail` while `cpu/mem/net/timestamps` lengths are byte-identical before and after |

Every pre-existing `build_snapshot` test literal was updated to pass an explicit timestamp; the `main.rs` profile-reconciliation fixture uses the real `SCHEMA_VERSION` (imported inside the test module) rather than a hard-coded `5`, so it cannot drift again.

### TypeScript (tasks 4.3 – 4.6)

**`src/sim/mockBackend.test.ts`** (+5): monotonic advance per snapshot; off-tick snapshots advance the clock while only `on_tick` gates growth; seeded history and live snapshots share one clock (`stamps[0] - seedTail <= 1000`); a frozen snapshot keeps values but advances the clock; mock↔production schema parity.

**`src/hooks/useMetrics.test.ts`** (+9): uses the payload timestamp rather than the local clock; missing timestamp takes the documented fallback and warns; warns **once** across repeated degraded payloads; rejects `NaN`/`Infinity`/negative; accepts `0` (falsy but valid); an off-tick snapshot carrying a valid timestamp returns the *same payload object* (growth gate intact); `reconcileHistoryWithLiveEvents` still suppresses an event at the response tail **and** does not drop a genuinely new one; the bumped version fails closed with the actionable `SchemaMismatchError`, and the current version passes.

## F. Verification (task 5)

```
cargo fmt -- --check                                        → FMT=0
cargo clippy --all-targets --all-features -- -D warnings    → CLIPPY=0
cargo test                                                  → 208 passed
cargo test --no-default-features                            → 189 passed
npx tsc --noEmit                                            → 0
npm run typecheck:test                                      → 0
npm run sim:typecheck                                       → 0
npm test -- --run                                           → 20 files / 261 tests passed
npm run e2e                                                 → 14 passed (54.8s)
npm run sim                                                 → 4 passed (3.8m), ALL 16 journeys PASS
```

**The mock simulation matrix is fully green** — every one of the 16 journeys PASS, which is the first completely green matrix run in this session and confirms the intermittent teardown failures recorded in `restore-green-frontend-gate/evidence.md` §D4 were host memory pressure (`vmmemWSL` 6.9 GB, ~51 node processes 6.8 GB from concurrently-running projects, only 22 MB free at the worst point), not a product defect.

Chart-timestamp readers all held: `chart-fidelity`, `long-watch-cadence`, and the `data-chart-latest-ts` assertions in `renderCardContent.test.tsx`, plus the journey assertions in `customization-roundtrip`, `layout-persistence`, `first-launch-onboarding`, `fault-freeze-recovery`, and `degraded-startup`.

### 5.5 — packaged lane

Not run: `npm run verify:packaged` fails on this host for the **pre-existing, unrelated** work-directory `EPERM` recorded in `harden-real-lane-host-state-cleanup/evidence.md` §G, which reproduces identically with this change stashed. This host is also not elevated, so the packaged lane would not exercise the real WMI/PDH snapshot path in any case.

### 5.7 — the two constants moved together

```
pub const SCHEMA_VERSION: u32 = 6;                 (collector/snapshot.rs)
export const EXPECTED_SCHEMA_VERSION = 6;          (hooks/useMetrics.ts)
const MOCK_SCHEMA_VERSION = 6;                     (sim/mockBackend.ts, pinned by test)
pub const LIFECYCLE_SCHEMA_VERSION: u32 = 1;       (collector/supervisor.rs — UNTOUCHED)
export const EXPECTED_LIFECYCLE_SCHEMA_VERSION = 1;(hooks/useMetrics.ts — UNTOUCHED)
```

## G. Documentation (task 6)

- 6.1: the single-clock contract, what a mid-session wall-clock adjustment means, and the missing-timestamp fallback rule are now stated in **all three** instruction files — `AGENTS.md` (IPC contract section), `CLAUDE.md` (IPC contract section), and `.cursorrules` (Architecture Invariants).
- 6.2: every current-schema-value statement was reconciled to 6. The remaining "5" mentions are historical records of completed campaigns (`openspec/changes/dependency-runtime-modernization-and-qualification/*`, `.agent/EXECUTION_PROMPT.md`) and this change's own evidence files describing the pre-bump state — none of them advertises a *current* value.

## H. Files touched

`src-tauri/src/collector/snapshot.rs` (+field, +param, +4 tests), `src-tauri/src/collector/run_loop.rs` (single computation), `src-tauri/src/main.rs` (test fixture), `src/types/metrics.ts`, `src/hooks/useMetrics.ts` (+`resolveSnapshotTimestamp`, ref wiring), `src/hooks/useMetrics.test.ts` (+9), `src/hooks/useMetrics.hook.test.ts` (simulated backend clock), `src/sim/mockBackend.ts` (single anchor clock, schema 6), `src/sim/mockBackend.test.ts` (+6), `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, this evidence file.