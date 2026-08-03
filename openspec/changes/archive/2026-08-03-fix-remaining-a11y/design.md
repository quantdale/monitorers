## Context

Three independent, low-risk UI fixes across three different components (`App.tsx`, `HardwareSidebar.tsx`, `MetricCardSelector.tsx`). Each is self-contained — no shared code, no ordering dependency between them. The main design consideration is picking a contrast-compliant color for UX-004 and choosing the right ARIA role for UX-005's trigger.

## Goals / Non-Goals

**Goals:**
- Both loading/status messages meet WCAG AA (4.5:1) contrast against their actual backgrounds.
- The card-selector dropdown is dismissable via Escape and correctly exposes its open/closed state to assistive technology.
- The empty-state message appears whenever the user has hidden every visible card, regardless of how many ids remain in the persisted (but filtered-out) `cardOrder`.

**Non-Goals:**
- Not redesigning the loading/status UI beyond the color fix, or the dropdown beyond adding Escape + ARIA attributes — no visual redesign.
- Not addressing UX-006's sibling gap (TEST-005's "`cardOrder` never prunes stale ids") — that's a separate, already-documented finding, not this change's concern; UX-006 is purely about which array the *empty-state check* reads, not about pruning the underlying persisted array.

## Decisions

- **UX-004 color choice**: compute a `#666`-family gray that reaches 4.5:1 against each specific background (`#141414` and `#0f0f0f` are close but not identical, so the two messages may end up with slightly different exact hex values, or one shared value chosen to be safely above 4.5:1 against the darker of the two backgrounds so it works for both without per-background tuning). Alternative considered: use a non-gray accent color instead — rejected, since the audit's intent is clearly to preserve the current muted/secondary-text visual language, just make it compliant, not to introduce a new color into the palette.

- **UX-005 ARIA role**: use `aria-haspopup="true"` (or the more specific `"listbox"`/`"menu"` value matching whatever the dropdown's actual rendered role is — check `MetricCardSelector.tsx`'s current markup for whether the dropdown list has `role="listbox"`/`role="menu"` or is unstyled `div`s, and match the `aria-haspopup` value to that role per the ARIA spec rather than defaulting to the generic `"true"` if a more specific role is already in use). `aria-expanded={isOpen}` toggles with the existing open/closed state already tracked by the component.

- **UX-006 fix**: change the empty-state condition from reading `cardOrder.length === 0` to `visibleCardOrder.length === 0` — `visibleCardOrder` (computed at `App.tsx:371`) already exists and is exactly the array that should gate whether anything renders; this is a one-line condition change, not a new computation.

## Risks / Trade-offs

- [Risk: the exact contrast-compliant gray looks noticeably different/lighter than the current `#666`, standing out more than intended for "secondary" status text] → Mitigation: 4.5:1 is the AA *minimum*, not a target to overshoot — pick the darkest gray that still clears 4.5:1 against the relevant background, keeping the visual weight as close to the original intent as the constraint allows.
- [Risk: UX-005's Escape handler conflicts with some other global Escape-key behavior elsewhere in the app] → Mitigation: scope the new listener to fire only while the dropdown is open, and verify manually that Escape doesn't also need to do something else in this component's current behavior (audit found no existing Escape handling in this component at all, so no conflict is expected, but worth a quick check during implementation).

## Migration Plan

Not applicable — no data migration, no schema change, no user-facing rollout beyond three independent, backward-compatible UI fixes.

## Open Questions

None — all three findings have a clear, low-risk resolution path.
