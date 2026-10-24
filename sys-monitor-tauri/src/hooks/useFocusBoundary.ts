import { useEffect, type RefObject } from 'react';

/** Keyboard boundary for temporary panels. Re-query controls on each event:
 * hardware discovery and visibility changes can replace them while open.
 * Escape is deliberately left to the caller (and dnd-kit's drag sensor). */
export function useFocusBoundary(active: boolean, panelRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const panel = panelRef.current;
    if (!active || !panel) return;

    function controls(): HTMLElement[] {
      return Array.from(panel!.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex]',
      )).filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') &&
        !el.closest('[inert]') && el.getClientRects().length > 0 &&
        getComputedStyle(el).visibility === 'visible');
    }

    function focusFirst() {
      (controls()[0] ?? panel)?.focus({ preventScroll: true });
    }

    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Tab' || event.defaultPrevented || panel!.closest('[inert]')) return;
      const items = controls();
      const first = items[0] ?? panel;
      const last = items.at(-1) ?? panel;
      const current = document.activeElement;
      if (!panel!.contains(current) || current === panel ||
          (event.shiftKey ? current === first : current === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }

    function onFocus(event: FocusEvent) {
      if (!panel!.closest('[inert]') && !panel!.contains(event.target as Node)) focusFirst();
    }

    focusFirst();
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
    };
  }, [active, panelRef]);
}
