import { useState, useRef, useEffect, type RefObject } from 'react';
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

  function setTrigger(node: HTMLButtonElement | null) {
    triggerRef.current = node;
    if (externalTriggerRef) externalTriggerRef.current = node;
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>('input, button, [href], [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    if (open) {
      // Move focus into the panel so a keyboard user is inside the dialog they
      // just opened instead of still on the trigger behind it.
      panelRef.current?.focus();
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
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            minWidth: 220,
            maxHeight: 320,
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
                <span style={{ flex: 1 }}>{item.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
