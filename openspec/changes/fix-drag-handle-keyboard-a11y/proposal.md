## Why

A 2026-07-25 engineering audit flagged a systemic keyboard-accessibility gap in the drag-to-reorder interaction: no focus-visible styling exists anywhere in the app, drag handles are literally invisible to keyboard focus, keyboard-driven reordering is wired up via dnd-kit but impractical to use, and the drag handle's accessible name is a meaningless glyph rather than "Drag to reorder." Three findings (UX-001, UX-002, UX-003), re-confirmed still open against current source, all concern the same UI element (the drag handle) and the same interaction (keyboard-driven card reordering) across `MetricCard.tsx`, `App.tsx`, `HardwareSidebar.tsx`, and `SortableSidebarCard.tsx` — bundled here since fixing keyboard drag-reorder properly requires touching all three aspects (visibility, movement, naming) together for the interaction to actually work end-to-end for a keyboard user.

## What Changes

- **UX-001**: `src/styles.css` currently sets `button { outline: none; }` globally (killing the native focus ring on every button in the app, not just drag handles) and `.drag-handle { opacity: 0; }` shown only via `.metric-card:hover .drag-handle { opacity: 1; }` — zero `:focus`/`:focus-within` rule. Add `.drag-handle:focus-visible { opacity: 1; }` (or an equivalent `:focus-within` rule on the card, matching how hover already works) so a keyboard-focused handle becomes visible, and add a `button:focus-visible { outline: ...; }` rule so the app-wide focus-ring removal doesn't leave every button (not just drag handles) invisible to keyboard focus.
- **UX-002**: Both `DndContext`s (`App.tsx:470`, `HardwareSidebar.tsx:289`) currently omit a `sensors` prop, so dnd-kit's default keyboard coordinate-getter is in effect — it nudges 25px per key press with no sibling-rect awareness, making keyboard reordering technically wired but impractical. Add an explicit `sensors` prop to both contexts using `useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))` (importing `sortableKeyboardCoordinates` from `@dnd-kit/sortable`), so keyboard reordering moves an item to the next/previous sibling position instead of an arbitrary pixel offset.
- **UX-003**: `MetricCard.tsx:98-108`'s drag handle has a `title="Drag to reorder"` attribute, but its child is the literal text node `⠿` — per accessible-name computation, "name from content" wins over `title` for content-bearing roles, so screen readers announce the glyph instead of "Drag to reorder." (`HardwareSidebar.tsx`'s equivalent `SortableSidebarCard.tsx` gets this right because its child is an SVG icon with no text content, so accname computation falls through to `title`.) Fix `MetricCard.tsx`'s handle so its accessible name is "Drag to reorder" — either by marking the `⠿` glyph `aria-hidden="true"` (letting `title` provide the name) or by adding an explicit `aria-label="Drag to reorder"` that takes precedence over content.

## Capabilities

### New Capabilities
- `keyboard-accessible-drag-reorder`: formalizes, as a durable requirement, that the app's drag-to-reorder card interaction (both the main dashboard and the hardware sidebar) is fully operable and legible via keyboard alone — focus-visible styling on drag handles, sibling-aware keyboard movement, and a correct accessible name. No such capability currently exists in `openspec/specs/`.

### Modified Capabilities
(none)

## Impact

- **Code**: `sys-monitor-tauri/src/styles.css` (UX-001), `src/App.tsx` (UX-002's `sensors` prop on its `DndContext`), `src/components/HardwareSidebar.tsx` (UX-002's `sensors` prop on its own `DndContext`), `src/components/MetricCard.tsx` (UX-001's `.drag-handle` class usage already present, UX-003's accessible-name fix).
- **APIs/schema**: none.
- **Dependencies**: `sortableKeyboardCoordinates` is imported from the already-installed `@dnd-kit/sortable` package — no new dependency.
- **Tests**: Frontend baseline currently 46 tests. No component-level testing library exists yet in this repo (confirmed — `@testing-library/react` is absent), so this change is likely verified manually (keyboard navigation smoke-test) rather than via new automated tests, unless a lightweight assertion (e.g. on the computed `sensors` config, or a snapshot of the rendered handle's `aria-label`) is added without requiring full component-test infrastructure.
- **Out of scope**: everything else in the wider audit backlog, including UX-004/005/006 (bundled separately as `fix-remaining-a11y`) and the still-absent `@testing-library/react`/component-test infrastructure gap (tracked separately by the in-progress `add-realistic-usage-test-suite` change).
