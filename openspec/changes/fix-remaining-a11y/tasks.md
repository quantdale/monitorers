## 1. Loading-message contrast (UX-004)

- [x] 1.1 Compute a text color meeting 4.5:1 contrast against `App.tsx`'s "Collecting metrics…" message background (`#141414`); update `App.tsx:458-468`'s `color` accordingly. Used `#888` (already the app's existing secondary-text color elsewhere): luminance-based contrast ≈6.46:1 against `#141414`.
- [x] 1.2 Compute a text color meeting 4.5:1 contrast against `HardwareSidebar.tsx`'s "Detecting hardware…" message background (`#0f0f0f`); update `HardwareSidebar.tsx:284-287`'s `color` accordingly. Same `#888`: contrast ≈6.73:1 against `#0f0f0f`.

## 2. Dropdown Escape handling and ARIA (UX-005)

- [x] 2.1 Add a `keydown` listener (scoped to while the dropdown is open) in `MetricCardSelector.tsx` that closes the dropdown when Escape is pressed.
- [x] 2.2 Check the dropdown's current rendered role (e.g. `role="listbox"`/`"menu"`/unstyled divs) and add the matching `aria-haspopup` value to the trigger button (`MetricCardSelector.tsx:34-50`). The dropdown content is an unstyled list of checkboxes (no `role="menu"`/`"listbox"` semantics) — used `aria-haspopup="true"` (generic popup) rather than a more specific value that would misrepresent its actual role.
- [x] 2.3 Add `aria-expanded={isOpen}` (or equivalent existing state variable) to the trigger button. Wired to the existing `open` state.

## 3. Empty-state gate fix (UX-006)

- [x] 3.1 Change the empty-state condition in `App.tsx` (currently checking `cardOrder.length === 0` around line 458) to check `visibleCardOrder.length === 0` (the already-computed filtered array from `App.tsx:371`) instead. The gate is the extracted `shouldShowLoadingState()` helper in `cardIdentity.ts` (added by a since-merged change) — updated its call site in `App.tsx` to pass `visibleCardOrder`, and renamed/redocumented the helper's parameter to make the filtered-vs-raw distinction explicit for future callers.

## 4. Verify

- [x] 4.1 Run `npx tsc --noEmit` from `sys-monitor-tauri/` — confirm clean. Clean (after `npm install`, which was needed since `node_modules` wasn't present in this sandbox).
- [x] 4.2 Run `npm test -- --run` from `sys-monitor-tauri/` — confirm the current baseline of 46 tests still pass. **Reconfirmed baseline was actually 77** (grown since this proposal was written, via the since-merged `fix-history-emission-rate`/`add-realistic-usage-test-suite` changes). All 77 pass, plus **1 new test** (UX-006 regression: `shouldShowLoadingState` returns `true` when every card is hidden) — **78 total**.
- [x] 4.3 Manually verify: (a) both loading messages are legible/pass a contrast check (e.g. via browser devtools contrast checker) against their real backgrounds; (b) the card selector dropdown closes on Escape and its `aria-expanded` toggles correctly; (c) hiding every card via the selector shows the empty-state message instead of a blank canvas. Verified live against `npm run dev` (mock data, headless Chromium): `aria-haspopup`/`aria-expanded` toggle correctly, Escape closes the dropdown, and hiding all 7 cards renders "Collecting metrics…" instead of a blank canvas. Contrast verified by calculation (see 1.1/1.2) rather than a devtools session, since this sandbox has no interactive devtools UI.
