## Context

The app uses dnd-kit for drag-to-reorder in two independent places (`App.tsx`'s main card grid, `HardwareSidebar.tsx`'s sidebar card list), each with its own `DndContext` and its own drag-handle component (`MetricCard.tsx`'s handle, `SortableSidebarCard.tsx`'s handle). The sidebar's handle already gets the accessible-name behavior right (SVG icon, no competing text content); the main grid's handle doesn't. Both `DndContext`s share the same missing-`sensors`-prop gap. Styling is inline-only per project convention, except for one existing sanctioned exception: `src/styles.css`, imported once in `main.tsx` — this is where the CSP's `style-src 'unsafe-inline'` allowance and the one non-inline stylesheet already coexist, and it's the natural (only) place `:focus-visible` pseudo-class rules can live, since inline React `style` props can't express pseudo-classes at all.

## Goals / Non-Goals

**Goals:**
- A keyboard-only user can Tab to a drag handle, see it (not invisible), hear its correct accessible name, and use arrow keys to move it to adjacent positions predictably.
- Fix this identically in both places the interaction exists (main grid and sidebar), even though only the main grid currently has the naming bug — both need the sensors/keyboard-coordinate fix.

**Non-Goals:**
- Not introducing a new styling mechanism — stay within the existing `styles.css` exception rather than adding CSS modules, styled-components, or inline pseudo-class workarounds (which don't exist in React inline `style` objects).
- Not redesigning the drag-handle visual treatment beyond making it focus-visible-aware; the hover-based reveal behavior for mouse users is unchanged.
- Not adding full component-test infrastructure (`@testing-library/react`) solely for this change — that's a larger, separately-tracked gap (TEST-005, partially owned by the in-progress `add-realistic-usage-test-suite` change).

## Decisions

- **UX-001 fix location**: extend the existing `src/styles.css` (not a new file, not inline styles) with `.drag-handle:focus-visible { opacity: 1; }` and `button:focus-visible { outline: <visible-but-unobtrusive-value>; }`. Alternative considered: remove `button { outline: none; }` entirely and rely on the browser default focus ring — rejected, since the audit's framing suggests the app intentionally suppressed the native (often visually jarring) default ring for mouse users; the `:focus-visible` pseudo-class (not plain `:focus`) is the standard mechanism for showing a ring only for keyboard/programmatic focus while staying invisible for mouse clicks, which is exactly the distinction this app already wants (hover-for-mouse, now focus-visible-for-keyboard).

- **UX-002 sensors config**: use dnd-kit's standard `useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))` pattern (the documented, idiomatic fix for exactly this dnd-kit gap) in both `App.tsx` and `HardwareSidebar.tsx`. Keep `PointerSensor` alongside `KeyboardSensor` so existing mouse/touch drag behavior is unaffected — this is additive, not a replacement of the current (implicit default) sensor setup.

- **UX-003 fix approach**: mark the `⠿` glyph `aria-hidden="true"` and rely on the existing `title` attribute (already present, already correct text) to provide the accessible name — this is the smaller diff (no new attribute needed, `title` already says "Drag to reorder") versus adding a redundant `aria-label` alongside `title`. Alternative considered: add `aria-label="Drag to reorder"` directly on the handle element instead of touching the glyph — equally valid, but leaves the glyph as competing (now redundant but still present) accessible content unless also hidden; decided the `aria-hidden` approach is cleaner since it addresses the actual root cause (content winning over title) rather than layering a higher-precedence attribute on top without addressing why `title` was losing.

## Risks / Trade-offs

- [Risk: `button:focus-visible` outline styling looks visually inconsistent with the rest of the app's dark, minimal aesthetic] → Mitigation: pick an outline color/style consistent with existing accent colors already used elsewhere in the app (check current inline styles for an existing accent/highlight color to reuse, rather than introducing a new one).
- [Risk: `sortableKeyboardCoordinates`'s sibling-aware movement behaves unexpectedly with this app's specific 2D grid layout (main dashboard) vs. the sidebar's likely 1D list] → Mitigation: `sortableKeyboardCoordinates` is dnd-kit's own general-purpose keyboard coordinate getter designed to work with `SortableContext`'s configured layout strategy in both list and grid arrangements — verify manually via keyboard navigation in both the main grid and the sidebar after the change, since this is the one part of this batch not easily unit-testable without component-test infrastructure.
- [Risk: UX-003's `aria-hidden` on the glyph accidentally also visually hides it for sighted users] → Mitigation: `aria-hidden="true"` only removes an element from the accessibility tree — it has zero effect on visual rendering. No visual regression risk from this specific change.

## Migration Plan

Not applicable — no data migration, no schema change, no user-facing rollout beyond the visual/interaction fix itself, which is backward compatible (no existing keyboard-drag behavior is being removed, only made functional/visible).

## Open Questions

- Exact focus-ring color/style for `button:focus-visible` — a small visual-design choice best resolved during implementation by matching an existing accent color already in use, not a blocking decision.
