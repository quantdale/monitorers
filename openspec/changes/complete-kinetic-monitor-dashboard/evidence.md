# Execution evidence — complete kinetic monitor dashboard

## Baseline and scope

Started from `main@ad3b637` with the inherited unfinished frontend diff. `origin/main` matched; the user explicitly requested completion and a normal push to main. The obsolete `.agent/EXECUTION_PROMPT.md` is marked SUPERSEDED and was not resumed.

Raw session evidence is outside the repository at `D:\Documents\tryPython\_AgentArtifacts\monitorers\sessions\20261112-pi-ui-recovery\`. `initial.patch` preserves the inherited tracked changes; the original untracked primitives were also copied there before edits. No destructive reset, force push, or credential/business-data changes were used.

## Recommendation re-evaluation and root causes

The prior recommendation to keep bisecting card overflow/border/decoration was rejected as unproven. The two existing failures reproduced **6/6** across three repeats (`baseline-e2e.log`). Instrumentation captured actual sensor coordinates, current collisions, passive `over`, scroll ancestors and popup containing blocks (`geometry*.log`, `collision-drag.log`).

1. Taller cards cross the keyboard sensor's viewport-midpoint threshold, triggering its scroll-only branch. Smooth scrolling can leave the old target at Enter. A further race exists because the stock sensor defers attaching its key listener, and React publishes `over` in a passive effect. Logs show collision order starting with **memory** while `over` still says **cpu**. A fixed two-frame workaround failed repeated testing and was removed. The final shared `useCardSensors` installs keyboard listeners synchronously (ignoring the activation event), keeps dnd-kit's sibling-aware coordinate getter, commits movement before scrolling, and uses current collisions for consecutive keys. `cardDropTarget` resolves keyboard drops from that same current collision result; pointer `over` semantics and persisted-order helpers are unchanged.
2. The selector stayed at **-16px after its entrance settled**, despite inline `top: 40px`: a glass/backdrop toolbar ancestor established its fixed-position containing block. Removing a motion `y` value did not fix it. The panel now portals to the body; outside-click handling includes the portal and exit content becomes inert immediately. Panel animation cannot overshoot its viewport bounds.
3. The full simulation exposed React shorthand/longhand style conflicts when switching views. Shared card surfaces now use composable background/border properties. This was fixed, not filtered out of the console-error gate.

The new scroll/drop and transformed-toolbar tests went red before fixing (`regression-red.log`). Current geometry tests retain exact ordering and viewport assertions, with reverse moves and cancellation as well. No test was skipped or threshold weakened. The sole existing chart-spec edit updates its mirrored surface RGB for the intentional palette change; all geometry/contrast thresholds remain unchanged.

## Presentation completion and review

Refero was queried again for the relevant real system-monitor and dark analytics screens; the reference lock is in design.md and tokens.ts. Completed the shared lime/charcoal tokens, channel-colored cards, clear reading hierarchy, equal-height responsive tiles, compact readable List rows, sticky glass shell, hardware rail/drawer, native time picker, correctly aligned animated view thumb, visibility picker, skeletons, recovery/error and actionable all-hidden state. Removed unused controls/motion variants, unsupported claims in experiment comments, the ref cast, continuous ambient movement and redundant helper copy. `Controls.tsx` follows the documented component naming convention.

Root MotionConfig, preference-aware variants and CSS disable nonessential motion under the OS preference. Live chart samples remain unanimated. Reviewed every changed source/test/config plus its callers; no Rust/backend, useMetrics, useSettings, useHardwareProfile, payload/schema, timestamp/history or hardware-identity implementation changed (`git diff --quiet` verified).

## Verified local candidate

Windows, **Node 24.15.0**, npm 11.4.2. Counts below are this run's evidence, not standing repository totals.

| Check | Result / evidence |
| --- | --- |
| `npm run verify:fast` | Exit 0 (`verify-fast.log`): version/doc fidelity, dead-code gate, both audit scopes, production/test-source TS, hooks lint, **342 tests / 26 files**, production build, Rust format, five feature matrices, Clippy `-D warnings`, Cargo audit |
| Repository-root npm audit | Exit 0, **0 vulnerabilities**; root workspace holds husky only |
| Application npm audit | Exit 0, **0 vulnerabilities**; authoritative application scope |
| Rust matrices | Library tests **209 / 209 / 190 / 203 / 201** plus binary tests; real-hardware ignored cadence probe remains opt-in and is not claimed |
| Cargo audit | Exit 0 with **3 existing allowed warnings** (not zero warnings), including dispositioned Unix/platform advisories; lockfile unchanged |
| `npm run sim:typecheck` | Exit 0; third TypeScript project covers E2E/simulation sources |
| Active LSP probes | No error findings; final probe confirmed 10 files clean and left 7 push-only/silent-on-clean files inconclusive. All three compiler projects independently passed; this is not a claim of complete LSP coverage |
| Repeated interaction tests | **40/40**, no retries (`fresh-collision.log`); later containment/interaction/presentation batch **24/24**, no retries (`polish-regression.log`) |
| Full E2E | **51/51**, retries disabled (`e2e-candidate.log`) |
| Full mock simulation | **16/16 journeys**, no quarantine, seed 42; **4/4 runner tests** (`mock-candidate.log`) |
| Fresh Tauri release | `verify:tauri` exit 0 (`tauri-candidate.log`) |
| Packaged qualification | **1/1**, real IPC/live metrics/isolated store/modal focus/drag cancellation/clean exit (`packaged-candidate.log`) |
| Selected real simulations | **3/3 journeys**, **4/4 runner tests**: customization roundtrip, sidebar true-relaunch persistence, three-cycle restart durability (`real-candidate.log`) |
| Host cleanup | WebView2 wildcard policy verified absent; real driver enforced orphan-process and developer-store byte-identity checks |
| OpenSpec | **26/26** strict validation before archive (`openspec-final-active.log`) |
| Whitespace | `git diff --check` exit 0 |

The final component-module rename is behavior-neutral: production `dist/index.html` remains byte-identical with SHA-256 `66568e0c2ff3f7e41b3c49e3f438c9c9881bb564f4c02bb66d4cb7ff723d7e6d`; its content-hashed script references are unchanged. The qualified release executable SHA-256 is `2ac279da58484a361fc0947ff580d039435c588b535dcb6d0344b8c5e4a676af`.

One intermediate full-matrix run failed trace cleanup (`tracing.stop` exceeded 15s) while the release build was running. That failure is retained (`mock-sim-final.log`); a standalone full rerun passed all journeys (`mock-sim-solo.log`), followed by the green final-candidate full run above. No cleanup assertion or timeout was weakened.

## Visual and accessibility evidence

Inspected screenshots at 900x1100, 400x300 and 320x568: `dashboard-default.png`, `tile-final.png`, `mobile-list-final.png`, `metrics-minimum.png`, `empty-final.png`. Browser axe scans reported **0 violations**, with incomplete automated gradient/overlap contrast checks (not a blanket accessibility certification). Unit tests explicitly prove contrast at the brightest channel-wash endpoint and on the active lime control. The popup relationship was manually verified: one matching panel ID, body-rooted portal, and the trigger's controls attribute matching it while open. Browser regressions prove focus containment, Escape restoration, reduced motion, and viewport geometry.

## Delivery

Implementation is locally qualified. Normal main push, hosted checks, spec sync/archive and final clean-tree audit are the remaining delivery steps; this section is updated from actual results rather than predicting them.
