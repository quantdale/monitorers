/** Hardware rail width. Shared by the panel and the overlay breakpoint so the
 * two cannot drift. */
export const SIDEBAR_WIDTH_PX = 220;

/**
 * Below this viewport width a 220px in-flow rail leaves the dashboard narrower
 * than the width that already contains every card at the product's 400px
 * minimum window (measured: 400px with the rail open → 140px card list, disk
 * badges overflowing 230px into a 138px card). At and above it, the rail
 * pushes and cards still fit (measured clean at 700px).
 */
export const SIDEBAR_PUSH_MIN_VIEWPORT_PX = 640;

/** Match media for overlay mode. 639px so 640px still pushes. */
export const SIDEBAR_OVERLAY_MEDIA = `(max-width: ${SIDEBAR_PUSH_MIN_VIEWPORT_PX - 1}px)`;

export function sidebarPresentsAsOverlay(viewportWidth: number): boolean {
  return viewportWidth < SIDEBAR_PUSH_MIN_VIEWPORT_PX;
}
