## 1. Focus-visible styling (UX-001)

- [x] 1.1 Add `.drag-handle:focus-visible { opacity: 1; }` to `src/styles.css`, mirroring the existing `.metric-card:hover .drag-handle { opacity: 1; }` rule.
- [x] 1.2 Add a `button:focus-visible { outline: ...; }` rule to `src/styles.css` to restore a visible keyboard focus indicator app-wide, since `button { outline: none; }` currently suppresses it for every button, not just drag handles. Pick an outline color consistent with an existing accent color already used elsewhere in the app.
- [x] 1.3 Manually verify via keyboard Tab navigation that both the main dashboard's and sidebar's drag handles become visible on focus, and that other buttons (view-mode toggle, card selector, etc.) show a visible focus ring.

## 2. Keyboard-aware drag sensors (UX-002)

- [x] 2.1 Import `useSensor`, `useSensors`, `PointerSensor`, `KeyboardSensor` from `@dnd-kit/core` and `sortableKeyboardCoordinates` from `@dnd-kit/sortable` in `App.tsx`.
- [x] 2.2 Add a `sensors` prop to `App.tsx`'s `DndContext` (`App.tsx:470`) using `useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))`.
- [x] 2.3 Repeat 2.1-2.2 for `HardwareSidebar.tsx`'s `DndContext` (`HardwareSidebar.tsx:289`).
- [x] 2.4 Manually verify keyboard-driven reordering moves a card to the adjacent sibling position (not a fixed pixel offset) in both the main dashboard and the sidebar.

## 3. Drag handle accessible name (UX-003)

- [x] 3.1 In `MetricCard.tsx:98-108`, mark the `⠿` glyph `aria-hidden="true"` so the handle's accessible name falls back to its existing `title="Drag to reorder"` attribute instead of the glyph's text content.
- [x] 3.2 Confirm `SortableSidebarCard.tsx`'s equivalent handle is unaffected (it should already be correct — this is a regression guard, not a fix).

## 4. Verify

- [x] 4.1 Run `npx tsc --noEmit` from `sys-monitor-tauri/` — confirm clean.
- [x] 4.2 Run `npm test -- --run` from `sys-monitor-tauri/` — confirm the current baseline of 46 tests still pass.
- [x] 4.3 Manually smoke-test end-to-end keyboard-only card reordering in both the main dashboard and the hardware sidebar (Tab to handle, see it, activate, arrow-key to reorder, confirm final position matches intent) — no automated component-test infrastructure exists yet for this interaction.
