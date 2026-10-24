import { useState, useRef, useEffect, useLayoutEffect, useCallback, type RefObject } from 'react';
import { useFocusBoundary } from '../hooks/useFocusBoundary';
import {
  accent,
  controlShell,
  fontSans,
  radius,
  shadowPopover,
  surface,
  surfaceHover,
  textPrimary,
  type,
} from '../design/tokens';

interface Item {
  id: string;
  label: string;
}

interface Props {
  items: Item[];
  hiddenIds: Set<string>;
  onToggle: (id: string, visible: boolean) => void;
  /** Optional so an empty-state action can open the same trigger. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

export function MetricCardSelector({ items, hiddenIds, onToggle, triggerRef: externalTriggerRef }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);

  const setTrigger = useCallback((node: HTMLButtonElement | null) => {
    triggerRef.current = node;
    if (externalTriggerRef) externalTriggerRef.current = node;
  }, [externalTriggerRef]);
  const [position, setPosition] = useState({ top: 8, left: 8, width: 240, maxHeight: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(280, window.innerWidth - 16);
      const below = Math.max(0, window.innerHeight - rect.bottom - 14);
      const above = Math.max(0, rect.top - 14);
      const useBelow = below >= Math.min(240, above);
      const maxHeight = Math.min(320, window.innerHeight - 16, useBelow ? below : above);
      setPosition({
        width,
        maxHeight,
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(
          useBelow ? rect.bottom + 6 : rect.top - maxHeight - 6,
          window.innerHeight - maxHeight - 8,
        )),
      });
    }
    reposition();
    window.addEventListener('resize', reposition);
    // The toolbar lives in the dashboard's own scroller, not the document.
    document.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  useFocusBoundary(open, panelRef);

  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        returnFocus.current = true;
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [open]);

  // Count only items that are actually present and not hidden. Using
  // items.length - hiddenIds.size here would undercount when hiddenIds holds
  // stale ids for hardware that no longer exists (e.g. an unplugged disk).
  const visibleCount = items.filter((item) => !hiddenIds.has(item.id)).length;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        ref={setTrigger}
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="metric-card-selector-panel"
        style={{
          ...controlShell,
          padding: '6px 12px',
          minHeight: 32,
          fontSize: type.label,
          fontWeight: 600,
          fontFamily: fontSans,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        Metrics ({visibleCount}/{items.length}) ▾
      </button>

      {open && (
        <div
          id="metric-card-selector-panel"
          ref={panelRef}
          role="dialog"
          aria-label="Metric card visibility"
          tabIndex={-1}
          style={{
            position: 'fixed',
            ...position,
            overflowY: 'auto',
            background: surface,
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: radius.card,
            padding: 6,
            zIndex: 100,
            boxShadow: shadowPopover,
          }}
        >
          <div style={{ padding: '6px 8px 4px', fontSize: type.label, fontWeight: 600, color: textPrimary }}>
            Show or hide cards
          </div>
          {items.map((item) => {
            const isVisible = !hiddenIds.has(item.id);
            return (
              <label
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 8px',
                  cursor: 'pointer',
                  borderRadius: radius.control,
                  fontSize: type.body,
                  fontFamily: fontSans,
                  color: textPrimary,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = surfaceHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={(e) => onToggle(item.id, e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: accent }}
                />
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{item.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
