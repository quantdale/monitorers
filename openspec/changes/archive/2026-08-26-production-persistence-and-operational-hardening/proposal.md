# Production Persistence and Operational Hardening

## Why

The feature campaign (`production-runtime-recovery-and-release-qualification`,
PR #28) is complete, archived, and merged. The repository has moved into
post-feature hardening, and four verifiable gaps remain:

1. **Repository truth drift.** Instruction and status files still carry stale
   claims from before the previous campaign landed: `progress.md` describes PR #28
   as "in progress", and `AGENTS.md` still asserts WebView2 "can't be automated"
   while the same repository ships a packaged real-app CDP driver that drives the
   built exe end to end. A repository must not simultaneously advertise two
   different truths about its own capabilities.
2. **Sidebar persistence is unproven on the real lane.** The backlog and the
   exploratory register both record that sidebar card ordering — which only
   renders when a real hardware profile exists — has never been exercised across
   a true process relaunch. Dashboard persistence is covered; the sidebar's
   hardware-keyed ordering is not.
3. **CI pays minutes to compile a security scanner.** The Windows Rust job
   installed pinned `cargo-audit@0.22.1` from source (`cargo install --locked`)
   on every run, recompiling its whole dependency tree for a tool whose prebuilt,
   official release artifact is available. (Adopted work already in this branch
   switches this to the SHA-pinned `taiki-e/install-action`; this change verifies
   and records that decision with evidence.)
4. **Restart durability beyond one hop is unmeasured.** Single-restart journeys
   prove one persistence round-trip; nothing exercises repeated
   launch→mutate→persist→shutdown→relaunch cycles against the real store.

## What Changes

- **Truth convergence:** reconcile `AGENTS.md`, `progress.md`, `.cursorrules`
  pointers, README, simulation docs, and the exploratory register so that source
  → tests → OpenSpec → instruction files tell one story: plain Playwright E2E
  drives the Vite harness; the mock lane scripts faults; the packaged CDP lane
  drives the built app (real IPC, real store, true relaunch); genuinely
  hardware-only events stay registered as exploratory.
- **Real-lane sidebar relaunch journey:** a new real-only simulation journey
  certifies sidebar ordering across an actual process relaunch — fresh isolated
  store, hardware discovery settled, semantic DOM identifiers read the order,
  keyboard drag reorders two items, the write lands in the isolated real
  `settings.json`, the process exits, a NEW process launches, discovery settles
  again, the exact order is restored, unrelated settings stay coherent, metrics
  keep advancing, teardown leaves no owned orphans and never touches the
  developer's real store.
- **Bounded restart soak:** evaluate whether a small deterministic
  launch→mutate→persist→shutdown→relaunch→verify soak materially adds confidence
  beyond existing coverage; implement only what is justified, sized for a
  dispatch/qualification lane rather than ordinary PR CI.
- **CI efficiency without gate reduction:** keep `cargo audit` mandatory at the
  pinned version; replace source compilation with a supply-chain-trustable,
  immutably-pinned installation path; document old vs new approach, integrity
  mechanism, cache/tool keys, and measured or estimated savings. Audit nearby CI
  for one or two obvious inefficiencies; no wholesale workflow rewrite.
- **Focused hardening audit:** deep review of settings/persistence, the
  real-app driver, post-relaunch lifecycle, and CI supply chain within this
  blast radius; fix newly found Critical/High/P1/P2 defects with regression
  coverage.

## Non-Goals

- No new product features, UI redesign, dependency-major upgrades, telemetry,
  cross-platform support, or architecture changes.
- No weakening of any test, gate, or assertion to make lanes green.
- No fabricated physical-hardware validation (identical dual-GPU mapping,
  hotplug, lid/power remain explicitly unqualified until qualifying hardware is
  available).
- No reopening of the archived PR #28 change.
