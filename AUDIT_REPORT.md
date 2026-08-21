# sys-monitor-tauri — Engineering Audit Report

**Pinned commit:** `b8dca65c431e9262421c868a4de44d17c757519b` (branch `main`, working tree clean at audit start)
**Repo root:** `D:\Documents\tryPython\monitorers` — app code in `sys-monitor-tauri\`
**Audit date:** 2026-07-25
**Total findings:** 54 (0 Critical · 9 High · 26 Medium · 19 Low)

> **Remediation status (2026-08-21):** This audit predates several remediation waves. All findings were addressed through OpenSpec changes archived under `openspec/changes/archive/` (notably `2026-08-03-*` and `2026-08-13-comprehensive-reliability-hardening`, which covered the large-initiative items COR-002/ARC-001 per-device GPU keying and ERR-002 crash diagnostics). A further hardening pass on 2026-08-21 fixed residual issues (nondeterministic disk ordering, duplicated NVAPI/vendor mapping, non-numeric WMI parse fallback, drag-reorder negative-index corruption, per-tick render churn) and added persistent collector-error logging. Treat findings below as historical record; verify against current source before acting on any individual item. Current verified gate status lives in `progress.md`.

> This document supersedes the condensed-table version — every finding below carries the full record (status, location, evidence, problem, severity reasoning, impact, likelihood, root cause, recommendation). A rendered version with severity chips and navigation also exists as a published artifact from this session; this file is the complete, git-trackable source of record.

---

## Table of contents

1. [Executive Summary](#1-executive-summary)
2. [System Map](#2-system-map)
3. [Methodology & Scope](#3-methodology--scope)
4. [Findings](#4-findings)
   - [4.1 Security & Supply Chain](#41-security--supply-chain)
   - [4.2 Correctness](#42-correctness)
   - [4.3 Architecture & Design / Data Layer](#43-architecture--design--data-layer)
   - [4.4 Error Handling & Observability](#44-error-handling--observability)
   - [4.5 Code Quality, Tech Debt & Modernization](#45-code-quality-tech-debt--modernization)
   - [4.6 Performance & Resources](#46-performance--resources)
   - [4.7 Testing & Validation](#47-testing--validation)
   - [4.8 UI/UX & Accessibility](#48-uiux--accessibility)
   - [4.9 Documentation, Build & CI/CD](#49-documentation-build--cicd)
5. [Prioritized Backlog](#5-prioritized-backlog)
6. [Implementation Roadmap & Dependency Graph](#6-implementation-roadmap--dependency-graph)
7. [Open Questions & Hypotheses](#7-open-questions--hypotheses)
8. [Appendix — Commands Run](#8-appendix--commands-run)

---

## 1. Executive Summary

This is a small (~3,500-line), well-architected Windows-only Tauri v2 system monitor. The project has real engineering discipline: most Rust `unsafe` blocks are commented, CI runs three real jobs, the concurrency model (lock-free I/O → microsecond-scoped mutex → emit) is sound and consistently followed, and the test suite (70 Rust + 41 frontend, all passing) is genuinely useful, not just padding.

Two issues dominate the risk picture:

1. **CI is red today.** `cargo audit` finds 3 real RUSTSEC vulnerabilities with no allowlist anywhere in the repo, and none of the three places a contributor is told to check locally (pre-push hook, `.cursorrules`, `.cursor/commands/check.md`) run `cargo audit` or `npm audit` — so "all checks passed" locally is currently a false signal. The good news, verified this session: **all three vulnerabilities have a confirmed, semver-compatible fix available via plain `cargo update`** — no Cargo.toml edit, no waiting on upstream Tauri. This is a same-day fix. (**SEC-001**)
2. **The app's core feature — accurate historical charts — is silently wrong, and gets worse the longer the app runs.** The backend already solved a "history committed at 4Hz instead of 1Hz" bug once (git log: `1c30a6c "fix: CPU history commit rate 4Hz → 1Hz"`), but the fix only closed the gap in the Rust-side ring buffer. The `metrics-update` Tauri event is still emitted unconditionally every 250ms, and the frontend appends every single event into its charting history with no gating — so after roughly 15 minutes of continuous runtime, a user's "1 hour" window selection is actually showing ~15 minutes of real time, and CPU/GPU chart lines are plotted 4x denser than mem/net/disk lines. This is the same bug class recurring in a different layer. (**COR-001**)

Beyond those two, the audit surfaced a real (if narrow) accuracy bug on multi-Nvidia-GPU hardware (**COR-002**), a structural GPU-identity bug where two physically-distinct, identically-modeled GPUs get silently merged and their utilization summed (**ARC-001**), several silent-failure paths that make production issues undiagnosable (**ERR-001, ERR-002, ERR-003, ERR-004, ERR-005, ERR-006**), and a systemic keyboard-accessibility gap (**UX-001, UX-002, UX-003**).

None of this requires a rewrite. Every finding below has a targeted, proportionate fix. The highest-leverage sequence is: fix the audit (today), fix the emission-rate bug (this week — it's the app's core value proposition), then work down the Medium/Low backlog in the prioritized order in §5.

---

## 2. System Map

**Stack:** Rust 2021 / Tauri v2.10.3 backend (Win32 PDH + WMI + NVAPI/NVML), React 18 + TypeScript 5 + Vite 6 frontend (Recharts 3, @dnd-kit), `@tauri-apps/plugin-store` for settings persistence. Windows-only by design (every collector uses Win32-exclusive APIs).

**Entry points / control flow:**
- **Backend (`src-tauri/src/main.rs`)**: Tauri `setup()` spawns one background thread. That thread initializes WMI (MTA, exponential backoff), detects the hardware profile once, then runs an infinite `loop { sleep(250ms) }`. A `tick` counter drives a 4-tick cadence — every 4th tick is a "full poll" (`collector::poll()`, one `PdhCollectQueryData` covering CPU/mem/net/disk/GPU); the other 3 ticks poll only the `SensorRegistry` (CPU + GPU providers, also 250ms) for live-value freshness. History ring buffers (`VecDeque`, cap 3600) are meant to be written only on full ticks. The whole tick body runs inside `catch_unwind`; on panic it emits `collector-error` and breaks permanently (no restart).
- **IPC surface**: two commands (`get_history(window_secs)`, `get_hardware_profile()`) and three events (`metrics-update`, `hardware-profile-ready`, `collector-error`).
- **Frontend (`src/`)**: `useMetrics.ts` is the single source of truth — `invoke('get_history', ...)` once per mount/window-change, then `listen('metrics-update')` appends incrementally forever. `useSettings.ts` persists card order/visibility/view-mode/window via `@tauri-apps/plugin-store`. `App.tsx` renders the card grid with dnd-kit drag-reorder; `HardwareSidebar.tsx` renders a separate, independently-mounted `useSettings()` instance for its own card order (verified safe by reading the vendored `tauri-plugin-store` Rust source — see §7).
- **Data layer**: no database. Two persistence surfaces: (a) in-process `HistoryStore` ring buffers behind one `Mutex`, rebuilt from nothing on every process start; (b) `settings.json` via the Tauri store plugin, schema-less (no version field, unlike the IPC payloads which carry `schema_version`).
- **Build/CI**: `.github/workflows/rust.yml`, three parallel jobs — `rust-test` (windows-latest, `cargo test`), `rust-lint` (windows-latest, `fmt`/`clippy`/`audit`), `frontend` (ubuntu-latest, `npm audit`/`tsc`/`vitest`). No release/bundling workflow exists; `npm run tauri build` is a local-only, never-CI-verified path.

---

## 3. Methodology & Scope

**Approach:** Direct reading of every source file in `src-tauri/src/**/*.rs` and `src/**/*.{ts,tsx}`, every config file (`Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, `vite.config.ts`, `tsconfig.json`, `package.json`, CI workflow), and every project doc (`CLAUDE.md`, `.cursorrules`, `.cursor/commands/*.md`, `README.md`) — plus real command execution for every check CI runs, plus a 9-lens parallel-agent review, plus my own independent second pass over the two lenses that failed and over the highest-severity findings.

**Real commands executed this session (all output captured, none simulated):**

| Command | Result |
|---|---|
| `cd src-tauri && cargo test --verbose` | **70 passed; 0 failed** |
| `cd src-tauri && cargo fmt -- --check` | **clean, exit 0** |
| `cd src-tauri && cargo clippy --verbose -- -D warnings` | **clean, 0 warnings, exit 0** |
| `cd src-tauri && cargo audit` | **exit 1** — 3 hard vulnerabilities + 21 allowed warnings (SEC-001) |
| `npx tsc --noEmit` | **clean, exit 0** |
| `npm test -- --run` (Vitest) | **41 passed; 0 failed** |
| `npm audit --audit-level=high` | **0 vulnerabilities found** |
| `npm outdated` | 13 packages behind latest (CQ-014) |
| `cargo update -p crossbeam-epoch --dry-run` | confirms 0.9.18→0.9.20 available (fixes RUSTSEC-2026-0204) |
| `cargo update -p plist --dry-run` | confirms 1.8.0→1.10.0 available, **pulls quick-xml 0.38.4→0.41.0** (fixes RUSTSEC-2026-0194 + -0195) |
| `cargo tree -d` | duplicate crate versions present (bitflags 1.3.2/2.11.0, windows 0.57/0.58/0.61.3) — normal for a large tree, not independently actionable |

**Adversarial verification caveat:** A 9-lens parallel-agent workflow was run (Correctness/Concurrency, Security/Supply-chain, Performance, Error-handling/Observability, Architecture/Design, Code-quality/Modernization, Testing, UI-UX/Accessibility, Build-CI/Docs) followed by a per-finding adversarial-verification stage. **The verification stage, and 2 of the 9 review lenses (Security/Supply-chain, Performance), failed on an account-level session rate limit** before completing (44 of 51 agent calls failed with "session limit · resets 12:30pm Asia/Manila"). The 7 lenses that did complete produced 42 candidate findings, which I recovered from the workflow's journal file after my own orchestration script's return value discarded them (a script bug — it returned only the empty verification buckets). I have personally re-verified every finding recorded below against the actual source (not merely trusted the sub-agent output) by re-opening the cited files myself, and I did my own manual pass for the 2 failed lenses (Security/Supply-chain, Performance) using files already read this session. Every finding below is therefore **CONFIRMED by my own direct reading**, not merely agent-asserted; none are unverified HYPOTHESIS carry-overs from the failed automated verification stage.

**Not covered / explicitly out of scope this pass:** runtime/dynamic testing on real multi-GPU or WMI-degraded hardware (several findings below are confirmed as *code-level* bugs but their real-world frequency is a HYPOTHESIS pending field data — flagged individually in §7); a full line-by-line review of all 481 resolved Cargo dependencies beyond the audit/tree commands above; visual/manual UI testing in a running app (this was a static-analysis pass against source, not an interactive session).

---

## 4. Findings

Findings are grouped by lens. Every ID is stable and referenced from the backlog (§5) and roadmap (§6).

### 4.1 Security & Supply Chain

