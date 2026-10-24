# Session finalization evidence

## Baseline and Git reconciliation

- Original session baseline: `main@733e955b387c8284c0cf275674209fde5baa5025` (clean).
- Reviewed session commits: `9a611b2` (sidebar overlay) and `17433c8` (readability). Review began at clean `main@17433c8`, ahead of the stale local tracking ref by two commits.
- Fetch found `origin/main@b5ab82324769119ce33cf1c90c75a2c3f44fff87`, an additive six-line AGENTS.md change. Merged it on `agent/session-finalization` as `c89d444`; no reset, rebase, or force push. The remotely added concise-UX rule is preserved.
- The superseded `.agent/EXECUTION_PROMPT.md` was not reopened. This change supplies current planning/state for the explicit session-review objective.

## Reproduced failures and corrections

1. `npm run verify:frontend` failed immediately: `sidebarPresentsAsOverlay` was referenced only by its test. Deleted the duplicate production predicate; the unit test now checks the actual runtime query and E2E crosses 639/640px.
2. Real Chromium at 400x300: Shift+Tab immediately after opening Metrics focused its external trigger; Tab from the hardware modal's Close button focused the external scrim. Shared `useFocusBoundary` now queries current enabled/visible controls, wraps both directions, guards inert ancestry, redirects escaped focus, and removes listeners on cleanup. Scrim is pointer-only and the closed hardware rail becomes inert immediately. Escape remains separate from Tab so dnd-kit cancellation owns the first Escape.
3. A production-component browser fixture with a long CPU name/unbroken disk model and high rates failed in all three modes: Default/Tile overflowed; List's title text painted to x=739.84 while its chart began at x=212.23, hidden by the old clipped panel. Names, values and metadata now wrap within allocated widths without hiding primary readings. No shipped test API or mock hardware profile was added.
4. Missing-network/empty-utilization unit tests failed (fabricated `0 KB/s`, `Min: 0.0%`). Missing readings now retain unavailable markers, including null-only device windows and a missing upload channel's accessible chart name. Valid zero remains zero.
5. Simplified empty/loading copy, removed the unsupported one-second startup promise and sidebar helper sentence, suppressed fallback disk names identical to their key, and reconciled token-color docs. Historical evidence now explicitly states the earlier gate gaps and the limit of Refero search metadata (no inspected mobile pattern). No new usability/performance certification is attributed to those references.

Red-capable logs (local, ignored): `sys-monitor-tauri/e2e-results/qa/session-review-{frontend-baseline,red,content-red,missing-red}.log`. The browser fixture initially had an ESM/CJS loader mistake (`createRoot is not a function`); corrected before recording genuine geometry failures. Initial packaged test incorrectly expected dnd-kit to serialize `aria-pressed="false"`; inactive dnd-kit removes the attribute, so the test now asserts it is no longer true, the drawer remains open, and the stable-key order is unchanged.

## Dependency and runtime corrections

The application audit (not the root-only workspace) blocked the gate on Vite high and Vitest moderate advisories. Compatible patches were selected deliberately:

| Package | Before | Final |
| --- | --- | --- |
| vite | 8.3.1 | 8.3.5 |
| vitest / @vitest family | 4.1.11 | 4.1.12 |
| undici (transitive jsdom dependency) | 8.11.2 | 8.12.3 |

Associated required transitive patches: rolldown/bindings 1.2.13 -> 1.2.15, @oxc-project/types 0.153.0 -> 0.155.0, chai 6.2.2 -> 6.3.0, postcss 8.5.29 -> 8.5.31. No packages added/removed from the lockfile and no unrelated direct dependency upgrade.

Audit references include GHSA-9jrq-w75r-8gcw, GHSA-698v-4r3x-3vcv, GHSA-587h-7wmj-h5pm, GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp, GHSA-4qv8-2p9j-2685 and GHSA-f72v-6w45-q472 (the captured npm audit contains the complete advisory list).

System Node 24.3.0 is below jsdom 30.1.1's already-declared 24.15 floor. Final full/install checks use isolated Node **24.15.0**, not a machine-wide replacement. `.nvmrc`, package engines and README now declare the supported Node 24 floor. npm 11.4.2's optional-peer resolver crashed with `edgesOut` during the update; npm 11.12.0 resolved the two direct patches without disabling peers. A subsequent frozen `npm ci` on Node 24.15 succeeded without engine warnings. No global runtime was upgraded.

## Final local validation (corrected code)

- `npm run verify:full` **exit 0**, log `e2e-results/qa/session-review-final-full.log`:
  - release/doc fidelity, dead-code (440 symbols, zero unreferenced), both TypeScript source/test projects, hooks lint;
  - **312 unit tests / 24 files**;
  - application npm audit: **0 vulnerabilities**; repository-root npm audit (husky-only workspace): **0 vulnerabilities**, independently checked;
  - Rust fmt, five feature configurations (all/default/no-default/NVML-only/NVAPI-only), clippy all targets/all features `-D warnings`, cargo audit;
  - **46 Playwright E2E** tests;
  - simulation/e2e TypeScript project and **4 mock simulation tests**, including the full default journey/persona matrix;
  - production frontend and fresh Windows no-bundle executable build.
