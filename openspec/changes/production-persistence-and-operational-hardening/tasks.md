# Tasks — Production Persistence and Operational Hardening

## 1. Baseline and adopted-work verification

- [ ] 1.1 Record starting state: branch `agent/monitorers-production-persistence-ci-hardening` from `origin/main` = `718e503`; adopted WIP inventoried (workflows, snapshot.rs vendor cache, hardware.rs CpuIdentity, thin LTO, MetricChart memo, startup_probe, schema docs, progress.md).
- [ ] 1.2 Verify adopted WIP against gates: `npx tsc --noEmit`, `npm test -- --run`, `cargo test`, `npm run sim:typecheck`; commit coherently.

## 2. Repository truth convergence (Workstream A)

- [ ] 2.1 Rewrite `AGENTS.md` testing-gotchas sentence that claims WebView2 can't be automated into the three-lane capability statement (harness E2E / mock sim / packaged CDP real lane) without duplicating architecture detail.
- [ ] 2.2 Rewrite `progress.md` Current Goal + status header to truthful post-campaign state (PR #28 complete/archived/merged; current phase = this hardening change).
- [ ] 2.3 Audit CLAUDE.md / .cursorrules / README / simulation docs for the same stale assumptions; add the .cursorrules simulation-platform doc pointer (backlog item) or record why not.
- [ ] 2.4 Verify every documented schema/lifecycle version equals executable constants (5↔5, 1↔1) and that no file advertises two "current" values; strengthen the machine-checkable consistency check if a gap exists.

## 3. Real-lane sidebar relaunch certification (Workstream B)

- [ ] 3.1 Add `data-sb-id` to `SortableSidebarCard` root (stable semantic ids).
- [ ] 3.2 Add engine steps: `readSidebarIds` (DOM order via `[data-sb-id]`), `waitForSidebarCards(minCount)` (hardware-profile-settled poll).
- [ ] 3.3 Implement real-only journey `sidebar-relaunch-persistence` per the §6 contract: fresh isolated store → settled discovery → record initial ids → keyboard drag reorder → UI order changed → write landed in real settings.json → clean shutdown → new process → discovery settles → order restored exactly → unrelated settings coherent → metrics advancing → close; orphan + isolation guarantees enforced by runner/driver.
- [ ] 3.4 Local real-lane run against a built exe; capture artifacts (run.jsonl, stderr) proving true relaunch (distinct processes/ports, empty history after relaunch).

## 4. Restart/settings durability soak (Workstream C)

- [ ] 4.1 Evaluate coverage overlap (customization-roundtrip, qualify.spec, sidebar journey) against the soak contract list; record decision.
- [ ] 4.2 If justified: bounded deterministic soak journey (launch→wait healthy→mutate isolated setting→persist→clean shutdown→relaunch→verify × N), selected on the packaged/dispatch lane only; else document the reuse decision.

## 5. CI efficiency (Workstream D)

- [ ] 5.1 Verify the adopted taiki-e/install-action pin (full commit SHA, tool `cargo-audit@0.22.1`) matches repository security conventions; confirm failure visibility on install failure.
- [ ] 5.2 Record evidence: old approach cost (CI log or measured local `cargo install` time), new download cost, cache/tool key notes, integrity mechanism.
- [ ] 5.3 Audit nearby CI for one or two obvious inefficiencies; apply only clear wins (Playwright Chromium caching verification counts); document declined candidates.

## 6. Focused hardening audit (Workstream E)

- [ ] 6.1 Settings/persistence deep review: useSettings paths, plugin-store init, save queue concurrency, corrupt/future-version handling, shutdown-during-write, relaunch loading.
- [ ] 6.2 Real-app driver review: launch ownership, CDP discovery, process identity, user-data isolation, cleanup ordering, HKLM fallback, repeated use, relaunch semantics.
- [ ] 6.3 Post-relaunch lifecycle review: status bootstrap ordering, stale event fencing, generation semantics, metrics advancement.
- [ ] 6.4 CI/supply-chain review: action pins, download verification, cache keys, untrusted-PR implications.
- [ ] 6.5 Fix any found Critical/High/P1/P2 in-scope defects with regression tests; document findings that are non-issues.

## 7. Register reconciliation and docs sync

- [ ] 7.1 Update exploratory register: sidebar entry now names the certifying journey; keep/adjust free-roam pointer-drag caveat honestly; preserve hardware-only entries.
- [ ] 7.2 Reconcile progress.md backlog (sidebar item done; dual-GPU limitation restated truthfully).

## 8. Canonical validation and qualification

- [ ] 8.1 Full local gate at final head: `verify:full`, `verify:packaged`, targeted `sim:real` sidebar journey, `verify:version`, `openspec validate --all --strict --no-interactive`, `git diff --check`.
- [ ] 8.2 Push branch; obtain hosted Windows gates green at final head (rust/frontend/e2e/simulation); release qualification rerun if shared release surfaces changed.
- [ ] 8.3 Review full diff, hosted annotations, and any PR review threads; fix valid findings with regression coverage.

## 9. Completion

- [ ] 9.1 Write `evidence.md` (commands, run IDs, artifacts, measurements, limitations).
- [ ] 9.2 Final progress.md truth snapshot + detailed completion report; strict OpenSpec validation; archive change.
