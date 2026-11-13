# Connection recovery campaign evidence

## Starting state and discovery

- Start: clean `main@3cee0e988b19ce71d805c3015ec1b31f80e9c810`, tracking origin/main. Work branch: `agent/frontend-successor-2026-11-13` at that same SHA. Existing Cursor worktrees left untouched.
- `.agent/EXECUTION_PROMPT.md` explicitly SUPERSEDED. Prior archived readiness campaigns include hosted installer/runtime receipts; these are historical evidence, not a fresh gate for this campaign.
- Applicable sources read: workspace rules, AGENTS, CLAUDE, .cursorrules, goal/Refero/OpenSpec skills, progress and frontend/simulation source. Product is one dark Windows metrics dashboard with Default/Tile/List, selectable windows, sortable/hideable cards and a hardware rail/modal drawer. Settings persist through a shared provider; live scalars/history/OS state retain their existing ownership.
- Refero is accessible. Retrieved full Linear and ClickHouse styles plus Wynde/Shuttle error screen metadata. Principles and exact IDs in design.md. Screen metadata is reference evidence, not proof of this product's interactions.
- Session artifacts: `D:\Documents\tryPython\_AgentArtifacts\monitorers\sessions\20261113-codex-frontend-audit\`.
- Rendered baseline at 400x300: dashboard toolbar and cards contained. Metrics panel within viewport and internally scrollable. Desktop render at 900x1100 captured. Baseline axe: zero automatic violations; contrast incomplete for gradients/pseudo elements (not claimed as a complete contrast certification).
- Reproduced history error using the existing browser bridge: set history fault to fail, select 300s. UI says “Couldn't refresh metrics history ... Showing previous data” with no retry action (`before-history-error.png`). Source confirms failed subscription is latched with no reconnect API. Compatible history also clears the unrelated live-schema error.

## Prioritized completion model

1. P1: in-place recovery from frontend metrics connection failures (active campaign). High confidence: reproduced dead end plus source path; preserves last-good data and user settings.
2. P2: adversarial overlay exit/focus/resize and failure-state containment audit after connection repair; implement only reproduced defects.
3. Qualification: fresh full baseline, native executable/real IPC/settings/relaunch and release safety. Existing broad tests and archived qualification reduce the case for speculative architecture or visual rewrites.
4. Physical identical-GPU/hotplug and signing remain unavailable external certification; do not fabricate them. No evidence yet warrants a backend, dependency or visual identity migration.

## Baseline

`npm run verify:full` exit 0 (`baseline-full.log`): 360 unit tests in 28 files, both frontend TS projects/hooks lint/production build, documentation/dead-code gates, repository-root npm audit zero vulnerabilities and application npm audit zero vulnerabilities; five Rust matrices (211/211/192/205/203 library tests plus 5 binary tests each; hardware test intentionally ignored), fmt/Clippy green, Cargo audit exit 0 with three existing allowed warnings; E2E 52/52; mock simulation 4 Playwright tests with 16/16 journey/persona runs; Windows release executable built. Frontend/Rust/E2E/mock baseline finished before source edits; the final baseline executable compilation used the already-built unchanged frontend assets and finished after edits began. No baseline failure was reinterpreted as success.

## Implementation and focused verification

- A regression first failed because a compatible history response cleared an active live-schema error (`schema-isolation-red.log`, corrected test matcher before establishing the actual red). Removed that cross-channel clear. The active live channel now proves its own recovery.
- Connection revision disposes old listeners, awaits bounded registration attempts and releases the selected-window history read. Pending flags and a synchronous activation fence coalesce repeated clicks. Last-known metrics/settings stay mounted. No `retry_collection` call is made for frontend connection repair.
- Ten-second deadlines bound unanswered history/subscription operations. Late history cannot win after timeout; raw listener promises remain owned and late registrations are removed on disposal. Deadline timers are canceled on effect teardown.
- `hook-deadlines.log`: 36/36 hook tests, including 8 new tests for schema isolation, retry/coalescing/live replay/current camelCase window, repeated initial failure, listener repair/old callback fencing, delayed registration/stale history, history timeout/late result, subscription timeout/late cleanup and timer teardown.
- `connection-final.log`: 7/7 rendered tests before the additional timeout browser case. Initial failure, repeated failure then success, selected window/Tile/order preservation, pending/disabled/busy state, keyboard focus return and non-stealing focus, reduced motion and long diagnostics. Representative widths 400x300, 768x900, 900x1100 and 1440x900. Stable failure screenshots inspected at 400x300 and 900x1100; normal layout stays intact and the retry control fits.
- Visual review rejected a misleading first diagnosis: screenshots initially showed the error behind the sticky toolbar. An isolated reproduction found Playwright's click scroll-into-view moved the scroller by 60px before the error existed; direct focus/click and disabling anchoring disproved a product scroll-anchoring defect. Tests now deliberately start top-of-dashboard and wait for settled opacity for visual capture. No speculative scrolling behavior was added. Diagnostic scripts remain session artifacts.
- TypeScript production/test/simulation projects and hooks lint pass after implementation. First canonical frontend gate passed; final gate rerun follows the deadline/native coverage additions.
- React best-practices skill reviewed: unconditional hooks, explicit effect dependencies/cleanup, stable reload callback, no new chart prop churn, native controls, refs for transient activation/focus ownership, and existing component/tokens reused. No new dependency or styling framework.

## Remaining qualification

Local implementation qualification is complete below. Git/spec delivery and the newly discovered GPU identity successor remain active.

## First complete metrics qualification and adversarial follow-ups

- Canonical frontend gate exit 0 after deadlines: 368 tests, two scoped npm audits zero vulnerabilities, type/lint/build/docs/dead-code checks green. Full E2E 60/60 (`full-e2e.log`). Full mock matrix at seed 42: 16/16 journey/persona runs, 4/4 runner tests (`metrics-mock.log`). Fresh release executable built (`tauri-final.log`).
- First packaged retry test failed because assignment to Tauri's immutable `invoke` property did not install a fault; no product failure or pass was inferred. Local Tauri core source confirmed the property is defined without writable/configurable. Final test leaves it intact and injects one error Response through the CDP page's fetch boundary, restoring native fetch immediately. `metrics-packaged-fetch.log`: 1/1 native qualification passes, genuine history/listener reconnection and resumed collector data, selected settings retained, focus and existing drawer/drag-cancel checks pass. The synthetic failures are test-boundary responses, not actual hardware faults. Real store/orphan checks pass; HKLM policy absent after both failed and successful attempts. HKLM write access denied is expected on this non-elevated host; env-only debugging succeeds.
- Successor audit reproduced the separate responsive-overlay conflict, now tracked in `coordinate-responsive-overlays`; its red test proves two dialogs remain active after resize. The source repair and focused geometry/sidebar suite pass 9/9. Final combined candidate qualification is still pending.
- Further no-fabricated-data review found startup CPU initialized to zero despite known history, and mock refetches overwrote observed memory sizes with fixture 8/16. Both behavioral tests first failed (`startup-scalars-red.log`); CPU now uses known history until live data, unknown sizes show existing unavailable markers, and history reads cannot overwrite live sizes. Hook suite now passes 38/38. No IPC/persisted shape change. All three TS projects and hooks lint pass.

## Combined local candidate

- `combined-fast.log` exit 0: 370 unit tests in 28 files, documentation/dead-code checks, both frontend typechecks/hooks lint/build, five Rust feature matrices/fmt/Clippy, repository-root and application npm audits each zero vulnerabilities, Cargo audit exit 0 with the same three allowed warnings. Simulation typecheck also clean.
- `combined-e2e.log` 61/61; `combined-mock.log` 16/16 journey/persona runs at seed 42 (4 runner tests).
- `combined-tauri.log`: fresh production executable, SHA256 `428A9428AFC3D89D29AAF5E824A7DFCB8E78F3C42D1AA8A4E1A782F129DB27D3`.
- `combined-packaged.log` 1/1: native data advances after history/listener repair; selected 300s/Tile values remain in the isolated real store; modal/keyboard/drag-cancel/resize ownership checks pass. Actual `exclusive-modal-real.png` and `dashboard-real.png` inspected. The latter shows a normally scrolled dashboard, not a full-page export.
- `combined-real.log`: customization roundtrip 9/9, sidebar relaunch persistence 17/17 and restart soak 25/25 assertions; all 3 journeys pass (4 runner tests). Developer store byte identity, orphan guards, teardown and post-run WebView2 policy absence pass. No signing or physical hotplug claim.
- Settled axe results: error 0 violations/1 incomplete rule, Metrics panel 0 violations/2 incomplete rules, hardware modal 0/0. Immediate mid-animation captures remain in artifacts and are explicitly not contrast certification. Normal/reduced-motion and keyboard flows are exercised by E2E.
- Adversarial source/diff review found no introduced unresolved defect. Runtime review DID find another material pre-existing issue: the native UI shows 3 GPU cards, but WMI reports 2 physical controllers. Direct DXGI probe (`dxgi-before.json`) proves LUID `0x0001865D` is Microsoft Basic Render Driver with SOFTWARE flag 2, while Nvidia is `0x000186D3`. The positional WMI caption mapper assigns both the final Nvidia caption. This becomes the next executable campaign; not deferred as a hardware blocker. No OS API/collector change has yet been made.
