## Context

The hardware sidebar is a 220px flex sibling. That is the right desktop pattern (persistent rail beside the charts). It is the wrong pattern at the 400px minimum window: 220px of rail plus page padding leaves a card column narrower than the nowrap telemetry badges.

Refero references for monitoring dashboards (Weights & Biases system metrics, Stellate metrics, Enode developer dashboard) keep a persistent sidebar on desktop and do not compress the metric grid to make room for it on a narrow viewport. This product already has a single toggle; the narrow presentation should be a temporary drawer, not a second navigation system and not a visual redesign.

## Goals / Non-Goals

**Goals:**

- Opening the rail at 400×300 does not change the dashboard column width and does not overflow any card.
- 900×1100 (and any viewport ≥ 640px) still pushes.
- Overlay is dismissible by the existing toggle's job (scrim, Close, Escape) and returns focus to the toggle.
- Keyboard drag Escape still cancels the drag (dnd-kit `preventDefault`) instead of also closing the drawer.

**Non-Goals:**

- Redesigning the rail, the dashboard, or the token system.
- Changing sidebar card order, identity, or persistence.
- Adding a hardware profile to the mock harness.

## Decisions

1. **Breakpoint is 640px, not 400px.** A push rail needs the 220px rail plus a dashboard at least as wide as the closed minimum window (400px). 640 is the first width where both fit with a little margin. 639px and below overlay. The rule lives in `sidebarLayout.ts` so the media query and the unit test share one constant.
2. **Overlay is `position: fixed` on the same `#hardware-sidebar` element.** It leaves the flex flow, so the dashboard column does not shrink. Closed state still uses width 0 plus `visibility: hidden`, so the collapse animation and the "not in the accessibility tree" contract stay on the same element.
3. **The drawer is a modal dialog only while open in overlay mode.** `role="dialog"` / `aria-modal` plus `inert` on the dashboard column keep keyboard focus out of the covered page. Push mode uses `role="complementary"` and no scrim, so the toolbar toggle remains the close control and simulation's title-based toggle selector is unchanged.
4. **Escape is deferred one tick.** dnd-kit's keyboard sensor registers its document `keydown` listener after the drawer's and calls `preventDefault` on Escape to cancel a drag. Closing only when the event was not cancelled preserves that.

## Risks / Trade-offs

- Resizing across 640px while the rail is open switches presentation immediately. Focus returns to the toggle when leaving overlay so a disappearing Close button does not drop focus. → Accepted; the alternative is a layout jump the other direction.
- The mock harness has no hardware profile, so the drawer shows the empty profile status. Geometry is still measurable. → Real-lane sidebar content is unchanged.

## Migration Plan

Frontend-only. No settings migration. Rollback is reverting the presentation branch.

## Open Questions

- None.
