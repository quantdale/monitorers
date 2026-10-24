# Evidence — dashboard-readability

Rendered on the Vite mock harness after the sidebar-overlay commit.

Before this change, default cards showed a live number and a chart with no window range, the network chart had no scale, reorder handles were `opacity: 0` until hover, and the hardware control was an icon whose only name was an aria-label.

After:

- 900×1100 and 400×700 default views show a visible Hardware label, resting reorder grips, and a Min/Max line under percent charts. Measured card overflow: 0 at both widths, with the sidebar open and closed.
- Network cards show `Peak down …, peak up …` (`metric-range-network`).
- Hiding every card shows a card titled "All metrics hidden" with a Choose metrics button that opens the existing dialog. The dialog heading is "Show or hide cards". Tab on the last checkbox wraps to the first.
- Collecting metrics keeps the original phrase and adds a one-line explanation plus two card-shaped placeholders.

Refero search metadata for Weights & Biases, Stellate, and Chargetrip supplied desktop dashboard references. The original pass did not inspect their full images or a narrow layout, so specific responsive/focus behavior and usability improvements cannot be attributed to those references. The implementation decisions were ours.

Historical gates: `e2e/tests/dashboard-readability.spec.ts` 3/3; full Playwright suite 40/40; `chartLabels` / `renderCardContent` / `HardwareSidebar` / `sidebarLayout` unit tests 40/40; `tsc --noEmit` clean; oxlint clean on `src/`. Packaged/real lane not run at this commit.

## Finalization audit correction

The original checks covered short mock names, tiny rates, and only the last-to-first
Tab edge. Review found Shift+Tab escaped immediately after opening; long model
names overflowed Default/Tile and List clipped the live-value panel. Missing
network values became zero. The canonical gate was not run before declaring the
campaign done (its inherited test-only export still failed dead-code checks).
`finalize-dashboard-interactions` fixes these gaps and supplies full-gate and
fresh packaged evidence. The speculative wait promise and redundant helper text
were removed under the remotely added UX instructions. These earlier results
alone did not justify a locally-complete claim.
