## Context

The Metrics selector owns its open state and portals to body. On narrow windows the dashboard becomes inert behind the hardware modal, but its body portal remains interactive. The two independent focus boundaries therefore conflict. See proposal.md and evidence.md for the reproduction.

## Goals / Non-Goals

Give the modal drawer sole focus ownership immediately during a responsive transition. Preserve metric selections and desktop coexistence of the non-modal rail and selector. Do not introduce a global overlay manager or change sensor geometry.

## Decisions

1. App supplies the existing `sidebarOpen && sidebarOverlay` condition to the selector as a disabled/suspended presentation state. The selector derives its effective open state synchronously from that input, so its portal and focus boundary deactivate in the same render. A passive close-only effect was rejected because competing focus listeners could run before the state update.
2. Clear the selector's latent open state during suspension, so widening the window never resurrects a stale popup. The drawer owns focus; do not restore focus to the now-inert Metrics trigger during suspension.
3. Reuse the existing popup, drawer, motion and token system. Primary reference lock: current dark/lime dashboard. Refero Workflow screen `f86f669a-7911-4208-acc0-a8f4a49492c2` contributes only the principle of one foreground modal task over a dimmed/blurred workspace. No source layout, colors or assets are imported. Existing error-campaign style research remains applicable; this is an interaction repair, with no new visual identity.

## Risks / Trade-offs

- Exiting animation could leave controls reachable → existing GlassPanel removes exiting content through inert/aria-hidden; test both immediate focus and final DOM removal.
- Dismissal might steal focus from the drawer → suppress selector focus restoration while disabled and leave the drawer boundary in charge.
- Resume could retain an open flag → explicitly clear it and verify reopening works with unchanged checkbox values.
