# Evidence — overlay-narrow-hardware-sidebar

Measured on the Vite mock harness (2026-10-23), before the fix:

- 400×300, sidebar closed: card list width 360px, 0 overflowing cards.
- 400×300, sidebar open (in-flow 220px rail): card list width 140px. Disk C:
  scrollWidth 230 vs clientWidth 138. Memory, Disk D, and the discrete GPU
  card also overflowed. Document horizontal overflow stayed 0, so the overflow
  was clipped inside the cards.
- 700×800 and 900×1100, sidebar open: 0 overflowing cards. The push rail is
  fine at those widths.

Refero (system-monitor and metrics dashboards: Weights & Biases, Stellate,
Enode) keeps a persistent sidebar on desktop and does not compress the metric
grid to make room for it on a narrow viewport. This change follows that split
without copying those products: overlay below 640px, push at and above 640px.

After the fix, `e2e/tests/sidebar-overlay.spec.ts` (3/3):

- 400px overlay does not change card-list width, sidebar is `position: fixed`
  at 220px, 0 overflowing cards, scrim click closes and returns focus to the
  toggle.
- Escape closes the overlay and restores focus. The Escape listener is
  deferred one tick so a keyboard-drag cancel (`preventDefault`) is not also
  a close.
- 900px still pushes (list narrows by at least 200px after the width
  transition) and shows no dialog and no scrim.

Also in this tree, not part of the layout spec:

- Network default/tile cards now show a Down glance numeral (the chart's
  primary series) instead of an empty value. Unit pin in
  `renderCardContent.test.tsx`. Rendered at 900×1100 and 400×700 with 0
  overflowing cards.
- "All metrics hidden" and "Collecting metrics…" are polite live regions.
  E2E asserts the all-hidden status role after hiding every card.

Local gates for this tree: `openspec validate --all --strict` 26 passed;
`tsc --noEmit` clean; oxlint clean on the touched sources; sidebar layout
unit tests and HardwareSidebar render tests passed; sidebar-overlay E2E 3/3;
accessibility E2E including the new empty-state case passed.
Packaged/real lane not run, not claimed.
