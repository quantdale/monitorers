## 1. Loading-message contrast (UX-004)

- [ ] 1.1 Compute a text color meeting 4.5:1 contrast against `App.tsx`'s "Collecting metrics…" message background (`#141414`); update `App.tsx:458-468`'s `color` accordingly.
- [ ] 1.2 Compute a text color meeting 4.5:1 contrast against `HardwareSidebar.tsx`'s "Detecting hardware…" message background (`#0f0f0f`); update `HardwareSidebar.tsx:284-287`'s `color` accordingly.

## 2. Dropdown Escape handling and ARIA (UX-005)

- [ ] 2.1 Add a `keydown` listener (scoped to while the dropdown is open) in `MetricCardSelector.tsx` that closes the dropdown when Escape is pressed.
- [ ] 2.2 Check the dropdown's current rendered role (e.g. `role="listbox"`/`"menu"`/unstyled divs) and add the matching `aria-haspopup` value to the trigger button (`MetricCardSelector.tsx:34-50`).
- [ ] 2.3 Add `aria-expanded={isOpen}` (or equivalent existing state variable) to the trigger button.

## 3. Empty-state gate fix (UX-006)

- [ ] 3.1 Change the empty-state condition in `App.tsx` (currently checking `cardOrder.length === 0` around line 458) to check `visibleCardOrder.length === 0` (the already-computed filtered array from `App.tsx:371`) instead.

## 4. Verify

- [ ] 4.1 Run `npx tsc --noEmit` from `sys-monitor-tauri/` — confirm clean.
- [ ] 4.2 Run `npm test -- --run` from `sys-monitor-tauri/` — confirm the current baseline of 46 tests still pass.
- [ ] 4.3 Manually verify: (a) both loading messages are legible/pass a contrast check (e.g. via browser devtools contrast checker) against their real backgrounds; (b) the card selector dropdown closes on Escape and its `aria-expanded` toggles correctly; (c) hiding every card via the selector shows the empty-state message instead of a blank canvas.
