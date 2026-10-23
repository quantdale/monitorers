# Evidence — dashboard-readability

Rendered on the Vite mock harness after the sidebar-overlay commit.

Before this change, default cards showed a live number and a chart with no window range, the network chart had no scale, reorder handles were `opacity: 0` until hover, and the hardware control was an icon whose only name was an aria-label.

After:

- 900×1100 and 400×700 default views show a visible Hardware label, resting reorder grips, and a Min/Max line under percent charts. Measured card overflow: 0 at both widths, with the sidebar open and closed.
- Network cards show `Peak down …, peak up …` (`metric-range-network`).
- Hiding every card shows a card titled "All metrics hidden" with a Choose metrics button that opens the existing dialog. The dialog heading is "Show or hide cards". Tab on the last checkbox wraps to the first.
- Collecting metrics keeps the original phrase and adds a one-line explanation plus two card-shaped placeholders.

Refero inputs: Weights & Biases system metrics, Stellate metrics, and Chargetrip analytics — current value plus a readable scale, labeled controls, and an empty state with a next action. Not copied.

Gates: `e2e/tests/dashboard-readability.spec.ts` 3/3; full Playwright suite 40/40; `chartLabels` / `renderCardContent` / `HardwareSidebar` / `sidebarLayout` unit tests 40/40; `tsc --noEmit` clean; oxlint clean on `src/`. Packaged/real lane not run, not claimed.
