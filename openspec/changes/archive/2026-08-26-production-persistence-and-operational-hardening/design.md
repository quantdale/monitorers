# Design — Production Persistence and Operational Hardening

## Context

Post-feature hardening. The adopted branch carries an uncommitted 2026-08-26
remediation/performance pass (pinned `taiki-e/install-action` cargo-audit
install, Playwright Chromium caching, schema-doc 4→5 fixes, MetricChart memo,
thin LTO, startup_probe, dead-code removal). That work is verified and committed
as part of this change rather than redone.

## Goals / Non-Goals

- Goal: executable evidence over documentation claims; every guarantee traces
  requirement → implementation → real seam → regression test → packaged
  behavior → hosted evidence → documentation.
- Non-goal: feature work; gate weakening; physical-hardware fabrication.

## Decisions

### D1. Sidebar order assertions read semantic DOM identifiers

The sidebar renders only with a real hardware profile (real lane), so its DOM
order was previously unassertable — steps fell back to persisted-settings reads.
`SortableSidebarCard` gains a stable `data-sb-id="<id>"` attribute on its root
element (ids are the existing hardware-keyed stable ids: `sb_cpu`,
`sb_gpu_<key>`, `sb_memory`, `sb_disk_<key>`, `sb_network`). The journey asserts
rendered order through `[data-sb-id]` in document order AND the persistence
layer through the isolated real `settings.json`. This is a testability seam in
production code: one attribute, no behavior change. The exploratory register's
"dead `[data-sb-id]` selectors" note becomes true instead of removed.

Alternative rejected: asserting only via persisted settings — that proves what
was written, not what the user sees; the spec requires both layers.

### D2. Keyboard drag is the reorder interaction

dnd-kit keyboard drag (focus handle → Space → ArrowDown → Enter) is already the
platform's proven, deterministic interaction (`dragSidebarCard` step exists;
dashboard journeys use the same pattern). Pointer drag against the relaunched
WebView2 window remains unproven and stays registered unless this campaign
proves it; the journey must not gamble lane stability on it. Moving the first
card down one slot reorders two items — satisfying "at least two valid items"
with the app's actual supported interaction.

### D3. True relaunch semantics

The journey uses the driver's `restartApp()` — real process exit (kill +
exit-code wait) then a NEW spawned process reusing ONLY the per-run temp app-data
dir. Distinguishing evidence vs fake restarts:

- process-level: driver tracks spawn/exit of distinct child processes; CDP port
  is freshly allocated per launch (a reused port/page would indicate no relaunch);
- page-level: after relaunch the page is a new target — `validateAppPage()`
  re-runs, history buffers are empty (history does not survive restart), and the
  collector status bootstrap sequence starts from `starting`;
- persistence-level: settings survive because they live on disk, not in memory.

### D4. Restart soak: dispatch-lane extension, not PR-gate

A dedicated bounded soak journey (N=3 cycles of mutate→persist→shutdown→relaunch
→verify with rotating fields) adds marginal cost to the packaged/dispatch lane
where a build already exists, but minutes to ordinary PR CI if run there.
Decision: implement as a real-only journey selectable via `SIM_JOURNEYS`
(default matrix unchanged); wire it into the simulation workflow's packaged
dispatch selection so hosted dispatches exercise it. If existing coverage
(customization-roundtrip + qualify.spec + the new sidebar journey) is judged
sufficient for every contract the soak would prove, record that evaluation
honestly instead of adding a redundant lane.

### D5. cargo-audit installation keeps exact audit semantics

Adopted approach (verified here): `taiki-e/install-action@<full-SHA>` installing
`cargo-audit@0.22.1` — same version, same lockfile-pinned tool semantics; the
action downloads the official RustSec prebuilt release. Integrity/trust:
immutable commit SHA pin of the action (not a tag), official upstream release
distribution, version pinned exactly as before. A cache-miss equivalent (action
failure) fails the job visibly — audit cannot silently disappear. Evidence:
record old `cargo install` wall-time from CI logs where available; otherwise the
documented measured compilation cost from local reproduction, plus the new
download-time measurement.

### D6. Truth convergence targets

- `AGENTS.md`: replace "WebView2 can't be automated" with the three-lane truth
  (harness E2E / mock sim / packaged CDP real lane) and point at the register
  for genuinely hardware-only scenarios.
- `progress.md`: rewrite Current Goal/status header to post-campaign hardening;
  keep completed history; refresh backlog truthfully at campaign end.
- `.cursorrules`: evaluate the backlog item — add a concise pointer to the
  simulation platform docs (one line, no duplication).
- Exploratory register: rewrite the sidebar-reorder entry to name the new
  certifying journey; keep free-roam pointer-drag registered unless proven;
  keep all physically-hardware-bound entries.

## Risks / Trade-offs

- `[data-sb-id]` adds a production attribute → mitigated by zero-behavior-change
  scope and existing data-testid precedent in the same component tree.
- Soak journey could flake on slow hosted discovery → bounded polls on explicit
  state only (no fixed sleeps beyond driver bring-up), and dispatch-lane placement.
- install-action trust → SHA-pinned action + pinned tool version + official
  distribution; documented in tasks and evidence.

## Migration Plan

Additive: new attribute, new journey, workflow step replacement. No persisted
format changes; settings schema untouched (`SETTINGS_VERSION` stays 2).

## Open Questions

- None blocking. Physical dual-GPU qualification depends on hardware presence;
  handled truthfully per §10 boundary (fixtures stay deterministic; limitation
  stays documented).
