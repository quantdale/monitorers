import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_PUSH_MIN_VIEWPORT_PX,
  SIDEBAR_WIDTH_PX,
  SIDEBAR_OVERLAY_MEDIA,
} from './sidebarLayout';

describe('sidebar overlay media query', () => {
  it('uses the actual runtime query with an exclusive push boundary', () => {
    expect(SIDEBAR_OVERLAY_MEDIA).toBe(`(max-width: ${SIDEBAR_PUSH_MIN_VIEWPORT_PX - 1}px)`);
  });

  it('pushes once the viewport can hold the rail beside a 400px dashboard', () => {
    expect(SIDEBAR_PUSH_MIN_VIEWPORT_PX).toBeGreaterThan(400 + SIDEBAR_WIDTH_PX);
    // Browser tests prove the actual media query switches at 639/640px.
    expect(SIDEBAR_PUSH_MIN_VIEWPORT_PX).toBe(640);
  });
});