#### SEC-001 — `cargo audit` fails CI today; all 3 vulnerabilities have a confirmed same-day fix
- **Status:** CONFIRMED
- **Lens:** B (Security), I (Supply chain), J (CI)
- **Location:** `sys-monitor-tauri/src-tauri/Cargo.lock`; CI job `rust-lint` in `.github/workflows/rust.yml:81`
- **Evidence:** `cargo audit` → `error: 3 vulnerabilities found!` (real exit code 1, confirmed via explicit `$?` capture after an initial pipe-swallowed-exit-code mistake was corrected). The three:
  1. `RUSTSEC-2026-0204` — `crossbeam-epoch 0.9.18` (invalid pointer deref in `fmt::Pointer` for `Atomic`/`Shared`), via `sysinfo 0.33.1 → rayon → rayon-core → crossbeam-deque → crossbeam-epoch`. Fix: `>=0.9.20`.
  2. `RUSTSEC-2026-0194` — `quick-xml 0.38.4`, severity **7.5 (high)**, quadratic-time duplicate-attribute check, via `plist 1.8.0 → tauri-plugin/tauri-codegen/tauri 2.10.3`. Fix: `>=0.41.0`.
  3. `RUSTSEC-2026-0195` — `quick-xml 0.38.4`, severity **7.5 (high)**, unbounded namespace-allocation DoS, same dependency path. Fix: `>=0.41.0`.
  Plus 21 "allowed" warnings (unmaintained GTK3 bindings pulled in transitively for Tauri's Linux target even though this app ships Windows-only; `anyhow`/`glib`/`rand` unsoundness advisories). No `.cargo/audit.toml` or `audit.toml` exists anywhere in the repo (confirmed via `find`) to allowlist any of this.
- **Problem:** None of this project's own `Cargo.toml` dependencies are the direct culprits — `crossbeam-epoch` and `quick-xml`/`plist` are transitive, pulled in by `sysinfo` and `tauri` respectively. I verified with dry-runs that don't touch the lockfile:
  - `cargo update -p crossbeam-epoch --dry-run` → **"Updating crossbeam-epoch v0.9.18 -> v0.9.20"** — fixes RUSTSEC-2026-0204 outright.
  - `cargo update -p quick-xml --dry-run` alone → 0 packages updated (quick-xml is pinned by `plist`'s own `Cargo.toml` constraint, can't float independently).
  - `cargo update -p plist --dry-run` → **"Updating plist v1.8.0 -> v1.10.0" + "Updating quick-xml v0.38.4 -> v0.41.0"** — fixes both quick-xml advisories.
  So a plain `cargo update -p crossbeam-epoch -p plist` (or a full `cargo update`) resolves all 3 hard vulnerabilities, purely as a `Cargo.lock` regeneration — no `Cargo.toml` edit, no waiting on a new Tauri release.
- **Severity:** High — blocks every PR's `rust-lint` job today; two of the three advisories are independently rated 7.5/high by RustSec.
- **Impact:** Any push/PR against `main` fails CI on the audit step right now. A contributor following every documented local check (DOC-002) sees "all checks passed" and is blindsided by CI.
- **Likelihood:** Certain — reproduced twice this session.
- **Root cause:** Transitive dependency drift; nobody has run `cargo update` recently, and there's no scheduled/automated dependency-update job (e.g. Dependabot/Renovate) in `.github/`.
- **Recommendation:** Run `cargo update -p crossbeam-epoch -p plist`, then re-run the full local gate (`cargo test`, `fmt --check`, `clippy -- -D warnings`, `cargo audit`) to confirm green, then commit the updated `Cargo.lock`. Separately, add a scheduled Dependabot/Renovate config for `Cargo.lock`/`package-lock.json` so this doesn't silently drift again.
- **Trade-offs & alternatives:** Could instead add an `audit.toml` to temporarily allowlist the advisories, but that only defers the problem — the real fix is one command away, so there's no reason to allowlist instead of fixing.
- **Complexity & risk:** Quick win. Regression risk is low — both are patch/minor bumps within the same major version already in the lockfile, but full `cargo test` must be re-run to confirm (not assumed) since `rayon`/`tauri`-adjacent behavior changes are in scope.
- **Regression safety:** Re-run `cargo test --verbose` (expect 70/70), `cargo clippy -- -D warnings`, `cargo audit` (expect exit 0) after the update.

#### CQ-001 — Two duplicated unsafe PDH blocks with no `// SAFETY:` comment
- **Status:** CONFIRMED (verified directly by re-reading `collector/mod.rs`)
- **Lens:** B (Security — unsafe code hygiene), G (Code quality — duplication)
- **Location:** `src-tauri/src/collector/mod.rs:120` (`collect_pdh()`) and `:171` (inline duplicate inside `poll()`)
- **Evidence:**
  ```rust
  // collect_pdh() — line 118-123
  pub fn collect_pdh(collector: &crate::state::CollectorState) -> bool {
      match collector.pdh.query {
          Some(query) => unsafe { PdhCollectQueryData(query) == 0 },  // no SAFETY comment
          None => false,
      }
  }

  // inside poll() — line 168-173
  // Single PdhCollectQueryData call covers both GPU and disk counters.
  let pdh_collected_ok = match collector.pdh.query {
      Some(query) => unsafe { PdhCollectQueryData(query) == 0 },  // byte-for-byte identical, also no SAFETY comment
      None => false,
  };
  ```
  Contrast with `new_pdh_gpu_query()` a few lines earlier in the same file, which correctly has `// SAFETY: PDH C API calls via FFI. All pointer arguments are stack variables. Return codes are checked before any output values are read.` immediately before its `unsafe` block.
- **Problem:** Both call sites perform the exact identical unsafe FFI call, and neither carries the `// SAFETY:` comment the project's own coding-standards table explicitly mandates ("every `unsafe` block needs a `// SAFETY:` comment explaining pointer validity and lifetime"). Additionally, `poll()` should simply call the already-existing `collect_pdh()` function instead of reimplementing it inline — the duplication means any future change to the safety reasoning or error handling has to be made twice.
- **Severity:** Medium. The FFI call itself is sound in practice (the query handle is always a validly-opened `PDH_HQUERY` per the project's own "PDH handles opened once, never recreated" invariant) — this is a process/documentation-compliance gap, not a live memory-safety bug. But it's exactly the kind of gap that matters most in the highest-risk part of the codebase (raw FFI), and the missing comment plus duplication compound each other.
- **Impact:** A future contributor copy-pasting this exact pattern (no-comment `unsafe { FFI_call() }`) elsewhere would be following precedent already present in the codebase — normalizing the gap rather than it being an isolated slip.
- **Likelihood:** Already present in 2 locations; will recur if not addressed, since it's now the path of least resistance to copy.
- **Root cause:** The `poll()` function was likely written before `collect_pdh()` was extracted as a named helper (or the extraction happened without updating `poll()` to call it), and the SAFETY-comment convention wasn't retroactively applied to either.
- **Recommendation:** Have `poll()` call `collect_pdh(collector)` instead of reimplementing the match; add the missing `// SAFETY:` comment to `collect_pdh()` itself (one copy, one comment, instead of two uncommented copies).
- **Complexity & risk:** Quick win — a small refactor with no behavior change; the call sites are pattern-identical, so the risk of the substitution introducing a regression is minimal.

#### CQ-002 — `Drop` impl's unsafe `PdhCloseQuery` call has no SAFETY comment
- **Status:** CONFIRMED
- **Lens:** B (Security — unsafe code hygiene)
- **Location:** `src-tauri/src/pdh.rs:20-27`
- **Evidence:**
  ```rust
  impl Drop for PdhHandles {
      fn drop(&mut self) {
          if let Some(query) = self.query.take() {
              unsafe {
                  PdhCloseQuery(query);   // no // SAFETY: comment anywhere above this block
              }
          }
      }
  }
  ```
- **Problem:** Same convention gap as CQ-001, in a different file — the cleanup path for a process-lifetime FFI handle has no documented safety justification (e.g. "query is Some only if successfully opened by PdhOpenQueryW and never closed elsewhere").
- **Severity:** Low — the code is correct (the `Option::take()` pattern already prevents double-close), just undocumented per the project's own convention.
- **Impact:** Low on its own; contributes to the pattern of unsafe FFI code in this codebase drifting away from its documented safety-review standard.
- **Likelihood:** N/A — this is a static documentation gap, not a triggerable condition.
- **Root cause:** Same as CQ-001/CQ-003 — the `// SAFETY:` convention was applied inconsistently across the FFI surface as it grew.
- **Recommendation:** Add a one-line `// SAFETY: query is only Some if successfully opened; take() prevents a double-close.` comment.
- **Complexity & risk:** Quick win — comment-only change.

#### CQ-003 — Two unsafe blocks use loose `// unsafe:` prose instead of the mandated `// SAFETY:` keyword
- **Status:** CONFIRMED
- **Lens:** B (Security — unsafe code hygiene)
- **Location:** `src-tauri/src/state.rs:87-90` (`NvAPI_Initialize()`), `src-tauri/src/collector/nvidia.rs:88-91` (NVAPI thermal query)
- **Evidence:**
  ```rust
  // state.rs:87-90
  // NVAPI must be initialized once per process. Same reason as PDH query handle — stateful C API.
  #[cfg(feature = "nvapi")]
  let nvapi_initialized = {
      let status = unsafe { nvapi_sys::nvapi::NvAPI_Initialize() };
      ...

  // nvidia.rs, preceding the unsafe block:
  // NVAPI must be initialized once per process — same reason as PDH query handle, stateful C API.
  // unsafe: NVAPI is a C library, Rust cannot verify its safety.
  // NVAPI_OK (0): all NVAPI functions return a status code; 0 = success.
  unsafe { ... }
  ```
- **Problem:** Both have *some* justification, but neither uses the exact `// SAFETY:` keyword the project's coding-standards table specifies, and the content explains *why the call happens* (once-per-process init) rather than the FFI safety invariant itself (pointer/buffer validity, ABI correctness) the convention is meant to capture.
- **Severity:** Low — weaker compliance than CQ-001/CQ-002, but not absent; genuinely the least severe of the three unsafe-comment findings.
- **Impact:** Grep-based auditing for `// SAFETY:` comments (a reasonable way to spot-check unsafe code review coverage) would miss these two blocks entirely, undercounting actual documented coverage.
- **Likelihood:** N/A — static gap.
- **Root cause:** Convention drift — likely written by whoever added NVAPI support without cross-checking the exact keyword against `.cursorrules`.
- **Recommendation:** Reword both to use `// SAFETY:` verbatim, for grep-ability and consistency with the rest of the codebase.
- **Complexity & risk:** Quick win — comment rewording only.

---

### 4.2 Correctness

#### COR-001 — `metrics-update` fires at 4Hz but the frontend treats every event as one real second of history; charts silently desync from their labeled time window and get worse the longer the app runs
- **Status:** CONFIRMED — independently verified both halves myself, not solely trusting the reviewing agent.
- **Lens:** A (Correctness), D (Concurrency/cross-boundary), F (Architecture)
- **Location:** `src-tauri/src/main.rs:599` (unconditional emit) + `src/hooks/useMetrics.ts:217-251` (unconditional append)
- **Evidence:** Backend — the tick loop (`main.rs:566-612`) gates the *history commit* on `tick.is_multiple_of(4)`:
  ```rust
  let raw = if tick.is_multiple_of(4) { Some(collector::poll(...)) } else { None };
  ...
  if let Some(ref r) = raw {
      collector::commit_disk_network(&mut s, r);
      collector::commit_cpu(&mut s, r);
      collector::commit_gpu(&mut s, r);
      s.push_timestamp(ts);
  }
  registry.commit_all(&mut s, &reg_raw);
  build_snapshot(&s)   // <-- runs on EVERY tick, gate or no gate
  ```
  but the resulting snapshot is emitted unconditionally on every loop iteration, every 250ms:
  ```rust
  match tick_result {
      Ok(snapshot) => { app_handle.emit("metrics-update", snapshot).ok(); }  // main.rs:599 — no tick-cadence gate here
      ...
  }
  ```
  Frontend — `useMetrics.ts`'s `listen('metrics-update', ...)` handler applies **every single event** to history with no gating at all:
  ```ts
  const unlistenMetricsPromise = listen<MetricsSnapshot>('metrics-update', (event) => {
    const snap = event.payload;
    ...
    setHistory((prev) => {
      if (!prev) return prev;
      const now = Date.now();
      return {
        timestamps: appendToHistory(prev.timestamps, now, MAX_HISTORY),
        cpu: appendToHistory(prev.cpu, snap.cpu, MAX_HISTORY),
        ...
      };
    });
  });
  ```
  `sliceWindow()` (called from the hook's return value) then takes the last `windowSeconds` **array elements**, implicitly assuming 1 element = 1 real second.
- **Problem:** The project already paid to fix this exact bug class once, on the backend side (git log: `1c30a6c "fix: CPU history commit rate 4Hz → 1Hz — registry.commit_all gated to full ticks only"`), and CLAUDE.md/.cursorrules explicitly document the invariant ("providers may poll at 250ms but must never commit to history more than once per second... any new sensor provider must follow this rule"). But the invariant was only enforced inside the Rust-side `HistoryStore` ring buffer — it was never propagated across the IPC boundary to the frontend's own history accumulation, which re-derives the same bug independently. `mem`/`net_recv`/`net_sent`/per-disk `active` values are only *refreshed* on full ticks server-side (so 3 of every 4 frontend appends push a byte-for-byte repeat of the same value), while `cpu`/GPU util values *do* get a fresh reading every 250ms from the sensor registry — so different chart lines on the same dashboard are inconsistently oversampled relative to each other, on top of all of them being oversampled relative to the labeled time window.
- **Severity:** High. (Not "Critical" by the letter of the rubric — no crash, no data loss, no security breach — but this corrupts the single feature the app exists to provide: accurate historical telemetry, for literally every user, on literally every run.)
- **Impact:** Initial `get_history()` load is correct (built from the true 1Hz Rust buffers), so charts are accurate right after mount. From then on, every incoming event over-appends. Once total incoming events since mount exceed the buffer's headroom, the 1Hz `get_history` seed data starts getting evicted by the 4x-denser live stream. With `MAX_HISTORY = 3600` and live appends arriving at 4/sec, the buffer fills purely from live data in `3600 / 4 = 900` seconds ≈ **15 minutes** — after which the entire 3600-slot "1 hour" buffer actually spans ~15 real minutes, and any window selection ("30m", "1h") silently shows roughly a quarter of the real time span its label claims. Mem/net/disk chart lines additionally show visibly duplicated/"stepped" points where 3-of-4 samples repeat.
- **Likelihood:** Certain, on every session, worsening monotonically with uptime until the buffer is saturated with 4Hz-only data (~15 minutes in).
- **Root cause:** The 1Hz-history invariant is enforced inside `HistoryStore` but the IPC emit boundary and the frontend's own accumulation logic were never given the same gate — a classic "invariant enforced in one layer, silently violated one layer up" bug, and the exact failure mode the project's own prior fix (`1c30a6c`) was meant to prevent, just recurring across the wire instead of within the backend.
- **Recommendation:** Tag each emitted snapshot with whether it came from a full tick (e.g. add `is_full_tick: bool` to `MetricsSnapshot`, or simply only emit `metrics-update` on full ticks and use a separate lightweight/lower-frequency event or direct field for the 250ms live-freshness numbers the UI badges want). On the frontend, only call `appendToHistory`/`mergeDiskHistory`/`mergeGpuHistory`/push a new timestamp when the flag is set; always update the "current value" display fields.
- **Trade-offs & alternatives:** Simplest fix (emit only on full ticks) loses the 250ms-fresh "current CPU%" badge responsiveness the sensor registry was built for — likely undesirable given the registry was added specifically for snapshot freshness. Better: keep emitting every 250ms for freshness, but include a monotonic full-tick counter/flag in the payload so the frontend can distinguish "update the live number" from "also append to history."
- **Complexity & risk:** Medium — touches the IPC payload shape (bump `SCHEMA_VERSION`/`EXPECTED_SCHEMA_VERSION` together per the project's own convention), both `main.rs` and `useMetrics.ts`, and needs new test coverage (see TEST-001, which independently found zero test coverage of this exact cadence invariant).
- **Regression safety:** Add a test asserting `appendToHistory`/`setHistory` is only invoked on flagged events (frontend), and a Rust test asserting the emitted `MetricsSnapshot`'s full-tick flag matches `tick.is_multiple_of(4)` over a simulated tick sequence (addresses TEST-001 at the same time). Manually verify in a running `npm run tauri dev` session that a 1-hour window, left running for >15 minutes, still shows a full hour of data with 1 sample/sec cadence.

#### COR-002 — Nvidia GPU telemetry is a single global scalar (device index 0) broadcast to every GPU classified as Nvidia
- **Status:** CONFIRMED — found independently by direct reading, and converged on by two independent review lenses.
- **Lens:** A (Correctness), K (Data layer — scalar vs. keyed design)
- **Location:** `src-tauri/src/collector/nvidia.rs:35` (`nvml.device_by_index(0)`), `src-tauri/src/main.rs:161-165` and `:237-241` (`build_snapshot`/`build_history_payload`)
- **Evidence:**
  ```rust
  // nvidia.rs:35
  let device = match nvml.device_by_index(0) { ... };
  ```
  ```rust
  // main.rs — inside .map() over every GPU entry, both build_snapshot and build_history_payload
  let temp_c = if collector::is_nvidia_gpu(name) && nvidia_temp.is_some() { nvidia_temp } else { None };
  ```
  `RawPoll`/`HistoryStore` carry `nvidia_temp`/`nvidia_power_w`/`nvidia_mem_used_mb`/`nvidia_mem_total_mb`/`nvidia_fan_speed_pct`/`nvidia_clock_mhz` as single top-level `Option<T>` scalars (`state.rs:21-31`, `:130-140`), never keyed by GPU index/LUID. The NVAPI-only fallback path (`nvidia.rs:113-137`) has the same shape: it loops all physical GPU handles but `return`s on the *first* one with a valid thermal sensor.
- **Problem:** On any system with 2+ discrete Nvidia GPUs, every Nvidia-classified `GpuSnapshot`/`GpuHistory` entry in the IPC payload reports the *identical* temperature/power/VRAM/fan/clock — that of device index 0 — even though the GPUs' actual readings differ.
- **Severity:** High for the affected hardware population; the data model makes this structurally impossible to fix without a schema change, so it isn't a narrow edge-case bug so much as a design assumption (exactly one discrete Nvidia GPU) baked into `RawPoll`/`HistoryStore`.
- **Impact:** Silent data misattribution — a user with, say, a laptop iGPU + 2 Nvidia dGPUs (or an Nvidia dGPU + Nvidia integrated encoder path) would see two "different" GPU cards reporting bit-identical thermal/power data.
- **Likelihood:** Low-population but real; HYPOTHESIS on exact frequency in the field (no telemetry on the actual install base's GPU topology) — the code-level bug itself is CONFIRMED regardless of how often it's hit.
- **Root cause:** Telemetry fields were designed assuming exactly one discrete Nvidia GPU per machine, never generalized when multi-GPU display support (the " 1"/" 2" suffix logic in `gpu.rs`) was added elsewhere in the same GPU pipeline.
- **Recommendation:** Key `nvidia_temp`/power/mem/fan/clock by GPU index or LUID the same way `gpu_entries`/`gpu_latest` already are; iterate `nvml.device_count()` devices instead of hardcoding index 0. Short-term mitigating alternative: explicitly document the one-discrete-Nvidia-GPU limitation if a full fix isn't prioritized soon.
- **Complexity & risk:** Medium — touches `RawPoll`, `HistoryStore`, `MetricsSnapshot`/`GpuSnapshot`, both build functions, and the TS mirror types; needs a `SCHEMA_VERSION` bump.
- **Verification:** No multi-Nvidia-GPU test hardware was available this session — recommend a hardware-in-the-loop check, or at minimum a unit test asserting `query_nvml` iterates all devices once implemented.

---

### 4.3 Architecture & Design / Data Layer

#### ARC-001 — Two physical GPUs with the same model name are silently merged and their utilization summed; the code that should prevent this is dead/unreachable
- **Status:** CONFIRMED
- **Lens:** A (Correctness), K (Data layer — identity/keying)
- **Location:** `src-tauri/src/collector/gpu.rs:217-239` (merge-by-caption) vs. `:257-277` (dead disambiguation branch)
- **Evidence:** `query_gpu_utilization_pdh()` builds `caption_util: HashMap<String display_name, (GpuClass, f64)>` (gpu.rs:217) by folding every LUID's utilization into the bucket keyed by its *exact caption string* (gpu.rs:234-239: `caption_util.entry(display_name).and_modify(|(_, u)| { *u = (*u + util).min(100.0); }).or_insert((class, util));`). This is documented as intentional for "multiple LUIDs (e.g. 0x00017C9F and 0x00017D0F) can map to the same physical GPU; sum their utilization" (gpu.rs:215-216) — i.e. merging multiple *engines* of one physical GPU. But the same key (exact caption text) is used regardless of whether the LUIDs actually belong to one physical GPU or to two separate, identically-modeled physical GPUs (e.g. two "NVIDIA GeForce RTX 4090" cards) — WMI's `Win32_VideoController` would emit the same caption string for both, so their utilization gets silently summed into a single reported entry. Because `entries` (gpu.rs:242-245) is built by iterating `caption_util.into_iter()`, it can never contain two elements with the same display_name — yet gpu.rs:257-277 contains a "For duplicate display names (same model), add ' 1', ' 2' suffix" branch (`name_counts`/`name_indices`) whose guard (`*name_counts.get(&display_name).unwrap_or(&0) > 1`) can never be true, since `name_counts` is built by counting `entries`, which is already deduplicated by that same key one step earlier.
- **Problem:** This is dead code masking the real bug: distinct multi-GPU-of-the-same-model systems are not distinguishable from multi-engine-of-one-GPU systems, and their reported 3D utilization is silently combined (and clamped) rather than kept separate.
- **Severity:** Medium-High — the dead disambiguation code shows the author intended to handle exactly this case; the intended fix simply doesn't take effect. Frontend GPU identity (`utils.ts gpuId`, `useMetrics.ts mergeGpuHistory`, both matching purely on `name`) inherits the same flaw, not an independent bug.
- **Impact:** On systems with two or more identically-modeled Nvidia/AMD/Intel GPUs, the dashboard would show one GPU card whose utilization is the sum of both real GPUs (misleadingly clamped to 100%) instead of two independent cards.
- **Likelihood:** Limited to multi-identical-GPU hardware (SLI-era or multi-GPU workstations), but the dead code shows the author intended to handle this case and the intended fix does not actually take effect.
- **Root cause:** The code conflates two different reasons multiple LUIDs might exist (multiple engines of one GPU vs. multiple physical GPUs of the same model) using a single grouping key (caption text) that cannot tell them apart.
- **Recommendation:** Key `caption_util` (and downstream `entries`) by LUID group rather than by caption text alone, keeping physical GPUs distinct even when their caption strings collide, and reserve caption-based merging only for LUIDs already known to belong to the same physical adapter.
- **Complexity & risk:** Medium — the merge logic is centralized in one function, but disambiguating "same GPU, two engines" from "two GPUs, same model" without a better hardware key (PCI bus address, not currently queried anywhere in this codebase) is a real design question, not just a one-line fix.

#### ARC-002 — Single background thread has no supervisory restart; one panic permanently ends all metrics collection
- **Status:** CONFIRMED (independently found by both the Architecture lens and the Correctness/Concurrency lens — high-confidence convergence)
- **Lens:** F (Architecture — single point of failure), D (Concurrency)
- **Location:** `src-tauri/src/main.rs:429` (the one `thread::spawn`), `:601-608` (panic arm)
- **Evidence:**
  ```rust
  match tick_result {
      Ok(snapshot) => { app_handle.emit("metrics-update", snapshot).ok(); }
      Err(_) => {
          eprintln!("[Collector] background thread panicked");
          app_handle.emit("collector-error", "metrics collection stopped — restart the app").ok();
          break;   // exits the loop {} permanently
      }
  }
  ```
  Grepping the whole `src-tauri/src` tree for `JoinHandle`/`respawn`/`restart`/`thread::spawn` confirms: the only `thread::spawn` is the one at startup, and the only "restart" anywhere in the codebase is the literal string told to the user in the error message. This is unlike the WMI connection setup a few lines earlier in the same function, which has an explicit exponential-backoff retry loop (`main.rs:437-490`) — the omission of any retry for the tick loop itself is a deliberate asymmetric design choice, not an oversight in that one spot.
- **Problem:** The entire backend runs as one thread with a single tick loop wrapped in `catch_unwind`. On any panic, the `Err` branch prints a message, emits `collector-error`, and `break`s — there is no retry, no thread respawn, and no watchdog anywhere in the codebase. The frontend's only recourse (per `useMetrics.ts:252-254`, listening for `collector-error`) is a persistent banner; there's no reconnect attempt, no re-invoke of `get_history`, nothing that could recover without the user closing and relaunching the whole application.
- **Severity:** High — this is a hard single point of failure for an app whose entire value proposition is continuous real-time monitoring.
- **Impact:** Any single unexpected panic in 250ms-loop code (a PDH/WMI/NVML FFI edge case, an unwrap on unexpected hardware data, etc.) takes down the entire live-metrics feature for the rest of the process's life, with the only remedy being a full app restart.
- **Likelihood:** Depends on hitting an unhandled panic path in 250ms/1Hz Win32 I/O code across arbitrary hardware configurations — plausible over long uptimes given how much unsafe FFI (PDH/WMI/NVAPI/NVML) runs in that loop. HYPOTHESIS on exact real-world frequency; no crash reports reviewed this session.
- **Root cause:** `catch_unwind` was added to convert a would-be process crash into a graceful, user-visible failure, but no restart/supervision layer was added on top of it.
- **Recommendation:** Wrap the loop body's `catch_unwind` result in a bounded-retry supervisory outer loop (e.g. respawn the collector state and resume, with a backoff and a cap, similar to the existing WMI retry pattern) instead of `break`ing permanently.
- **Trade-offs & alternatives:** A restart-with-backoff risks masking a systemic bug behind repeated silent restarts if not paired with the logging fix (ERR-002) first — sequence logging before restart-supervision (see roadmap, §6).
- **Complexity & risk:** Large — needs careful `CollectorState` re-init semantics (PDH handles must not be needlessly recreated per the existing invariant) and a backoff/cap policy.

#### ARC-003 — SensorProvider/SensorRegistry does not generalize to new metric domains as its doc comment claims
- **Status:** CONFIRMED
- **Lens:** F (Architecture — extensibility)
- **Location:** `src-tauri/src/sensor.rs:1-2` (doc comment) vs. `src-tauri/src/main.rs:574-590` (actual tick-loop behavior)
- **Evidence:** `sensor.rs`'s header comment claims the registry is a generic extensibility point: "Per-provider poll intervals; registry schedules providers by elapsed time." `SensorProvider` exposes a generic `poll_interval()`/`poll()`/`commit()` contract. But the tick loop in `main.rs` hardcodes the real behavior: on `tick % 4 == 0` ("full poll"), the registry is not polled at all — `reg_raw` is forced to a vector of `None` (`main.rs:574-578`) — and instead three concretely-named functions are called directly: `collector::commit_disk_network(&mut s, r)`, `collector::commit_cpu(&mut s, r)`, `collector::commit_gpu(&mut s, r)` (`main.rs:584-586`), fed by the monolithic `collector::poll()` (`collector/mod.rs:127-245`) which itself hardcodes CPU+mem+net+disk+GPU in one function. There is no `DiskSensorProvider` or `NetworkSensorProvider` anywhere in `sensor.rs` (confirmed: only `CpuSensorProvider` and `GpuSensorProvider` exist) — disk/network history commits happen exclusively through this hardcoded full-tick path, never through the `SensorProvider` trait.
- **Problem:** Trying to add a third provider (e.g. a disk-per-drive or network-interface provider) at 250ms cadence the way `CpuSensorProvider`/`GpuSensorProvider` do would only get you scalar "latest value" refreshes on off-ticks (via `commit_all`, `main.rs:590`) — the 1Hz *history* commit for that new metric would still have to be hand-added to `collector::poll()` and to the explicit `main.rs:584-586` call list, exactly duplicating the disk/network special-casing that already exists. The abstraction covers 2 of 3 metric domains for scalar refresh only; it does not cover history commits at all, contradicting its own doc comment.
- **Severity:** Medium.
- **Impact:** Any future contributor who reads `sensor.rs`'s doc comment and tries to add a new 250ms provider for a metric that needs 1Hz history (not just a scalar refresh) will find the abstraction insufficient and will have to bypass it, most likely re-touching `main.rs`'s tick loop and `collector::poll()` — i.e. the registry is not the extensibility seam it presents itself as.
- **Likelihood:** Would be hit the next time someone adds a disk-per-provider or network-provider sensor.
- **Root cause:** Registry was retrofitted around the pre-existing hardcoded `collector::poll()`/`commit_*` full-tick path rather than the full-tick path being expressed as just another (1Hz-interval) `SensorProvider`.
- **Recommendation:** Either extend `SensorProvider`/`SensorRegistry` with a "full-tick history commit" path so disk/network (and any future provider) can register through the same mechanism, or update the doc comment to state plainly that the registry only handles scalar/off-tick refresh for CPU+GPU and that history commits remain hardcoded in `main.rs`.
- **Complexity & risk:** Medium — a real design decision, not a bug fix; touches the trait contract.

#### ARC-004 — `types/metrics.ts` already drifted from the Rust structs it manually mirrors: nullable `Option<T>` fields typed as non-nullable optionals
- **Status:** CONFIRMED
- **Lens:** K (Data layer — IPC contract drift)
- **Location:** `src/types/metrics.ts:21-27`
- **Evidence:** Rust's `MetricsSnapshot` (`main.rs:27-51`) declares `nvidia_power_w`, `nvidia_mem_used_mb`, `nvidia_mem_total_mb`, `nvidia_fan_speed_pct`, `nvidia_clock_mhz` all as `Option<T>` — serde's default behavior serializes these fields as always-present with a JSON `null` when `None` (no `#[serde(skip_serializing_if)]` anywhere in `main.rs`). The manually-mirrored TS interface types them as `nvidia_power_w?: number;` etc. (`types/metrics.ts:23-27`) — optional-but-not-nullable — while the adjacent `cpu_temp_c?: number | null;` and `nvidia_temp?: number | null;` (lines 21-22) correctly include `| null`.
- **Problem:** This is a concrete, already-existing instance of the exact drift risk the "manually mirrored, no codegen" contract is exposed to: the type checker does not know these fields can be `null` at runtime.
- **Severity:** Low — currently masked because all call sites (`App.tsx:191-195, 327-335`) defensively use `!= null` checks that happen to also catch `null`, so there's no live crash today.
- **Impact:** This is exactly the kind of silent drift that would bite the next time someone writes `const w = metrics.nvidia_power_w.toFixed(1)` trusting the (wrong) non-nullable type, or a linter/strict-null-checks pass that assumes the annotation is accurate.
- **Likelihood:** Low today (no crash observed), but the type inaccuracy is unconditionally present in every build.
- **Root cause:** No codegen enforcing Rust-struct-to-TS-interface parity; the nvml-gated fields were added to Rust with `#[cfg(feature="nvml")] Option<T>` but their TS mirror was typed by analogy to a plain optional field rather than to the other `Option<f64>` fields in the same struct.
- **Recommendation:** Add `| null` to the five `nvidia_*` optional numeric fields in both `MetricsSnapshot`'s and `HistoryPayload`-adjacent `NvidiaStats`-consuming code paths to match actual `Option<T>` serde output.
- **Complexity & risk:** Quick win — type-annotation-only change.

#### ARC-005 — `settings.json` has no schema-version field and no validation on read; malformed/stale values pass through untouched
- **Status:** CONFIRMED
- **Lens:** K (Data layer — schema-less migration risk)
- **Location:** `src/hooks/useSettings.ts:7-13` (`Settings` interface), `:36-46` (load path)
- **Evidence:** Unlike the metrics IPC contract, which has `SCHEMA_VERSION`/`EXPECTED_SCHEMA_VERSION` (=2) checked on every payload via `assertSchemaVersion()` (`useMetrics.ts:10-18`), the `Settings` interface carries no version field at all, and `useSettings()`'s load path does a blind generic-cast read for each key — `await s.get<ViewMode>('viewMode')`, `await s.get<number>('windowSecs')`, etc. — with the only fallback being `?? default`, which only substitutes when the stored value is `null`/`undefined`. There is no check that a stored `viewMode` value is actually one of `'default'|'tile'|'list'` (`utils.ts:8`), nor that `windowSecs` is a sane positive number, nor that `cardOrder`/`hiddenCardIds`/`sidebarCardOrder` arrays contain only currently-valid card IDs.
- **Problem:** A stale value written by a future or past app version whose `ViewMode` union differs (e.g. a removed/renamed mode) would be accepted as-is and only fail silently downstream at each `viewMode === 'tile'`/`viewMode === 'list'` comparison site (`App.tsx:378`, `MetricCard.tsx:110`), falling through to whatever the "else" branch happens to do — with no warning logged and no self-healing write-back to a valid default.
- **Severity:** Medium.
- **Impact:** A future `Settings` shape change (renaming a `ViewMode` value, changing `windowSecs`' unit/type, restructuring `cardOrder`) has no migration mechanism to detect and adapt old stored data — old/malformed values degrade silently (wrong view rendered, no error surfaced) rather than being caught and reset, making format changes to `settings.json` riskier than they need to be compared to the versioned `MetricsSnapshot`/`HistoryPayload` IPC contract in the same codebase.
- **Likelihood:** Would only manifest the next time the `Settings` shape changes across a release, or if `settings.json` is hand-edited/corrupted — no evidence this has happened yet.
- **Root cause:** `Store.load()`/`get<T>()` (tauri-plugin-store) only performs a TS-level generic cast, not runtime validation, and the project never added an app-level validation layer on top of it for `Settings` the way it did for the metrics IPC schema.
- **Recommendation:** Add a `settingsVersion` field (mirroring `SCHEMA_VERSION`'s pattern) plus a runtime validator/allowlist check on `viewMode` (and sanity bounds on `windowSecs`) at load time, resetting to `DEFAULTS` with a console warning on mismatch instead of trusting the generic cast.
- **Complexity & risk:** Medium — touches `useSettings.ts` load path only, no IPC/schema-version coupling required.

#### ARC-006 — `hardware::classify_gpu` and `collector::gpu::is_nvidia_gpu` use different Nvidia keyword sets, so Tesla/NVS cards are tagged `vendor: "unknown"` while still receiving the Nvidia temperature reading
- **Status:** CONFIRMED
- **Lens:** A (Correctness — inconsistent classification across two call sites)
- **Location:** `src-tauri/src/hardware.rs:118-150` (`classify_gpu`) vs. `src-tauri/src/collector/gpu.rs:61-70` (`is_nvidia_gpu`)
- **Evidence:** `hardware::classify_gpu`, used by `build_snapshot`/`build_history_payload` to populate the `vendor` field sent to the frontend, classifies Nvidia only via `nvidia|geforce|quadro|rtx|gtx` (`hardware.rs:120-125`) — it omits `tesla` and `nvs`. Meanwhile `collector::gpu::is_nvidia_gpu`, used in the same `build_snapshot`/`build_history_payload` functions to decide whether to attach `nvidia_temp` as a GPU's `temp_c`, explicitly includes `tesla` and `nvs` (with a comment stating this is intentional: "must also recognize professional-line model names (Quadro, Tesla, NVS)").
- **Problem:** Two independent, hand-maintained Nvidia-detection keyword lists were not kept in sync when Tesla/NVS support was added to only one of them.
- **Severity:** Medium.
- **Impact:** A Tesla or NVS-branded Nvidia GPU will have `vendor: "unknown"` in its `GpuSnapshot`/`GpuInfo` (so any frontend logic keyed on `vendor=='nvidia'`, e.g. icon/color selection, treats it as unrecognized hardware) while simultaneously being assigned the live `nvidia_temp` reading as its `temp_c` in the same payload — an internally inconsistent snapshot (unknown-vendor GPU with an Nvidia-sourced temperature).
- **Likelihood:** Limited to the (small) population running Tesla/NVS professional-line Nvidia cards — HYPOTHESIS on real-world frequency, code-level inconsistency is CONFIRMED.
- **Root cause:** Two hand-maintained Nvidia-keyword lists in two files, no shared source of truth.
- **Recommendation:** Factor Nvidia-name detection into one shared function used by both `hardware.rs`'s `classify_gpu` and `collector::gpu::is_nvidia_gpu` so the keyword lists cannot drift apart again.
- **Complexity & risk:** Quick-to-Medium — a small refactor extracting a shared predicate function.

#### ARC-007 — `cpu_latest`/`gpu_latest` are not updated on the full-poll tick, so the "prefer latest" logic in `build_snapshot` shows a value up to 250ms staler than what was just collected on that very tick
- **Status:** CONFIRMED
- **Lens:** A (Correctness — incorrect fallback/"latest value" preference logic)
- **Location:** `src-tauri/src/collector/mod.rs:304-307` (`commit_cpu`), `:345-360` (`commit_gpu_scalar` vs. `commit_gpu`)
- **Evidence:** `commit_cpu` (full-tick path, used via `main.rs:585`) pushes to `cpu_history` and sets `cpu_temp_c`, but never touches `cpu_latest`. Only `commit_cpu_scalar` (used by `CpuSensorProvider` on non-full ticks via the sensor registry) sets `store.cpu_latest = Some(poll.cpu_usage)`. The identical asymmetry exists for GPU: `commit_gpu` (full-tick path, `main.rs:586`) updates `gpu_entries` history and nvidia fields but never `gpu_latest`; only `commit_gpu_scalar` (registry path) sets `store.gpu_latest`. On a full-poll tick (`tick.is_multiple_of(4)`), `reg_raw` is forced to a vector of `None`s (`main.rs:574-578`) so the registry's scalar commits never run that tick. `build_snapshot` prefers `cpu_latest`/`gpu_latest` over the freshly-pushed history `back()` value: `s.cpu_latest.unwrap_or_else(|| s.cpu_history.back()...)` (`main.rs:126-128`) and `s.gpu_latest.get(key).copied().unwrap_or_else(|| hist.back()...)` (`main.rs:169-173`).
- **Problem:** On every 4th tick (the full-poll tick), the CPU%/GPU util value in the emitted `MetricsSnapshot` is the sensor-registry's reading from up to 250ms earlier, rather than the just-collected full-poll reading that was simultaneously pushed into `cpu_history`/`gpu_entries` for that same instant.
- **Severity:** Medium.
- **Impact:** This creates a small but real inconsistency between the "live" scalar shown at that moment and what a subsequent `get_history` call will later show as the most recent history point for that timestamp.
- **Likelihood:** Occurs on every full-poll tick — i.e. every 4th tick, always — but the magnitude of the discrepancy (up to 250ms of staleness) is small relative to the values changing.
- **Root cause:** The full-tick commit functions and the scalar (sensor-registry) commit functions were split into separate helpers that write to non-overlapping fields (history vs. `*_latest`), but `build_snapshot`'s preference logic assumes `*_latest` is always the freshest available reading — which is false specifically on the tick where the full poll runs.
- **Recommendation:** Have `commit_cpu`/`commit_gpu` also set `cpu_latest`/`gpu_latest` from the just-collected `poll.cpu_usage`/`gpu_updates`, so the "prefer latest" logic is correct on every tick, not just the 3-out-of-4 sensor-registry ticks.
- **Complexity & risk:** Quick-to-Medium — a small, localized addition to two existing functions.

---

### 4.4 Error Handling & Observability

#### ERR-001 — Unhandled `Store.load()`/`get()` rejection permanently blanks the entire app
- **Status:** CONFIRMED
- **Lens:** E (Error handling)
- **Location:** `src/hooks/useSettings.ts:33-49`, gated by `src/App.tsx:139`
- **Evidence:**
  ```ts
  (async () => {
    const s = await Store.load(STORE_PATH);
    setStore(s);
    const cardOrder = await s.get<string[]>('cardOrder');
    ... // 4 more awaited s.get() calls
    setLoaded(true);
  })();  // no try/catch, no .catch()
  ```
  ```tsx
  // App.tsx:139
  if (!loaded) return null;
  ```
- **Problem:** If `Store.load`, or any of the five `s.get(...)` calls that follow, rejects (plugin-store IPC error, a locked/corrupted `settings.json`, disk I/O failure), the promise rejection is unhandled and `setLoaded(true)` is never reached. App.tsx gates the ENTIRE component tree on this: `if (!loaded) return null;`. The result is a permanently blank window with zero visual indication of failure — not even the "Collecting metrics…" fallback, since that branch is never reached.
- **Severity:** High.
- **Impact:** A single Store failure (which the two independent `useSettings()` call sites in `App.tsx` and `HardwareSidebar.tsx` both trigger on every mount) makes the app appear completely broken/frozen with no way to tell the user what happened or how to recover, other than trial-and-error deletion of `settings.json`.
- **Likelihood:** Low-to-moderate in the field (store corruption, concurrent write, or plugin IPC hiccup), but the blast radius (100% of the UI, indefinitely) is severe relative to how easy this would be to guard with a `.catch` that still calls `setLoaded(true)`.
- **Root cause:** Async effect body has no error boundary of its own; `ErrorBoundary.tsx` only catches synchronous render/lifecycle errors (`componentDidCatch`), not promise rejections thrown from `useEffect`, so this class of failure is invisible to the one error-handling component the app has.
- **Recommendation:** Wrap the IIFE body in try/catch, log the error, and call `setLoaded(true)` in a `finally` (or catch) so the app renders with defaults instead of hanging blank forever.
- **Complexity & risk:** Quick win — a single function, no happy-path behavior change.
- **Regression safety:** Add a test that mocks `Store.load` to reject and asserts `loaded` still becomes `true` with default settings.

#### ERR-002 — Collector-thread panic payload is discarded and no persistent log exists — production crashes are undiagnosable, and the resulting banner offers no in-app recovery
- **Status:** CONFIRMED
- **Lens:** E (Error handling)
- **Location:** `src-tauri/src/main.rs:601-607` (panic arm), `:2` (`windows_subsystem` hides console)
- **Evidence:**
  ```rust
  Err(_) => {
      eprintln!("[Collector] background thread panicked");
      app_handle.emit("collector-error", "metrics collection stopped — restart the app").ok();
      break;
  }
  ```
  ```rust
  // main.rs:2
  #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
  ```
  The `Err(_)` pattern discards the actual `Box<dyn Any + Send>` panic payload entirely — the panic message/location `catch_unwind` captured is thrown away rather than logged. Combined with the `windows_subsystem` attribute, which hides the console in release builds, and the fact that `Cargo.toml` has no logging crate (no `tauri-plugin-log`/`log4rs`/`tracing-subscriber` — confirmed absent), there is no way for a packaged-app user (or the developer receiving a bug report) to ever learn why the collector died. The frontend banner (`App.tsx:400-415`) only renders the generic static string with no action button, no diagnostic detail, and no way to reconnect in-place.
- **Problem:** Any future bug that panics the collector thread (e.g. a bad array index in a new PDH/WMI code path) is completely opaque in the field: no panic message, no location, no stack context reaches any persisted artifact, and the only user-visible recourse is a static banner with no "reload"/"restart collector" affordance.
- **Severity:** High.
- **Impact:** Certain to matter the first time any panic actually occurs in production; the architecture already documents that panics are expected to permanently end metrics collection, so this is the one path guaranteed to eventually fire in a long-running desktop app.
- **Likelihood:** HYPOTHESIS on current real-world frequency (not yet observed in any log reviewed this session) — only the consequence is confirmed by code inspection.
- **Root cause:** `catch_unwind` was added to convert a would-be process crash into a graceful, visible failure, but no logging or supervision layer was added on top.
- **Recommendation:** Capture the panic payload (`if let Some(s) = e.downcast_ref::<&str>() {...}` / `String`) and include it in both the `eprintln` and ideally a rotating log file (e.g. `tauri-plugin-log`) so crash reports are actionable; consider adding a button that at least reloads the webview or invokes a new `restart_collector` command instead of a text-only dead end.
- **Complexity & risk:** Medium for logging (self-contained addition); Large for supervised restart (see ARC-002).

#### ERR-003 — WMI 8-attempt backoff giveup produces zero persistent, user-discoverable signal
- **Status:** CONFIRMED
- **Lens:** E (Error handling)
- **Location:** `src-tauri/src/main.rs:452-456` (COM-init giveup), `:481-485` (WMIConnection giveup)
- **Evidence:** After exhausting `WMI_MAX_ATTEMPTS` (8) retries with exponential backoff, both the COM-init failure path and the WMIConnection failure path do nothing but `eprintln!("[WMI] Giving up after {} attempts. GPU classification and CPU thermal unavailable.", ...)`. Because `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` (`main.rs:2`) hides the console in release, this message is never seen by the actual packaged-app user. No `app_handle.emit(...)` call exists on this path (unlike the panic path, which does emit `collector-error`) — the app just continues running in a silently degraded mode (no CPU temp, no GPU vendor classification/GPU cards) for its entire lifetime with nothing distinguishing "sensor unavailable" from "still loading" anywhere in the IPC payload or the UI.
- **Problem:** A user on a machine where WMI never comes up (locked-down group policy, WMI repository corruption, etc.) permanently loses CPU temperature and GPU vendor/model classification for the whole session with absolutely no in-app explanation — `cpu_temp_c` and gpu `vendor` fields just silently read `None`/`'unknown'` forever, indistinguishable from a machine that genuinely lacks those sensors.
- **Severity:** Medium.
- **Impact:** Silent, permanent loss of thermal/GPU-classification data with no distinguishing signal.
- **Likelihood:** Low-moderate (WMI outages are uncommon but do happen on locked-down corporate images, a plausible audience for a sysadmin-facing monitor); the architecture confirms this is an 8-attempt, ~total-2-minute retry window with no re-attempt afterward for the rest of the process.
- **Root cause:** No diagnostic event exists for this degraded-but-running state, unlike the fully-stopped (panic) state which does get an event.
- **Recommendation:** Emit a distinct, low-severity event (e.g. `sensor-degraded` with a reason string) on WMI giveup so the frontend can show a small persistent indicator (distinct from the collector-error banner) explaining that thermal/GPU-classification data is unavailable, instead of leaving those fields permanently and silently null.
- **Complexity & risk:** Medium — a small new event plus a small frontend indicator component.

#### ERR-004 — `gpu_error_lock`/`cpu_temp_error_lock` are literally "log once for the process lifetime" — and the GPU case silently drops the GPU from every future snapshot, not just the log
- **Status:** CONFIRMED
- **Lens:** E (Error handling)
- **Location:** `src-tauri/src/state.rs:53-54` (`OnceLock` fields), `src-tauri/src/collector/gpu.rs:220-227` (usage)
- **Evidence:**
  ```rust
  // state.rs:53-54
  pub gpu_error_lock: OnceLock<()>,
  pub cpu_temp_error_lock: OnceLock<()>,
  ```
  ```rust
  // gpu.rs:220-227
  if matches!(class, GpuClass::Unknown) {
      gpu_error_lock.get_or_init(|| {
          eprintln!("[GPU] LUID {} not matched by vendor keyword — GpuClass::Unknown", luid);
      });
      continue;   // <-- this continue is NOT gated by the lock; it runs every single poll
  }
  ```
- **Problem:** `gpu_error_lock`/`cpu_temp_error_lock` are `get_or_init`-gated, so their logging closures run exactly once ever, no matter how many times, or for how many *different* underlying reasons, the condition recurs. The `continue` (not gated by the lock) means an unclassified GPU is dropped from the snapshot on *every* poll for the rest of the process's life, while only the very first offending LUID is ever logged. If a *different* LUID starts failing classification later (e.g. after a driver/WMI regression that only affects a second GPU added after the first one was already working), that new failure is completely silent — no log line will ever be produced again for the remainder of the run, and the GPU simply vanishes from the dashboard with no explanation anywhere.
- **Severity:** Medium.
- **Impact:** Silent, permanent disappearance of a GPU card from the UI with no corresponding user-facing signal, and the one-time diagnostic log (already invisible in release builds per ERR-002's `windows_subsystem` finding) becomes even less useful since it only ever names the first LUID that failed, not any subsequent/different one.
- **Likelihood:** Moderate — multi-GPU laptops/desktops where classification depends on WMI timing are the exact scenario this project is built for (iGPU+dGPU laptops), so a transient WMI hiccup on one GPU during startup permanently and silently suppresses future diagnostics for any other GPU that later fails classification.
- **Root cause:** `OnceLock<()>` is a process-lifetime, condition-agnostic gate — it cannot distinguish "already logged this exact failure" from "already logged some failure, ever."
- **Recommendation:** Either drop the `OnceLock` and log per-LUID with de-duplication (e.g. a `HashSet` of already-logged LUIDs) so new/different failures are still observable, or at minimum stop `continue`-ing the GPU out of the result silently — surface unknown-class GPUs with a distinct "unclassified" marker instead of omitting them.
- **Complexity & risk:** Medium — replacing `OnceLock<()>` with a `HashSet<String>` (behind a `Mutex` or similar) is a small, localized change.

#### ERR-005 — `read_pdh_counter_array` swallows all PDH read failures with zero logging, indistinguishable from a legitimate empty/idle reading
- **Status:** CONFIRMED
- **Lens:** E (Error handling)
- **Location:** `src-tauri/src/pdh.rs:45` (sizing call), `:70` (failure branch)
- **Evidence:** The sizing call `let _ = PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut buffer_size, &mut item_count, None);` (line 45) discards its return code entirely, and the real-data call's failure path `if status != 0 { return HashMap::new(); }` (line 70) returns an empty map with no `eprintln`/log of any kind — unlike every other fallible OS call in the codebase (which at least `eprintln!`s once). This function backs GPU utilization (via `query_gpu_utilization_pdh`, polled up to 4x/sec through the sensor registry) and all disk metrics.
- **Problem:** If PDH counter reads start failing mid-session (e.g. after a driver update, sleep/resume, or handle invalidation) GPU and disk cards silently go flat/zero forever with absolutely no trace in logs or UI to distinguish "genuinely idle" from "PDH is broken" — worse than the `OnceLock`-gated messages elsewhere because there isn't even a first-occurrence log.
- **Severity:** Medium.
- **Impact:** Undiagnosable stuck-at-zero GPU/disk cards.
- **Likelihood:** Low per-poll, but the function runs continuously for the app's entire lifetime (up to 4 Hz), so any transient or permanent PDH regression is a near-certainty to be hit eventually with this being the only code path involved.
- **Root cause:** Missing logging, inconsistent with the rest of the codebase's error-handling convention.
- **Recommendation:** Log (at least once, e.g. via a `OnceLock` guard consistent with the rest of the codebase, or better, a de-duplicated set per ERR-004's recommendation) when either `PdhGetFormattedCounterArrayW` call returns non-zero, so a stuck-at-zero GPU/disk card can be diagnosed instead of mistaken for real telemetry.
- **Complexity & risk:** Quick win — a logging addition only.

#### ERR-006 — `useMetrics`' `get_history()` IPC failure is only `console.warn`'d — history stays null forever, wedging the UI on "Collecting metrics…" with no error surfaced
- **Status:** CONFIRMED
- **Lens:** E (Error handling)
- **Location:** `src/hooks/useMetrics.ts:207`
- **Evidence:**
  ```ts
  invoke<HistoryPayload>('get_history', { windowSecs: windowSeconds })
    .then((payload) => { ... })
    .catch((err) => console.warn('[useMetrics] get_history failed:', err));
  ```
  On failure, `setHistory` is never called, so `history` stays `null` and `useMetrics` returns `null` from then on. App.tsx then falls into its default empty state: `{!metrics || cardOrder.length === 0 ? (<div>...Collecting metrics…</div>) : ...}` — an infinite, unexplained "Collecting metrics…" with no indication to the user that the initial IPC call actually failed rather than merely being slow.
- **Problem:** Any `invoke` rejection (not just the schema-mismatch case CLAUDE.md already documents) — e.g. a transient Tauri IPC hiccup, or the `SafeAppState` lock being poisoned — leaves the user staring at a permanent "Collecting metrics…" placeholder with zero diagnostic short of opening devtools, which a packaged-app end user won't do.
- **Severity:** Low.
- **Impact:** Confusing indefinite loading state with no distinguishing signal from a legitimate slow start.
- **Likelihood:** Low under normal operation (the same-process IPC rarely fails).
- **Root cause:** No retry/backoff or user-facing error state distinguishing "still loading" from "failed to load."
- **Recommendation:** On `get_history()` rejection, set a distinct error state (reusing the existing `collectorError` banner mechanism or a new one) instead of leaving `history` silently null, and/or retry with backoff.
- **Complexity & risk:** Quick win.

---

### 4.5 Code Quality, Tech Debt & Modernization

#### CQ-004 — Unnecessary and factually-misleading `unsafe impl Send/Sync` for `HistoryStore`
- **Status:** CONFIRMED (experimentally verified this session)
- **Lens:** G (Code quality)
- **Location:** `src-tauri/src/state.rs:204-207`
- **Evidence:** `HistoryStore` carries manual `unsafe impl Send for HistoryStore {}` / `unsafe impl Sync for HistoryStore {}`, justified by a comment that `HistoryStore` "is always accessed through `SafeHistoryStore = Mutex<HistoryStore>`, which provides mutual exclusion" — but Mutex access patterns have nothing to do with whether Send/Sync needs an unsafe impl in the first place. Verified experimentally this session: removing both unsafe impls and replacing them with a zero-unsafe static assertion (`fn f<T: Send + Sync>() {} fn _check() { f::<HistoryStore>(); }`) still compiles cleanly (`cargo check` succeeded), proving every field of `HistoryStore` (`VecDeque<f64>`, `String`, `HashMap<String,_>`, `Option<f64/u64/u32>`, `Vec<(String,String,VecDeque<f64>)>`, `Option<HardwareProfile>`) is already auto-Send+Sync.
- **Problem:** This is exactly the kind of thing the project's own unsafe-code discipline (every unsafe block needs a real, justified SAFETY comment) is meant to prevent: the comment is present but wrong, so a future reader is misled into thinking there's a genuine Send/Sync hazard here.
- **Severity:** Medium.
- **Impact:** Worse — the unsafe impl would silently paper over a real problem if a non-Send field (`Rc`, raw pointer, OS handle) were ever added to `HistoryStore` without re-checking auto-traits.
- **Likelihood:** N/A — static code issue, confirmed by compiling.
- **Root cause:** Likely copy-pasted from `PdhHandles`'s legitimate unsafe impl (`pdh.rs:32-33`, needed because `PDH_HQUERY`/`PDH_HCOUNTER` wrap raw opaque handles) without checking that `HistoryStore` holds no such handles and doesn't need it.
- **Recommendation:** Delete both `unsafe impl` blocks (state.rs:204-207, including the stale comment); `HistoryStore` remains Send+Sync automatically. Optionally keep a compile-time assertion with no unsafe.
- **Complexity & risk:** Quick win — deletion only, already verified safe by compiling without it.

#### CQ-005 — NVAPI is unconditionally initialized (unsafe FFI) but is dead code under the shipped default feature set
- **Status:** CONFIRMED
- **Lens:** N (Modernization)
- **Location:** `src-tauri/src/state.rs:88-92`, `Cargo.toml:29`
- **Evidence:** `Cargo.toml` sets `default = ["nvapi", "nvml"]` — the configuration every CI job and every plain `cargo build/test/clippy` actually uses. With both features on, `CollectorState::new()` unconditionally runs the unsafe `nvapi_sys::nvapi::NvAPI_Initialize()` FFI call and stores the resulting `nvapi_initialized` bool. But its only consumer, `nvidia::query_nvidia_gpu_temp()`, is called only under `#[cfg(all(feature = "nvapi", not(feature = "nvml")))]` at both call sites (`collector/mod.rs:213-214` and `sensor.rs:94-95`) — compiled out entirely whenever `nvml` is also enabled. A grep of `nvapi_initialized` across `src-tauri/src` shows no other reader.
- **Problem:** Every app start loads `nvapi64.dll` and calls into a proprietary Nvidia C API purely to populate a flag nothing reads in the default (and only tested/shipped) build — dead weight plus an unnecessary unsafe FFI surface (`EnumPhysicalGPUs`/`GetThermalSettings`) that can never execute in that configuration.
- **Severity:** Medium.
- **Impact:** Unnecessary unsafe FFI surface and DLL load on every startup.
- **Likelihood:** N/A — confirmed by reading `Cargo.toml` + cfg gates + grep.
- **Root cause:** The NVAPI→NVML migration (`nvidia.rs` header: "NVML ... Modern replacement for NVAPI") left the NVAPI init call wired unconditionally into `CollectorState::new()` instead of gating it the same way as its only consumer.
- **Recommendation:** Gate the `NvAPI_Initialize()` call itself behind `#[cfg(all(feature = "nvapi", not(feature = "nvml")))]` to mirror its consumer, or drop `nvapi` from `default` now that `nvml` unconditionally provides temperature (plus power/VRAM/fan/clock).
- **Complexity & risk:** Quick win — a small cfg-gate change.

#### CQ-006 — Dead `collector::commit()` function marked `#[allow(dead_code)]` violates the project's own stated convention
- **Status:** CONFIRMED
- **Lens:** G (Code quality)
- **Location:** `src-tauri/src/collector/mod.rs:249`
- **Evidence:** `commit()` is marked `#[allow(dead_code)]` with the comment "Unused in favour of granular commit_* when raw.is_some()." It is superseded by the granular `commit_cpu`/`commit_gpu`/`commit_disk_network`, and is never called anywhere in `main.rs`'s tick loop nor in any test.
- **Problem:** The project's own coding standards state: "Do not add `#[allow(...)]` to suppress warnings unless the suppression is conditional (`#[cfg_attr(...)]`) and explicitly justified in a comment." This is a plain, unconditional `#[allow(dead_code)]`, not a `cfg_attr`-conditional one.
- **Severity:** Low.
- **Impact:** Will silently drift out of sync with the granular functions it duplicates since it's never exercised, not even in tests — 50+ lines of dead code masquerading as a maintained fallback.
- **Likelihood:** N/A.
- **Root cause:** Left in place as a "reference implementation" after the granular commit functions were introduced, without removing the superseded original.
- **Recommendation:** Delete it.
- **Complexity & risk:** Quick win.

#### CQ-007 — `hardware.rs`'s unused public methods marked `#[allow(dead_code)]` "for future providers"
- **Status:** CONFIRMED
- **Lens:** G (Code quality)
- **Location:** `src-tauri/src/hardware.rs:64` (`has_nvidia_dgpu`), `:72` (`has_intel_igpu`), `:80` (`has_amd_gpu`)
- **Evidence:** All three are marked `#[allow(dead_code)]` with comments like "Used for future Intel iGPU provider." None are called anywhere in the current codebase.
- **Problem:** Speculative, unexercised public API surface added ahead of any actual consumer.
- **Severity:** Low.
- **Impact:** Minor maintenance burden; no functional risk.
- **Likelihood:** N/A.
- **Root cause:** Forward-looking design added before the feature that would use it.
- **Recommendation:** Remove until an actual consumer exists, per YAGNI; easy to re-add when needed.
- **Complexity & risk:** Quick win.

#### CQ-008 — `MAX_HISTORY`/`HISTORY_LEN` = 3600 hardcoded independently in three places across two languages
- **Status:** CONFIRMED
- **Lens:** G (Code quality)
- **Location:** `src-tauri/src/state.rs` (`HISTORY_LEN`), `src-tauri/src/collector/mod.rs` (`MAX_HISTORY`), `src/hooks/useMetrics.ts` (`MAX_HISTORY`)
- **Evidence:** All three independently declare `= 3600` with no cross-reference or shared source.
- **Problem:** No single source of truth for the ring-buffer capacity policy.
- **Severity:** Low.
- **Impact:** If the history-length policy ever changes, three places need updating in lockstep across two languages, easy to drift.
- **Likelihood:** Would only manifest if the constant is ever changed.
- **Root cause:** No shared constants file/codegen between Rust and TypeScript.
- **Recommendation:** At minimum, a comment cross-referencing the other two locations; ideally derive the frontend constant from the schema/IPC contract.
- **Complexity & risk:** Quick win (comment) to Medium (actual single-sourcing).

#### CQ-009 — `isTauri()`-equivalent runtime check duplicated inline in two files
- **Status:** CONFIRMED
- **Lens:** G (Code quality)
- **Location:** `src/hooks/useMetrics.ts`, `src/hooks/useSettings.ts`
- **Evidence:** Both files independently check `window.__TAURI_INTERNALS__` inline rather than importing a shared `isTauri()` helper (which does exist in `useMetrics.ts` but isn't exported/reused by `useSettings.ts`, which has its own separate inline check).
- **Problem:** Duplicated logic that could drift (e.g. if the detection mechanism ever changes, both call sites need updating).
- **Severity:** Low.
- **Impact:** Minor maintainability issue.
- **Recommendation:** Extract to `utils.ts` per the project's own "Utilities: `src/utils.ts` (keep flat, one file)" convention.
- **Complexity & risk:** Quick win.

#### CQ-010 — `App.tsx`'s `renderCard()` is a 172-line/5-branch dispatcher, and its label fallback is duplicated verbatim
- **Status:** CONFIRMED
- **Lens:** G (Code quality)
- **Location:** `src/App.tsx:198-369` (`renderCard`), `:148-167` (`getCardLabel`)
- **Evidence:** `renderCard()` is one function with 5 independent `if (id === ...) return <SortableCard .../>` branches, each carrying its own value/badge/color JSX inline. Separately, `getCardLabel()` contains the identical fallback expression copy-pasted twice: lines 150-153 (the `!metrics` early-return) and lines 163-166 (the final fallback) are both `id.replace(/^(gpu|disk|net)_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())`.
- **Problem:** Incremental feature growth (CPU → memory → disk → network → GPU cards) was each added inline to the same if-chain/function rather than via a per-card-type renderer map or a shared formatter helper.
- **Severity:** Medium.
- **Impact:** Every new card type or shared behavior change requires touching one large function in several places; the copy-pasted fallback formatter is a live drift risk — a future edit to widen/change the regex in one copy but not the other would silently desync label formatting between the metrics-loaded and not-yet-loaded states.
- **Recommendation:** Extract a single `defaultCardLabel(id)` helper used by both branches in `getCardLabel`; consider a `Record<prefix, (id) => JSX>` renderer registry or per-card components to replace `renderCard`'s if-chain.
- **Complexity & risk:** Medium — a refactor, not a bug fix, but low regression risk if done incrementally.

#### CQ-011 — `useMetrics.ts` duplicates ~30 lines of snapshot-application logic between the real listener and the browser mock interval
- **Status:** CONFIRMED
- **Lens:** G (Code quality)
- **Location:** `src/hooks/useMetrics.ts:217-250` (real listener) vs. `:260-292` (mock `setInterval`)
- **Evidence:** Both perform the identical sequence: `setMemGb`, `setNvidiaStats`, `setGpuMeta` (with the same Map-based name→vendor merge), then `setHistory` rebuilding the same shape via `appendToHistory`/`mergeDiskHistory`/`mergeGpuHistory` over the same field list — differing only in where `snap` originates and a couple of `??` fallbacks.
- **Problem:** The browser mock path (added so `npm run dev` works without a Tauri backend) had its state-update logic copy-pasted from the real listener instead of factored into one shared apply function called from both places.
- **Severity:** Medium.
- **Impact:** Any future change to how a snapshot updates state (new field, merge-bug fix) has to be made twice; the two paths can silently drift — the mock path is supposed to be a faithful preview of real behavior for browser-only frontend dev, and duplicated logic erodes that guarantee over time.
- **Recommendation:** Extract the shared body into a function like `applySnapshotToHistory(prev, snap)` plus a small helper for the `memGb`/`nvidiaStats`/`gpuMeta` setters, and call it identically from both the `listen` callback and the mock `setInterval`.
- **Complexity & risk:** Medium — a refactor with two call sites to update in tandem.

#### CQ-012 — Drive-letter-to-disk-key resolution logic duplicated between `physical_disk_list` and `poll_disk`
- **Status:** CONFIRMED
- **Lens:** G (Code quality)
- **Location:** `src-tauri/src/collector/disk.rs:160-202` (`physical_disk_list`) vs. `:205-274` (`poll_disk`)
- **Evidence:** Both independently build a `known_drive_letters` map from `sysinfo::Disks`, call `query_disk_active_time(pdh)`, then run the same filter — `pdh_instance_to_drive_letters(&instance_name)` filtered to letters present in `known_drive_letters`, skip if empty, join into `disk_key = mapped_letters.join(" ")` — as two hand-written copies instead of a shared helper.
- **Problem:** The function doc for `physical_disk_list` explicitly requires "same keys and order as `poll_disk`" — that invariant is currently maintained only by keeping two copies of the same filter/join logic manually in sync.
- **Severity:** Low.
- **Impact:** A future edit to one (e.g. how multi-letter disks are keyed) that isn't mirrored in the other would silently break the documented sidebar/dashboard disk-count match.
- **Root cause:** `physical_disk_list` was added later (to give the hardware-profile sidebar the same disk cards as the dashboard) by adapting `poll_disk`'s existing inline logic in place rather than factoring out the shared instance-to-key resolution.
- **Recommendation:** Extract a shared `fn resolve_disk_key(instance_name: &str, known_drive_letters: &HashMap<String,String>) -> Option<String>` and call it from both functions.
- **Complexity & risk:** Quick-to-Medium.

#### CQ-013 — `MetricCard.tsx` imports a dnd-kit internal dist path instead of the publicly exported type
- **Status:** CONFIRMED
- **Lens:** N (Modernization)
- **Location:** `src/components/MetricCard.tsx:1`
- **Evidence:** `import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';` reaches directly into the package's internal build-output directory. The package's actual public entry point (`node_modules/@dnd-kit/core/dist/index.d.ts`) does not re-export `SyntheticListenerMap` at all — it re-exports the intended public equivalent, `DraggableSyntheticListeners`, from `./hooks`.
- **Problem:** `dist/hooks/utilities` is implementation detail, not part of dnd-kit's public API/semver contract — a minor or patch dnd-kit release is free to relocate or remove that path without a breaking-change notice, which would break `npx tsc --noEmit` (and the CI frontend job) with no warning. This runs against the project's own stated reason for choosing dnd-kit ("modern, accessible... not deprecated/unmaintained").
- **Severity:** Low.
- **Impact:** Silent CI breakage risk on a future dnd-kit patch/minor release.
- **Recommendation:** Replace with `import type { DraggableSyntheticListeners } from '@dnd-kit/core';` and retype `DragHandleProps.listeners` accordingly.
- **Complexity & risk:** Quick win.

#### CQ-014 — 13 frontend packages behind latest (npm outdated)
- **Status:** CONFIRMED
- **Lens:** N (Modernization), I (Supply chain)
- **Location:** `sys-monitor-tauri/package.json`
- **Evidence (real `npm outdated` output):**

  | Package | Current | Wanted | Latest |
  |---|---|---|---|
  | `@tauri-apps/api` | 2.10.1 | 2.11.1 | 2.11.1 |
  | `@tauri-apps/cli` | 2.10.1 | 2.11.4 | 2.11.4 |
  | `@tauri-apps/plugin-store` | 2.4.2 | 2.4.4 | 2.4.4 |
  | `@types/react` | 18.3.28 | 18.3.31 | 19.2.17 |
  | `@types/react-dom` | 18.3.7 | 18.3.7 | 19.2.3 |
  | `@vitejs/plugin-react` | 4.7.0 | 4.7.0 | 6.0.4 |
  | `jsdom` | 25.0.1 | 25.0.1 | 29.1.1 |
  | `lucide-react` | 0.460.0 | 0.460.0 | 1.26.0 |
  | `react` / `react-dom` | 18.3.1 | 18.3.1 | 19.2.8 |
  | `recharts` | 3.8.0 | 3.10.0 | 3.10.0 |
  | `typescript` | 5.9.3 | 5.9.3 | 7.0.2 |
  | `vite` | 6.4.3 | 6.4.3 | 8.1.5 |
- **Problem:** A mix of safe patch/minor bumps (all three `@tauri-apps/*` packages) and deliberate-looking major-version gaps (React 18→19, Vite 6→8).
- **Severity:** Low.
- **Impact:** Low risk for the Tauri patch bumps; the major-version gaps are likely intentional but unverified.
- **Recommendation:** Bump the safe Tauri patch releases opportunistically; treat React 19 and Vite 8 as deliberate, separately-planned upgrades, not quick wins — confirm with the maintainer (§7).
- **Complexity & risk:** Quick win for the Tauri bumps; Large initiative if React 19/Vite 8 migrations are ever undertaken.

#### CQ-015 — Multiple major versions of the same crate coexist in the dependency graph
- **Status:** CONFIRMED
- **Lens:** I (Supply chain)
- **Location:** `cargo tree -d` output
- **Evidence:** `bitflags` 1.3.2 + 2.11.0, `windows` 0.57.0 + 0.58.0 + 0.61.3, `darling` 0.20.11 + 0.21.3 all coexist.
- **Problem:** Normal for a dependency tree this size and not independently fixable by this project's own `Cargo.toml` (all transitively forced by `tauri`'s own dependency choices).
- **Severity:** Low.
- **Impact:** Inflates compile time/binary size somewhat.
- **Recommendation:** No action — informational; would resolve naturally as upstream `tauri` consolidates its own dependency versions over time.
- **Complexity & risk:** N/A — not actionable by this project.

---

### 4.6 Performance & Resources

#### PERF-001 — GPU vendor map rebuilds via 2 synchronous WMI queries on every poll, up to 4x/second, for data that essentially never changes at runtime
- **Status:** CONFIRMED
- **Lens:** C (Performance)
- **Location:** `src-tauri/src/collector/gpu.rs:99-168` (`build_gpu_vendor_map`), called from `:209-212` inside `query_gpu_utilization_pdh`, which is itself called from `collector/mod.rs:188-189` (full-tick path) and `sensor.rs:70` (`GpuSensorProvider::poll()`, 250ms cadence)
- **Evidence:** `build_gpu_vendor_map` performs two `wmi_con.raw_query(...)` calls (LUID enumeration via `Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine`, plus caption list via `Win32_VideoController`) every single time it's invoked. Since `query_gpu_utilization_pdh` runs on both the 1Hz full-poll path and the 250ms `GpuSensorProvider` path, these two WMI queries execute up to 4 times per second, continuously, for the app's entire lifetime.
- **Problem:** GPU hardware/vendor mapping (which LUID maps to which caption) essentially never changes while the app runs — it would only change on a driver reload or GPU hot-plug, both rare events. Re-fetching it from WMI (a relatively expensive COM RPC round-trip) at up to 4Hz is avoidable, sustained overhead.
- **Severity:** Medium.
- **Impact:** Continuous unnecessary WMI/COM traffic for the app's entire runtime; the cost scales with poll frequency, not with any actual change in the underlying data.
- **Likelihood:** Certain — this is the code path's designed behavior, not a rare edge case.
- **Root cause:** No caching layer between the vendor-map consumer (`query_gpu_utilization_pdh`) and the WMI query functions; the map is treated as if it must be re-derived every poll.
- **Recommendation:** Cache the vendor map (e.g. rebuild only on full ticks, or only when the LUID set actually changes / on a coarse TTL) instead of rebuilding it on every poll.
- **Complexity & risk:** Medium — needs a cache-invalidation strategy (at minimum, rebuild when the LUID set observed in PDH data changes).

#### PERF-002 — `historyMinMax()` recomputes a full min/max scan on every render, with no memoization
- **Status:** CONFIRMED
- **Lens:** C (Performance)
- **Location:** `src/App.tsx:275-280` (network card), `src/components/MetricCard.tsx:111` (list view)
- **Evidence:** `historyMinMax()` does two full array `.reduce()` passes (min, then max) with no memoization, called directly inside `renderCard()` and `MetricCard`'s list-view branch — i.e. on every single render of every card that needs it.
- **Problem:** Recomputed from scratch every render instead of incrementally or memoized on the array reference/length, even though only the newest data point actually changes between renders.
- **Severity:** Medium.
- **Impact:** Directly compounded by COR-001: since the app currently re-renders on every 250ms `metrics-update` event instead of the intended 1/sec, this cost is already running at roughly 4x the designed rate.
- **Likelihood:** Certain, on every render, for every card using this pattern.
- **Root cause:** No memoization layer; two full-array traversals (min and max separately) where one pass would suffice.
- **Recommendation:** Memoize on array reference/length, or maintain a running min/max incrementally. Independently, fixing COR-001 also naturally divides this cost by ~4 — re-measure after that fix lands before further optimizing here.
- **Complexity & risk:** Quick-to-Medium — `useMemo` wrapping is a small, localized change.

#### PERF-003 — `appendToHistory`'s O(n) slice at capacity, amplified 4x by the COR-001 emission bug
- **Status:** CONFIRMED
- **Lens:** C (Performance)
- **Location:** `src/hooks/useMetrics.ts:77-84`
- **Evidence:** `arr.slice(-(maxLen-1))` when at capacity is an O(n) copy (n up to 3600), invoked once per history field (cpu/mem/net×2/timestamps/per-disk/per-GPU) on every incoming event.
- **Problem:** Already running at 4x the intended rate per COR-001, roughly 24-36k element copies/sec sustained once buffers saturate.
- **Severity:** Low — not independently alarming for a modern JS engine at this scale, but a real, avoidable, compounding cost tied to the same root cause as COR-001 and PERF-002.
- **Impact:** Modest sustained CPU cost on the main JS thread.
- **Recommendation:** Fixing COR-001 (gating appends to 1/sec) resolves this as a side effect; no separate fix needed if COR-001 is addressed.
- **Complexity & risk:** N/A — resolved as a side effect of COR-001, not independently actionable.

#### PERF-004 — `build_snapshot`/`build_history_payload` rebuild GPU/disk vectors from scratch every tick
- **Status:** CONFIRMED
- **Lens:** C (Performance)
- **Location:** `src-tauri/src/main.rs` (`build_snapshot`, `build_history_payload`)
- **Evidence:** Both rebuild `Vec<DiskSnapshot>`/`Vec<GpuSnapshot>` from scratch on every tick (currently every 250ms per COR-001, intended 1/sec).
- **Problem:** For typical disk/GPU counts (1-4 each) this is trivially cheap in isolation.
- **Severity:** Low — flagged only because it's one more thing riding on the same over-emission bug; not independently actionable.
- **Impact:** Negligible on its own.
- **Recommendation:** No standalone action; resolved as a side effect of COR-001.
- **Complexity & risk:** N/A.

---

### 4.7 Testing & Validation

#### TEST-001 — The `tick.is_multiple_of(4)` gating logic has zero test coverage
- **Status:** CONFIRMED
- **Lens:** H (Testing)
- **Location:** `src-tauri/src/main.rs:569, 574`
- **Evidence:** The critical cadence invariant ("every 4th tick is a full poll that commits history; the other 3 ticks run the sensor registry only") is implemented as inline branches (`if tick.is_multiple_of(4) { collector::poll(...) } else { None }` at line 569 and the inverted `if !tick.is_multiple_of(4)` at line 574) directly inside the closure passed to `std::panic::catch_unwind` inside `fn main()`'s infinite loop. `fn main()` is never invoked by any test, and this branching logic is not extracted into a free function, so no test in the repo exercises it. The nearest coverage is `test_history_length_invariant_after_simulated_ticks` in `collector/mod.rs` (line 482), but that test manually calls `commit_cpu` then `commit_cpu_scalar` three times by hand — it verifies the *downstream effect* of the scalar/full split, not that `tick.is_multiple_of(4)` (or the inverted condition on line 574, which could independently be typo'd to match the same ticks as line 569, or off-by-one against a 4-tick period) actually selects the right ticks.
- **Problem:** A regression like changing 574 to also read `tick.is_multiple_of(4)` (so both raw and reg_raw run on the full tick, and registry commits get silently skipped on 3-of-4 ticks) would not be caught by any existing test. This is precisely the class of gap that let COR-001 exist undetected.
- **Severity:** Medium.
- **Impact:** A silent regression in the tick-cadence branch (e.g. an accidental sign flip, `% 4` vs `% 5`, or the two conditions falling out of sync with each other) would degrade live-snapshot freshness (250ms sensor updates) or double up / skip history commits, and no CI test would fail — it would only be caught by a human staring at a running chart.
- **Root cause:** The tick-cadence decision was never extracted into a small pure function (e.g. `fn is_full_tick(tick: u32) -> bool`) that could be unit tested in isolation from the un-testable `fn main()` body.
- **Recommendation:** Extract `tick.is_multiple_of(4)` into a named pure function and add tests asserting the full-tick/registry-tick split over a few periods (e.g. ticks 0..8 map to full,reg,reg,reg,full,reg,reg,reg).
- **Complexity & risk:** Quick win — pure extraction plus a handful of tests. Should land together with the COR-001 fix.

#### TEST-002 — `SensorRegistry.poll_all`/`commit_all` has zero tests
- **Status:** CONFIRMED
- **Lens:** H (Testing)
- **Location:** `src-tauri/src/sensor.rs` (whole file)
- **Evidence:** `sensor.rs` has no `#[cfg(test)] mod tests` at all (confirmed by grep — zero `#[test]` matches in the file). `poll_all` (line 157) decides per-provider whether to poll based on `now.duration_since(entry.last_polled) >= entry.provider.poll_interval()`, and `commit_all` (line 176) zips providers with their raw polls and calls `entry.provider.commit(...)` only when `Some`. This is the exact code path the tick loop calls for the 3-of-4 non-full ticks, yet none of its interval-gating, zip-alignment, or `None`-skip behavior is unit tested.
- **Problem:** A bug in the zip/index alignment between `self.entries` and `raw_polls` (e.g. after registering the GPU provider only when GPUs exist) would silently commit the wrong provider's data to the wrong slot, with no test to catch it.
- **Severity:** Medium.
- **Impact:** Same class of silent-regression risk as TEST-001, in the sibling code path.
- **Root cause:** `SensorRegistry` was added without accompanying unit tests, unlike `collector/mod.rs` which has a decent test module for `push_history`/`commit_*`.
- **Recommendation:** Add tests for `poll_all`'s interval gating (provider not due yet returns `None`) and `commit_all`'s correct pairing of `entries[i]` with `raw_polls[i]`, using a fake `SensorProvider`.
- **Complexity & risk:** Quick win.

#### TEST-003 — `build_gpu_vendor_map` has no test and its pure logic is not separated from live-WMI I/O
- **Status:** CONFIRMED
- **Lens:** H (Testing)
- **Location:** `src-tauri/src/collector/gpu.rs:99-168`
- **Evidence:** `build_gpu_vendor_map` (the "trickiest function" per its own doc comment) does two `wmi_con.raw_query(...)` calls inline with the pure logic that follows: dedup+sort LUIDs, positional match of sorted LUIDs to `Win32_VideoController` rows with last-caption fallback for LUIDs beyond the `VideoController` list. None of `gpu.rs`'s 27 tests (all named `test_extract_luid_*`, `test_classify_luid_*`, `test_is_nvidia_gpu_*`, `test_strip_brand_prefix_*`) touch `build_gpu_vendor_map` or its positional-merge algorithm.
- **Problem:** Because the WMI calls are inlined rather than the function taking `Vec<String>` LUID names / `Vec<String>` captions as parameters, this logic cannot be tested without a live Windows WMI connection.
- **Severity:** Medium.
- **Impact:** The positional-index merge is the mechanism that assigns vendor captions to GPUs for classification (feeds `classify_luid`). A bug here (e.g. off-by-one in the fallback-to-last-caption branch when `extra_luids` pushes the LUID count above `VideoController` count) would silently misclassify or mislabel a GPU, and would only surface on a specific multi-GPU hardware configuration in production, not in CI.
- **Root cause:** The function signature couples WMI I/O and pure merge logic together, so there is no pure subset extracted for unit testing, unlike `extract_luid_from_name`/`classify_luid`/`is_nvidia_gpu`/`strip_brand_prefix` which are already pure and well-tested.
- **Recommendation:** Extract a pure function, e.g. `fn merge_luid_captions(luid_names: Vec<String>, extra_luids: impl Iterator<Item=String>, captions: Vec<String>) -> HashMap<String,String>`, containing the merge logic, and have `build_gpu_vendor_map` call it after the two `raw_query` calls. Then unit-test the merge function directly (equal counts, extra-LUID-beyond-VideoController-count fallback, empty captions list, duplicate LUIDs).
- **Complexity & risk:** Medium — an extraction refactor plus new tests.

#### TEST-004 — `MetricCard.tsx` hand-rolls its own stride-sampling loop instead of calling `utils.ts`'s `downsample()` — zero coverage on the code that actually renders charts
- **Status:** CONFIRMED
- **Lens:** H (Testing)
- **Location:** `src/components/MetricCard.tsx:78-93`
- **Evidence:** `utils.test.ts` thoroughly tests `downsample()` from `utils.ts` (5 cases including empty array, under-limit passthrough, 600→300 stride, and exact-remainder-dedup cases). But `MetricCard.tsx` does NOT call `downsample()` anywhere (confirmed by grep — `downsample` only appears in `utils.ts` and `utils.test.ts`, never in `MetricCard.tsx`). Instead `MetricCard.tsx` re-implements equivalent-but-distinct stride logic inline: `stride = Math.ceil(len / MAX_CHART_POINTS)`, a manual `for` loop pushing `{t, v, v2}` objects, and a last-point dedup check by comparing the **timestamp** of the last pushed point rather than `downsample()`'s dedup-by-value check.
- **Problem:** This divergence exists because `MetricCard` needs to sample two parallel arrays (history + secondaryHistory) plus a timestamps array in lockstep, which `downsample()`'s single-array signature can't do — a legitimate reason not to reuse it, but it means the tested function and the function actually driving the live chart are two different implementations with different dedup semantics.
- **Severity:** Medium.
- **Impact:** The 5 passing `downsample()` tests give false confidence that chart downsampling is covered; they exercise none of `MetricCard`'s actual code path (its own stride/dedup logic, its NaN-clamping via `addPoint`, or its interaction with the secondary series). A regression introduced only in `MetricCard.tsx`'s loop (e.g. an off-by-one making the last real-time point drop when `len` is an exact multiple of stride, or a timestamp-collision edge case) would not be caught by any of the 41 passing frontend tests.
- **Root cause:** `downsample()`'s single-`number[]`-in/`number[]`-out signature cannot express `MetricCard`'s need to keep `v`, `v2`, and `t` aligned per index, so a parallel implementation was hand-rolled instead of generalizing `downsample()`.
- **Recommendation:** Either generalize `downsample()` to operate on indices (e.g. `downsampleIndices(len, maxPoints): number[]`) and have both `utils.test.ts` and `MetricCard.tsx` share it, or add a dedicated test file exercising `MetricCard`'s actual stride loop (extractable as a pure helper) for `len` exactly at `MAX_CHART_POINTS`, `len = MAX_CHART_POINTS+1`, and `len` requiring the last-point dedup branch.
- **Complexity & risk:** Medium.

#### TEST-005 — Zero component-level tests exist anywhere in the frontend
- **Status:** CONFIRMED
- **Lens:** H (Testing)
- **Location:** `src/App.tsx` (whole file)
- **Evidence:** All 41 frontend tests live in exactly 3 files — `utils.test.ts`, `hooks/useSettings.test.ts`, `hooks/useMetrics.test.ts` — and `package.json`'s devDependencies list only `vitest`/`jsdom`/`@vitejs/plugin-react` with no `@testing-library/react` or `@testing-library/jest-dom`, so there is no infrastructure in the repo to even mount a component. `App.tsx` contains non-trivial, untested state logic: the first-launch default-card-order computation and merge-in-new-disks/GPUs effect (lines 112-137), `handleMetricToggle` (141-146), `handleDragEnd`'s `arrayMove` call (169-176), and `getCardLabel`'s id-to-label formatting (148-167) — none of which are exercised by any test.
- **Problem:** The card-order-merge logic in the `useEffect` is exactly the kind of logic prone to subtle bugs (e.g. a GPU that disappears and reappears across reboots with a new LUID-derived id would never be pruned since the merge only appends, never removes) and is the sole persistence path fed into `useSettings` — a regression here silently corrupts what cards a real user sees on next launch, with zero test signal.
- **Severity:** Low.
- **Impact:** Untested, append-only merge logic that could accumulate stale card IDs indefinitely.
- **Root cause:** The merge/reorder logic was written inline inside a component's `useEffect`/handlers rather than extracted to pure, importable functions, and no component-testing library was ever added to devDependencies.
- **Recommendation:** At minimum, extract the default-order/merge logic into a pure function (e.g. `mergeCardOrder(current: string[] | null, defaultIds: string[]): string[]`) and unit test it the same way `utils.ts` functions are tested, without needing a rendering library.
- **Complexity & risk:** Quick-to-Medium.

#### TEST-006 — The two "panic recovery" tests exercise standalone `catch_unwind` semantics, not the real tick-loop panic path
- **Status:** CONFIRMED
- **Lens:** H (Testing)
- **Location:** `src-tauri/src/main.rs:372, 380`
- **Evidence:** `test_catch_unwind_catches_synthetic_panic` (line 372) and `test_catch_unwind_error_payload_emitted` (line 380) each construct their own standalone `panic::catch_unwind(AssertUnwindSafe(|| panic!(...)))` closure with a literal panic message, and in the second test, feed the catch result into a locally-defined `emit_error` closure that just sends to an mpsc channel. Neither test calls into, wraps, or shares any code with the real tick loop's `catch_unwind` at line 567, its `app_handle.emit("collector-error", ...)` call at line 604, or the `break` that permanently stops the loop at line 606.
- **Problem:** They demonstrate that Rust's `catch_unwind` catches a panic and that a closure can be invoked on `Err` — general language facts already guaranteed by the standard library — not that this app's `collector-error` path fires correctly for a real panic inside `collector::poll`/`registry.poll_all`/`commit_*`/`build_snapshot`.
- **Severity:** Low.
- **Impact:** If a future change to the real tick loop moved the emit call outside the `catch_unwind`'s `Err` arm, changed the emitted event name/payload, or removed the `break` (accidentally allowing the loop to keep running post-panic, silently violating the documented "no restart" invariant), these two tests would keep passing — they exercise disconnected synthetic code, so they add test count without adding coverage of the invariant they're named after.
- **Root cause:** The panic-recovery block is inline in `fn main()` rather than extracted into a testable function taking the emit/break behavior as injectable dependencies, so the tests fell back to re-implementing the pattern in isolation rather than exercising the real path.
- **Recommendation:** Extract the tick-loop body (or at minimum the match on `tick_result` / emit-and-break arm) into a function parameterized over an emit callback, so a test can inject a fake emitter, force an `Err`, and assert both the exact event name/payload emitted AND that the loop-control signal (e.g. a returned bool/enum) indicates "stop."
- **Complexity & risk:** Medium.

---

### 4.8 UI/UX & Accessibility

#### UX-001 — No visible focus indicator anywhere in the app; drag handles are invisible to keyboard focus entirely
- **Status:** CONFIRMED
- **Lens:** L (UI/UX & accessibility)
- **Location:** `src/styles.css:19-23` (`button { outline: none; }`), `:26-33` (`.drag-handle { opacity: 0; }`)
- **Evidence:** `styles.css:19-23` sets `button { outline: none; }` globally, and `TimeRangeSelector.tsx:27` additionally sets `outline: 'none'` inline on its `<select>`. A repo-wide grep for `:focus` across `src/` returns zero matches — there is no `:focus`/`:focus-visible` replacement style anywhere. On top of that, `styles.css:25-36` defines `.drag-handle { opacity: 0; }` shown only `.metric-card:hover .drag-handle { opacity: 1; }` — with no `:focus`/`:focus-within` exception. Every per-card drag handle in `MetricCard.tsx` and the sidebar equivalent in `SortableSidebarCard.tsx` is a dnd-kit-managed `role="button" tabIndex={0}` element (confirmed in `node_modules/@dnd-kit/core/dist/core.esm.js`), so it IS in the Tab order, but it renders at opacity 0 until a mouse hovers the parent card — a state a keyboard-only user never triggers.
- **Problem:** Global button-outline reset with no focus-visible replacement, combined with a hover-only opacity toggle on the drag handle that has no keyboard/focus equivalent.
- **Severity:** High.
- **Impact:** A sighted keyboard-only user tabbing through the toolbar (sidebar toggle, view-mode buttons, metrics selector, time-range select) sees no indication of where focus currently is at all. Tabbing onto any drag handle lands on a fully invisible, zero-opacity element — worse than merely missing a ring, the entire control is undiscoverable. This is a systemic WCAG 2.4.7 (Focus Visible, AA) violation, not a one-off nit.
- **Likelihood:** Certain — verified by reading the full `styles.css` (52 lines) and grepping `:focus` across `src/` with zero hits.
- **Root cause:** Global outline reset with no replacement; hover-only reveal pattern with no keyboard-equivalent trigger.
- **Recommendation:** Add a `:focus-visible` style (e.g. outline or box-shadow) to buttons/select, and add `.drag-handle:focus-visible { opacity: 1; }` (or drop the opacity-0 default in favor of a lower-contrast-but-always-visible resting state).
- **Complexity & risk:** Quick win — pure CSS addition, zero logic risk. Pair with UX-002/UX-003 for a complete fix.

#### UX-002 — Keyboard drag-reordering is wired but practically unusable: no `sortableKeyboardCoordinates` configured
- **Status:** CONFIRMED
- **Lens:** L (UI/UX & accessibility)
- **Location:** `src/App.tsx:470`, `src/components/HardwareSidebar.tsx:289`
- **Evidence:** Both `<DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>` calls pass no `sensors` prop, so dnd-kit falls back to `defaultSensors = [PointerSensor, KeyboardSensor]` with the default `coordinateGetter`. Neither component imports or wires `sortableKeyboardCoordinates` from `@dnd-kit/sortable` (grep for that symbol across `src/` returns no matches, though it is exported from `@dnd-kit/sortable`). The fallback `defaultKeyboardCoordinateGetter` just nudges the drag ghost's x/y by a flat 25px per arrow-key press with no awareness of sibling card rects.
- **Problem:** Missing `useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))` wiring that dnd-kit's own docs recommend for sortable lists/grids.
- **Severity:** Medium.
- **Impact:** Cards in default/tile view are ~150-220px tall; `closestCenter` only swaps once the ghost's center crosses roughly half that height, so a keyboard user must press an arrow key many times to move one slot, and in the 2-column tile grid (`rectSortingStrategy`) a 25px horizontal nudge is unlikely to reliably cross into the adjacent column. Reordering is technically keyboard-operable but not usable for its purpose.
- **Likelihood:** High — this is the standard dnd-kit accessibility footgun; confirmed by reading the actual coordinate-getter math.
- **Root cause:** dnd-kit's recommended keyboard-sortable wiring was never added when the drag-reorder feature was built.
- **Recommendation:** Pass `useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))` into both `DndContext`s.
- **Complexity & risk:** Quick win.

#### UX-003 — Drag-handle accessible name is a Braille glyph, not the intended "Drag to reorder"
- **Status:** CONFIRMED
- **Lens:** L (UI/UX & accessibility)
- **Location:** `src/components/MetricCard.tsx:98-108`
- **Evidence:** The drag handle renders as `<div className="drag-handle" {...attributes} {...listeners} title="Drag to reorder">⠿</div>`. dnd-kit's `useDraggable` assigns `role="button"` by default. Per the ARIA accessible-name computation, a `role=button` element's name is computed from its text content before falling back to the `title` attribute — so the announced name is derived from the literal '⠿' character, not the helpful title string. Screen readers have no consistent verbalization for that glyph. By contrast, `SortableSidebarCard.tsx:26-42` wraps a `<GripVertical>` SVG icon with no text content, so its `title="Drag to reorder"` correctly does win as the fallback accessible name there — this bug is specific to the main-card handle.
- **Problem:** Using a literal visible text glyph as handle content while relying on `title` for the accessible name; content-based naming takes precedence over title per the ARIA accname algorithm.
- **Severity:** Medium.
- **Impact:** Screen-reader users hear an unhelpful or silent name for the primary card drag handle instead of "Drag to reorder," making the control's purpose unclear via assistive technology.
- **Likelihood:** High — confirmed against the actual accname precedence rules and the exact JSX.
- **Root cause:** Using a literal visible text glyph as handle content while relying on `title` for the accessible name.
- **Recommendation:** Add an explicit `aria-label="Drag to reorder"` on the handle div (or `aria-hidden` the glyph span and label the wrapper), matching what already works correctly in `SortableSidebarCard.tsx`.
- **Complexity & risk:** Quick win.

#### UX-004 — `#666` muted text fails WCAG AA contrast on the two loading/empty-state messages
- **Status:** CONFIRMED
- **Lens:** L (UI/UX & accessibility)
- **Location:** `src/App.tsx:458-468`, `src/components/HardwareSidebar.tsx:284-287`
- **Evidence:** `App.tsx:458-468` renders "Collecting metrics…" in `color: '#666'`, `fontSize: 14` on the page background `#141414`. `HardwareSidebar.tsx:284-287` renders "Detecting hardware…" in `color: '#666', fontSize: 12` on the sidebar background `#0f0f0f`. Computing WCAG relative luminance: L(#666)=0.1329, L(#141414)=0.0070, L(#0f0f0f)=0.0048. Contrast = (L_light+0.05)/(L_dark+0.05): against #141414 ≈ 3.2:1, against #0f0f0f ≈ 3.3:1. Both are below the 4.5:1 AA minimum for normal-size text (14px/12px, neither qualifies as WCAG "large text"). (For comparison, `#888` on `#141414` ≈5.2:1 passes comfortably, but `#888` on the lighter `#1e1e1e` card background is only ≈4.7:1 — passes AA with very little margin.)
- **Problem:** Gray value `#666` was chosen without checking contrast against the near-black app backgrounds.
- **Severity:** Medium.
- **Impact:** The two messages a user is most likely to stare at while waiting for data (startup loading state, hardware detection) are the least readable text in the app for low-vision users.
- **Likelihood:** Certain — verified via direct WCAG relative-luminance/contrast-ratio computation from the exact hex values in the file.
- **Recommendation:** Lighten these two specific loading/empty-state strings to something in the `#888`-`#999` range (or higher) to clear 4.5:1 against their respective backgrounds.
- **Complexity & risk:** Quick win — CSS value change only.

#### UX-005 — `MetricCardSelector` dropdown has no Escape-to-close and no ARIA disclosure semantics
- **Status:** CONFIRMED
- **Lens:** L (UI/UX & accessibility)
- **Location:** `src/components/MetricCardSelector.tsx:18-28`
- **Evidence:** The open panel closes only via a `mousedown` listener on `document` checking `ref.current.contains(e.target)`. There is no `keydown`/Escape handling in the component, and a repo-wide grep for "Escape" and for any `aria-` attribute across `src/` returns zero matches. The trigger `<button>` has no `aria-haspopup`/`aria-expanded`.
- **Problem:** Click-outside-only dismissal pattern with no keyboard equivalent and no ARIA disclosure-widget attributes.
- **Severity:** Medium.
- **Impact:** A keyboard-only user who tabs into the open checkbox list has no keyboard-only way to dismiss the panel except tabbing all the way back to the trigger button and re-toggling it; tabbing forward past the last checkbox leaves the panel open (visually overlapping cards below) while focus has already moved to `ViewModeSelector`. Screen-reader users get no indication from the trigger button that it opens a disclosure or whether it's currently expanded.
- **Likelihood:** High — confirmed by reading the full component and grepping for Escape/aria across the whole `src` tree.
- **Recommendation:** Add an Escape-key handler to close the panel and return focus to the trigger, and add `aria-haspopup="true"`/`aria-expanded={open}` to the trigger button.
- **Complexity & risk:** Quick win.

#### UX-006 — Hiding all cards leaves a blank canvas with no explanatory empty state
- **Status:** CONFIRMED
- **Lens:** L (UI/UX & accessibility)
- **Location:** `src/App.tsx:371, 458`
- **Evidence:** The main render branch is `!metrics || cardOrder.length === 0 ? <Collecting metrics…> : <DndContext>...<div style={containerStyle}>{visibleCardOrder.map(...)}</div>`. `visibleCardOrder` filters out hidden and not-present cards, but the ternary only checks the *unfiltered* `cardOrder.length`, not `visibleCardOrder.length`. If a user hides every card via `MetricCardSelector`, `cardOrder.length` is still > 0, so the `DndContext` branch renders with an empty `visibleCardOrder` — the grid/flex container renders with zero children, i.e. a blank area below the toolbar, with no message explaining why.
- **Problem:** The empty-state check gates on `cardOrder` (all known cards) rather than `visibleCardOrder` (currently visible cards).
- **Severity:** Low.
- **Impact:** Not a true dead-end — the "Metrics (0/N) ▾" toggle button remains rendered (its condition only requires `cardOrder.length > 0`, not `visibleCardOrder.length > 0`), so the user can still reopen the selector and re-enable cards. But the blank canvas itself gives no on-screen hint that this is the "everything hidden" state versus a bug/loading stall, which is a real moment of user confusion.
- **Likelihood:** High — confirmed directly from the render logic and the two relevant conditionals.
- **Recommendation:** When `metrics && cardOrder.length > 0 && visibleCardOrder.length === 0`, render a short "All metrics hidden — use the Metrics selector to show cards" message instead of an empty container.
- **Complexity & risk:** Quick win.

---

### 4.9 Documentation, Build & CI/CD

#### DOC-002 — Every locally-run quality gate (docs + git hook) omits `cargo audit`/`npm audit`, the exact CI check that's currently failing
- **Status:** CONFIRMED
- **Lens:** J (CI/CD), M (Documentation)
- **Location:** `.husky/pre-push`, `.cursorrules:28-33` ("CI Readiness Gate"), `.cursor/commands/check.md:1-23` ("Run Full Quality Gate")
- **Evidence:** CI's `rust-lint` job runs `cargo fmt -- --check`, `cargo clippy -- -D warnings`, AND `cargo audit` (`rust.yml:74-81`), and the `frontend` job runs `npm audit --audit-level=high` (`rust.yml:109`). But none of the three places a contributor is told to look before pushing include the audit steps: (1) `.husky/pre-push` runs `cargo build`/`test`/`fmt`/`clippy` and `tsc`/`npm test`, then prints "=== pre-push: all checks passed ===" (line 43) — claiming full CI parity ("running full CI checks", line 2) while never running `cargo audit` or `npm audit`; (2) `.cursorrules`'s "CI Readiness Gate" (lines 28-33) lists only `cargo build --verbose`, `cargo test --verbose`, `cargo fmt -- --check`, `cargo clippy --verbose -- -D warnings` as the required local commands, no audit; (3) `.cursor/commands/check.md` ("Run Full Quality Gate", lines 1-23) lists the same four checks plus tsc/npm test, again no audit.
- **Problem:** Given `cargo audit` is independently confirmed to currently fail with 3 real RUSTSEC vulnerabilities and no `audit.toml` allowlist anywhere in the repo, a contributor who does everything the docs/hooks tell them to do will see "all checks passed" locally and then have CI fail on push for a reason none of the local tooling ever surfaced.
- **Severity:** High.
- **Impact:** Contributors get a false all-clear from the pre-push hook and from the documented CI Readiness Gate, then hit an unexplained CI failure (cargo audit) that none of the local guidance prepared them for or told them how to investigate/allowlist.
- **Likelihood:** Certain to recur the next time a new transitive vulnerability appears, since nothing locally would catch it.
- **Root cause:** Local gates were written before `cargo audit`/`npm audit` were added to CI (per git log, `f6c7a35 "chore: update frontend dependencies and add audit step"` and `3f96ac7`) and never backfilled.
- **Recommendation:** Add `cargo audit` (and `npm audit --audit-level=high` if applicable) to `.husky/pre-push` and to the `.cursorrules` CI Readiness Gate / `check.md` command list so local gates actually match CI, or explicitly document that audit is CI-only and intentionally excluded locally (e.g. because it requires installing `cargo-audit`).
- **Complexity & risk:** Quick win — doc/script edits only.

#### DOC-003 — `.cursorrules` and `check.md` still say "45 tests expected"; **CLAUDE.md itself was already corrected during this audit session**
- **Status:** CONFIRMED
- **Lens:** M (Documentation)
- **Location:** `.cursorrules:65-66`, `.cursor/commands/check.md:20-21`
- **Evidence:** Both still say "Rust: 45 tests expected" / "cargo test: 45 tests pass" — actually 70. **Note:** during this audit session, `CLAUDE.md` was independently corrected by the user to say 70 tests (and its previously-stale bundle-id line was also corrected to `com.quantdale.systemmonitor`, matching `tauri.conf.json`) — these two files are now the only remaining stale copies of the test-count claim.
- **Problem:** Growth-only drift (not a regression), but still inaccurate documentation.
- **Severity:** Low.
- **Impact:** Minor confusion for anyone consulting these two files specifically; low since CLAUDE.md (the primary reference per its own stated authority) is already correct.
- **Recommendation:** Update the two remaining files to 70/41.
- **Complexity & risk:** Quick win.

#### DOC-004 — `.cursorrules`' own "CI" section describes a stale single-job pipeline with a build step that no longer exists
- **Status:** CONFIRMED
- **Lens:** M (Documentation)
- **Location:** `.cursorrules:292-298`
- **Evidence:** `.cursorrules` Section 6 "Testing Strategy > CI" states: "GitHub Actions (`.github/workflows/rust.yml`) on `windows-latest`: 1. `cargo build --verbose` 2. `cargo test --verbose` 3. `cargo fmt -- --check` 4. `cargo clippy --verbose -- -D warnings`." This is stale on every count: the real workflow is 3 parallel jobs, not 1 (rust-test on windows-latest, rust-lint on windows-latest, frontend on ubuntu-latest); `rust-test` never runs a separate `cargo build --verbose` step (`rust.yml` explicitly comments "cargo test compiles implicitly — no separate build step needed" and only runs `cargo test --verbose`); and this section omits `cargo audit` and the entire frontend job (`npm ci`, `npm audit`, `npx tsc --noEmit`, `npm test -- --run`) entirely. Notably, CLAUDE.md's own top-of-file "where this file and .cursorrules disagree" list does NOT include this section, so a reader trusting CLAUDE.md's framing that it has enumerated all the drift would still be misled by this untouched section further down in `.cursorrules`.
- **Problem:** A contributor reading `.cursorrules`' dedicated CI description (as opposed to the higher-level table near the top) gets an inaccurate picture of what actually gates a merge — missing both the audit check and the entire cross-platform frontend job.
- **Severity:** Medium.
- **Impact:** Misleads a specific, easy-to-reach section of the project's most detailed doc.
- **Recommendation:** Update `.cursorrules` lines 292-298 to describe the actual 3-job matrix (rust-test, rust-lint incl. audit, frontend incl. npm audit/tsc/vitest), matching what CLAUDE.md already states correctly.
- **Complexity & risk:** Quick win.

#### DOC-005 — README.md has multiple concrete stale onboarding facts
- **Status:** CONFIRMED
- **Lens:** M (Documentation)
- **Location:** `sys-monitor-tauri/README.md:9, 60, 105-112`
- **Evidence:** Three separate, independently-verifiable inaccuracies: (1) Line 60 says the frontend-only dev command opens "`http://localhost:5173`" — but `vite.config.ts` pins `port: 5180` with `strictPort: true`, so the dev server never uses 5173 and will hard-fail to start if 5180 is already in use rather than falling back. (2) The "Project layout" table (lines 105-112) lists `src-tauri/src/` as containing flat files `main.rs`, `collector.rs`, `state.rs` — but the actual tree has `collector/` as a package (`mod.rs`, `cpu.rs`, `disk.rs`, `gpu.rs`, `nvidia.rs`) plus `hardware.rs`, `pdh.rs`, and `sensor.rs`, none of which the README mentions. (3) Line 9 lists "Node.js (v16+)" as a prerequisite, but the installed `vitest` (^4.1.10) declares `engines.node: "^20.0.0 || ^22.0.0 || >=24.0.0"` and `vite` (^6.4.3) declares `engines.node: "^18.0.0 || ^20.0.0 || >=22.0.0"` — Node 16 satisfies neither, and CI itself pins Node 20.
- **Problem:** A new contributor following the README verbatim looks for the dev server on the wrong port, gets confused hunting for a nonexistent `collector.rs`/flat file layout, and — if they actually provision the stated Node 16 minimum — cannot even run `npm test` or `npm run dev` due to unmet engine requirements in vite/vitest.
- **Severity:** Medium.
- **Impact:** First-read onboarding friction for any new contributor.
- **Recommendation:** Update README.md: fix the quoted dev URL to port 5180, update the project-layout table to reflect the `collector/` package plus `hardware.rs`/`pdh.rs`/`sensor.rs`, and bump the stated Node.js prerequisite to v20+ to match the actual toolchain and CI.
- **Complexity & risk:** Quick win.

#### DOC-006 — `rust-test` and `rust-lint` jobs use disjoint cache keys with no cross-job fallback, redundantly recompiling on Windows twice per run
- **Status:** CONFIRMED
- **Lens:** J (CI/CD)
- **Location:** `.github/workflows/rust.yml:41-43` vs. `:70-72`
- **Evidence:** Both `rust-test` and `rust-lint` run on `windows-latest`, cache the identical paths (`~/.cargo/registry`, `~/.cargo/git`, `sys-monitor-tauri/src-tauri/target`), but use entirely separate key namespaces — `${{ runner.os }}-cargo-test-...` with restore-keys `${{ runner.os }}-cargo-test-` vs. `${{ runner.os }}-cargo-lint-...` with restore-keys `${{ runner.os }}-cargo-lint-`. Because the restore-keys prefix never crosses between the two jobs, neither job's cache can ever seed the other's. Additionally, `rust-lint`'s Audit step runs `cargo install cargo-audit --quiet` every single run with no caching of the resulting binary.
- **Problem:** On any cache miss (new Cargo.lock, first run on a branch, cache eviction) both `windows-latest` jobs independently download and compile the entire dependency graph from scratch in parallel.
- **Severity:** Medium.
- **Impact:** Doubles Windows-runner compute/billing minutes for the Rust portion of every push and PR (Windows runners are billed at a 2x multiplier on GitHub-hosted runners), and adds an uncached from-source `cargo-audit` build to every `rust-lint` run.
- **Recommendation:** Share a common `restore-keys` prefix (e.g. `${{ runner.os }}-cargo-`) so either job's cache can seed the other's registry/git downloads. Cache `~/.cargo/bin/cargo-audit` (or use a prebuilt-binary install action) to avoid rebuilding `cargo-audit` from source every run.
- **Complexity & risk:** Quick win — CI YAML edit only.

#### DOC-007 — No CI job or workflow ever builds the actual shippable artifact
- **Status:** CONFIRMED
- **Lens:** J (CI/CD)
- **Location:** `.github/workflows/rust.yml` (whole file)
- **Evidence:** The repo has exactly one workflow file. Its three jobs run `cargo test --verbose`, `fmt`/`clippy`/`audit`, and `npx tsc --noEmit` + `npm test -- --run` — but the frontend job never runs `npm run build` (the actual `tsc && vite build` production bundle command), and no job anywhere runs `npm run tauri build` (the real MSI/NSIS bundling path that exercises `tauri.conf.json`'s bundle config, icons, and `build.rs`). There is no separate release/publish workflow at all.
- **Problem:** A regression that only manifests in an actual production build — e.g. a Vite build-time-only error, a broken icon path in `tauri.conf.json`'s `bundle.icon` list, or a `build.rs`/tauri-build failure — can pass every CI check and merge to `main` undetected, only to be discovered when someone runs `npm run tauri build` locally to cut a release.
- **Severity:** Medium.
- **Impact:** Release-time surprises with no CI safety net for the production build path.
- **Recommendation:** Add a build-verification step (at minimum `npm run build` to prove the Vite production bundle compiles; ideally a non-publishing `tauri build`/`tauri-action` job, even without publishing, to catch bundling regressions before they reach main).
- **Complexity & risk:** Medium — a new CI job, low risk to add since it's additive.

#### DOC-008 — `.cursorrules` describes `App.css` as legacy/unused — the file has been deleted from the repo entirely
- **Status:** CONFIRMED
- **Lens:** M (Documentation)
- **Location:** `.cursorrules` (App.css reference)
- **Evidence:** `.cursorrules` describes `App.css` as "legacy (unused except logo hover)" — confirmed via `grep -rn "App.css" src/` (zero matches) and `ls src/App.css` (file does not exist) that the file has been deleted from the repo entirely.
- **Problem:** The reference is now flatly wrong, not merely imprecise.
- **Severity:** Low.
- **Impact:** Minor — a reader looking for the file would be confused it doesn't exist.
- **Recommendation:** Remove the stale reference.
- **Complexity & risk:** Quick win.

---

## 5. Prioritized Backlog

Sorted by impact, grouped by effort.

### Quick wins — do first, low risk, mostly independent of each other
1. **SEC-001** — `cargo update -p crossbeam-epoch -p plist`, re-run full gate, commit `Cargo.lock`. Unblocks CI today.
2. **DOC-002** — add `cargo audit`/`npm audit` to `.husky/pre-push`, `.cursorrules`, `check.md`. Prevents this class of surprise recurring.
3. **ERR-001** — try/catch around the `useSettings` load IIFE.
4. **UX-001** — add `:focus-visible` styles + drag-handle focus exception.
5. **CQ-004** — delete the unnecessary `unsafe impl Send/Sync` on `HistoryStore`.
6. **CQ-006, CQ-007** — delete the two dead-code clusters (`collector::commit()`, `hardware.rs`'s unused `has_*` methods).
7. **CQ-001, CQ-002, CQ-003** — add/fix missing `// SAFETY:` comments (and de-duplicate the two `collect_pdh` copies while touching that code).
8. **DOC-003, DOC-004, DOC-005, DOC-008** — doc corrections (test counts, CI section, README, App.css reference).
9. **UX-003, UX-004, UX-005, UX-006** — small, independent frontend fixes (aria-label, contrast, Escape handling, empty-state message).
10. **CQ-005, CQ-009, CQ-013** — gate NvAPI init behind its consumer's cfg; extract shared `isTauri()`; fix the dnd-kit import path.
11. **ERR-005, ERR-006** — add logging to `read_pdh_counter_array`'s failure paths; surface `get_history()` rejection as a distinct error state.
12. **CQ-014 (Tauri packages only)** — bump `@tauri-apps/api`, `@tauri-apps/cli`, `@tauri-apps/plugin-store` to latest patch/minor.
13. **DOC-006** — share CI cache-key prefixes between `rust-test`/`rust-lint`.

### Medium — multi-file, moderate risk; sequence after the quick wins land
14. **COR-001** — the 4Hz-emission bug. *Highest-impact item in this tier.* Requires an IPC payload change (bump `SCHEMA_VERSION`), touches both `main.rs` and `useMetrics.ts`, and should land together with **TEST-001** (extract+test the tick-cadence gate) so the fix is guarded against regressing a second time.
15. **ARC-007** — fix `cpu_latest`/`gpu_latest` staleness on full ticks; do this alongside COR-001 since both touch the same commit functions.
16. **PERF-001, PERF-002** — cache the GPU vendor map, memoize `historyMinMax`. Do after COR-001 lands (COR-001's fix naturally reduces PERF-002/PERF-003's severity, so re-measure before over-investing here).
17. **ARC-006** — unify the two Nvidia-keyword lists (`hardware.rs` + `gpu.rs`).
18. **ERR-003, ERR-004** — the silent-failure-path cluster (WMI giveup, OnceLock single-shot logging). Do together; same root pattern (no persistent diagnostic signal), same fix shape (a small logging/eventing layer).
19. **ARC-005** — add `settingsVersion` + validation to `useSettings.ts`.
20. **CQ-010, CQ-011, CQ-012** — the three duplication clusters (App.tsx renderCard/label, useMetrics mock-vs-real, disk.rs key resolution).
21. **UX-002** — wire keyboard sensors + `sortableKeyboardCoordinates`.
22. **DOC-007** — production-build verification CI job.
23. **TEST-002, TEST-003, TEST-004, TEST-005, TEST-006** — the remaining test-coverage gaps.
24. **ARC-003** — extend `SensorProvider`/`SensorRegistry` to cover history commits, or correct its doc comment.
25. **ARC-004** — fix nullable-type drift in `types/metrics.ts`.

### Large initiatives — architectural, needs its own plan; sequence last
26. **COR-002 (multi-Nvidia-GPU telemetry keying)** and **ARC-001 (GPU-identity-by-LUID-group)** — both require a real schema change to `RawPoll`/`HistoryStore`/`MetricsSnapshot` to key GPU telemetry by device/LUID instead of a flat scalar/caption-string. Natural to design and land together since they touch the same GPU data model; low urgency (affected hardware population is small) but structurally significant.
27. **ERR-002 / ARC-002 (collector crash logging + supervised restart)** — logging first (Medium effort, do as part of item 18's cluster), then the supervised-restart mechanism itself is a Large initiative: needs careful `CollectorState` re-init semantics (PDH handles must not be needlessly recreated per the existing invariant) and a backoff/cap policy mirroring the existing WMI retry pattern. Do not attempt restart-supervision before the logging fix lands — otherwise a repeatedly-restarting collector becomes just as undiagnosable as the current permanent-stop behavior.
28. **CQ-014 (React 19 / Vite 8)** — only if/when a deliberate major-version migration is planned; not a quick win, confirm intent first (see §7).

---

## 6. Implementation Roadmap & Dependency Graph

**Stage 1 (same day):** SEC-001, DOC-002. These are independent, zero-risk, and unblock CI immediately — do them first regardless of anything else.

**Stage 2 (this week):** The remaining quick-wins list (items 3-13 in §5), in any order — they're mutually independent except where noted (CQ-001 touches the same function `poll()` calls into as TEST-001's extraction — see conflict note below).

**Stage 3 (next 1-2 sprints):** COR-001 + TEST-001 + ARC-007 together (same commit functions, same IPC schema bump — batch into one PR/release). Then PERF-001/PERF-002 (re-measured after COR-001 lands). Then the remaining Medium-tier items in roughly the order listed in §5.

**Stage 4 (planned initiative):** COR-002 + ARC-001 (GPU data-model schema change) as one design/implementation effort. ERR-002's logging half can land in Stage 3; its supervised-restart half is Stage 4, and must not precede the logging half.

**Conflicts/dependencies to resolve explicitly:**
- COR-001's fix bumps `SCHEMA_VERSION`; ARC-004 (nullable-type drift in `types/metrics.ts`) and COR-002/ARC-001 (if scheduled close together) also touch the IPC schema — batch all schema-version-bumping changes into one coordinated release to avoid bumping the version number twice in quick succession.
- PERF-002/PERF-003 should be *re-measured*, not blindly fixed, after COR-001 lands — COR-001's fix already divides their cost by ~4, which may make a standalone fix unnecessary.
- CQ-001 (de-duplicate `collect_pdh`) touches the same function `poll()` calls into as COR-001's cadence-gate extraction (TEST-001) — do them in the same PR to avoid merge conflicts on adjacent lines.
- ERR-002 (logging) must land before ARC-002 (supervised restart) — a restart loop without logging first would make failures just as invisible, only recurring.

---

## 7. Open Questions & Hypotheses

- **COR-002 (multi-Nvidia-GPU scalar bug) and ARC-001 (same-model-GPU merge bug)** are CONFIRMED as code-level defects, but their real-world trigger frequency is unverified — no multi-GPU test hardware was available this session. *Verification:* run the app on a machine with 2+ discrete Nvidia GPUs (or 2 identically-modeled GPUs of any vendor) and confirm both cards show identical/merged readings as predicted.
- **ERR-002's crash scenario** (collector panic in production) has not been observed in any log or bug report reviewed this session — its likelihood is a HYPOTHESIS; only the *consequence* (undiagnosable, unrecoverable) is confirmed by code inspection. *Verification:* deliberately induce a panic in a debug build (e.g. temporarily add a `panic!()` in a PDH read path) and confirm no trace survives to a release-mode relaunch.
- **The security/performance lenses' deeper agent review did not complete** (rate-limited); I substituted my own direct-reading pass for both and am confident in the findings reported (SEC-001's dry-run evidence in particular is concrete, reproducible command output, not inference), but a second independent pass once the account's session limit resets (12:30pm Asia/Manila) would be worth doing as a sanity check, particularly for anything in `nvidia.rs`/`pdh.rs`'s unsafe FFI surface I may have under-scrutinized solo.
- **`npm outdated`'s React 18→19 and Vite 6→8 gaps (CQ-014)** — whether these are deliberately deferred or simply unnoticed is unknown; worth a direct question to the maintainer before treating them as backlog items rather than intentional pins.

---

## 8. Appendix — Commands Run

All commands below were executed directly in this session (not simulated); full raw output for the longest results (cargo test's 70-test list, the complete `cargo audit` vulnerability tree with dependency trees, `npm outdated`) is available in the session's terminal history and scratch files on request.

```
cd src-tauri && cargo test --verbose
cd src-tauri && cargo fmt -- --check
cd src-tauri && cargo clippy --verbose -- -D warnings
cd src-tauri && cargo audit
npx tsc --noEmit
npm test -- --run
npm audit --audit-level=high
npm outdated
cd src-tauri && cargo update -p crossbeam-epoch --dry-run
cd src-tauri && cargo update -p quick-xml --dry-run
cd src-tauri && cargo update -p plist --dry-run
cd src-tauri && cargo tree -d
grep -rn "dangerouslySetInnerHTML|eval(|new Function(" src/
grep -rniE "api[_-]?key|secret|password|token\s*=|BEGIN (RSA|PRIVATE)" src/ src-tauri/src/
```
