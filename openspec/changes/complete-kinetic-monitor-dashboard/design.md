## Context

The current dirty tree contains an unfinished UI overhaul on main@ad3b637. Baseline browser tests reproduce both keyboard reorder and short-window selector failures 3/3, with no retries. The older dependency execution prompt is explicitly superseded and unrelated. See proposal.md for scope.

## Goals / Non-Goals

**Goals:** finish all presentation surfaces, retain every existing metric/customization/recovery capability, stabilize immediate keyboard interaction and viewport placement, and deliver verified code to main as requested.

**Non-Goals:** collector/IPC/history/settings migrations, new telemetry, new routes, remote fonts, or replacing dnd-kit/Recharts.

## Decisions

1. **Reference lock:** retain the lime-on-charcoal technical instrument direction from ClickHouse and LaunchDarkly styles, with Chargetrip's comparable chart cards and Weights & Biases' resource grid (Refero screens 4abd4a1b-821a-43a8-a8d6-114251f8cbde and eba7517e-dcc0-4a82-891f-548c4489346a). Use 4/8px spacing, 16px panel corners, system sans and tabular mono readings. Lime means interaction; channel colors mean metrics. Reject copied branding, marketing-scale heroes, redundant helper text, and fake capabilities.
2. **Evidence before bisection:** instrument the actual keyboard sensor/drop geometry, DOM sizes and scroll offsets. Reject the prior unproven diagnosis embedded in SortableCard comments. Add deterministic regressions before fixing immediate keyboard drop/reverse/cancel under scroll and a popup nested under transformed ancestors. Existing live-update and bounded long-name/high-rate fixtures retain data/containment coverage.
3. **Separate functional geometry from decoration:** sortable nodes belong to dnd-kit; entrance feedback must not change measured geometry. A small shared keyboard sensor uses dnd-kit's coordinate getter, synchronous listener registration/movement, and current collision results instead of passive-effect `over` state. Fixed delays/frame waits were tested and rejected as unreliable. Pointer behavior is unchanged. Viewport overlays use a body portal outside toolbar transform/backdrop containing blocks, with portal-aware outside-click handling and immediate inert exit. Preserve focus boundary, Escape/drag-cancel semantics, stable keys and ordering.
4. **Small motion vocabulary:** use only the primitives consumed by the product, a shared reduced-motion-aware root, non-overshooting viewport-safe panels, and inline component styles plus global base/interaction CSS. Never animate chart data or live numeric changes. Remove continuous ambient motion, dead helpers, unsafe type casts and experiment residue where they add cost without utility.
5. **Unchanged state/data:** keep useMetrics/useSettings/useHardwareProfile, timestamp windows, memo boundaries, all schema values, and backend untouched. Presentation changes remain testable through production components.
6. **Qualification:** run all TS projects, hooks lint, unit tests, both scoped npm audits and production build; repeated regression E2E then full E2E and mock simulations. Build a fresh Tauri executable and exercise packaged qualification for CSP, real IPC/store/restart/cleanup. Review all changed files, sync/archive specs, normal commit/push to main and inspect hosted results.

## Risks / Trade-offs

- Animation can change geometry or containing blocks → regression tests measure real painted boxes, not only state or jsdom.
- Native versus mock runtime differ → packaged lane validates the final frontend and strict CSP, not merely Vite.
- Live metrics can wrap unpredictable text → keep long-name/high-rate fixtures and responsive checks at 400x300 through desktop.
- Reduced motion can be missed by JS animations → OS preference controls the root motion policy and CSS animations, with browser checks.
- New dependency/bundle cost → retain only necessary motion code; audit lockfile and build output; do not add extra libraries for decoration.

## Migration Plan

No data migration. Verify the complete candidate before the explicitly authorized non-force main push. Rollback is a normal revert of this presentation commit; settings and backend contracts remain compatible.