- Fresh packaged `verify:packaged`: **1 passed**. Real IPC schema/history, advancing collector timestamps, isolated settings, narrow hardware modal forward/reverse focus, actual sidebar keyboard-drag cancellation, second-Escape dismissal/focus return, clean process shutdown and developer-store byte-identity self-test.
- Real simulation at `SIM_SEED=42`, journeys `first-launch-onboarding,customization-roundtrip,sidebar-relaunch-persistence`: **4 tests passed**, **5/5 selected journey/persona runs passed** (including true restarts and stable sidebar-order persistence).
- After every real-lane run, `assert:webview2-policy-absent` **exit 0**. HKLM write was denied on this non-elevated host, so the driver used the per-process environment route; no machine-wide debug value remained.
- LSP probes were run on changed source/test files. No current error/warning findings, but the push-only server reported silent rechecks as inconclusive. All three CLI TypeScript projects are the authoritative typecheck evidence. Deprecated `act` imports in touched tests were migrated to React's export.
- `git diff --check` clean; strict OpenSpec validation passed before archive.

Packaged exe SHA-256 at qualification: `4d583d62b4c249b85d91cddfc2fc1983c63921937ddc482be6434850dd7810b1`.

## Visual and accessibility review

- Actual dark-mode renders: 400x300 default, open Metrics, modal drawer; 900x1100 Tile/List; all-hidden state; actual hardware Tile dashboard and narrow drawer from the packaged app. Long-content production fixtures at 300px Tile / 360px Default and List were also rendered and inspected. No claim of a light theme (none supported).
- Evidence under `sys-monitor-tauri/e2e-results/qa/session-final-*` (ignored local artifacts), including durable `session-final-packaged/` and `session-final-content/` output folders.
- Embedded axe 4.12.1 checks, WCAG 2 A/AA tags: **0 automatic violations** in default, selector, drawer, and all-hidden states. Not a blanket accessibility certificate: default/selector had incomplete SVG/glyph contrast and ARIA-target checks; empty had an incomplete ARIA-target check. DOM inspection confirmed the open selector's aria-controls target exists and matches exactly. SVG text contrast is covered by the token contrast unit tests and existing rendered-axis tests; decorative grip content is aria-hidden. Drawer scan had no incomplete checks.
- Keyboard entry, both Tab edges, Escape, focus restore, resizing, and viewport containment are regression-tested. Reduced-motion emulation reported `matches=true` and card transition duration `1e-05s`.
- No measured performance improvement is claimed. The chart scalar-tick memo fan-out guards remain green.

## Limits and delivery status

Physical hotplug, power/lid events, and true identical-dual-Nvidia proof remain hardware-bound and were not fabricated. Installer/signing certification is not part of these frontend corrections. No permissions or IPC/store schemas were broadened.

## Delivery and hosted evidence

Application correction commit **`c111684fcb59e836bc024bb54c0fa677bc8e9b81`** was fast-forwarded onto local main and normally pushed to origin/main after the enabled pre-push `verify:fast` gate passed. `git ls-remote` and the local tracking ref both confirmed that exact SHA. Hosted checks at that SHA all passed:

- Rust and release **40044985275**: frontend, Rust, Windows production executable success. Executable artifact `sys-monitor-tauri-windows-executable` exists (3,271,155 bytes).
- E2E harness **40044985397**: success, `playwright-report` artifact exists (270,956 bytes).
- Simulation **40044985295**: mock lane and shipped-config lint success, `sim-mock-results` artifact exists (152,507,796 bytes).
- An Ubuntu runner-image migration notice was informational, not a test failure. MSI/NSIS and hosted packaged dispatch lanes were skipped by workflow policy, not claimed.

The final archive/documentation commit only updates specs/progress/evidence and clarifies that `npm run verify:packaged` consumes a built exe (the historical README and AGENTS command comments incorrectly said it builds one). This session used the fresh executable from `verify:full`, not a stale binary. Final documentation-SHA hosted results are checked after its push rather than attributed to the application commit above.

## Cargo audit warning disposition

`cargo audit` exits 0 but is **not warning-free**. The final pre-push database reported three allowed informational warnings: proc-macro-error 1.0.4 unmaintained (RUSTSEC-2024-0370), glib 0.18.5 VariantStrIter unsoundness (RUSTSEC-2024-0429), and tokio 1.53.1 Unix AsyncFd unsoundness (RUSTSEC-2026-0386). `cargo tree -i glib` and `-i proc-macro-error` with target `x86_64-pc-windows-msvc` print no dependencies. The Tokio advisory's affected functions are exclusively `tokio::io::unix::AsyncFd::*`, behind `cfg_net_unix` and not compiled for this Windows-only product. No advisory was suppressed or a gate weakened. Mitigation: the shipped Windows target cannot reach these affected Linux/Unix APIs. Ownership: Tauri/GTK/Tokio upstream updates, re-evaluate with the next native-dependency qualification or any platform expansion. Broadening the native migration during this frontend finalization would add risk without reducing this product's applicable attack surface.

Final local cleanup verified no sys-monitor-tauri process and no listener on port 5180; both agent-browser sessions were closed. No unrelated user changes were removed. No installer/signing, physical-hardware, or complete screen-reader certification is implied by this session's checks.
