import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_PUSH_MIN_VIEWPORT_PX,
  SIDEBAR_WIDTH_PX,
  sidebarPresentsAsOverlay,
} from './sidebarLayout';

describe('sidebarPresentsAsOverlay', () => {
  it('overlays at the product minimum window, where a push rail crushes cards', () => {
    expect(sidebarPresentsAsOverlay(400)).toBe(true);
    expect(sidebarPresentsAsOverlay(SIDEBAR_PUSH_MIN_VIEWPORT_PX - 1)).toBe(true);
  });

  it('pushes once the viewport can hold the rail beside a 400px dashboard', () => {
    expect(SIDEBAR_PUSH_MIN_VIEWPORT_PX).toBeGreaterThan(400 + SIDEBAR_WIDTH_PX);
    expect(sidebarPresentsAsOverlay(SIDEBAR_PUSH_MIN_VIEWPORT_PX)).toBe(false);
    expect(sidebarPresentsAsOverlay(900)).toBe(false);
  });
});
