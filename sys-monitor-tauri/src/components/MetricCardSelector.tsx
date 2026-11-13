import { useState, useRef, useEffect, useLayoutEffect, useCallback, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { createPortal } from 'react-dom';
import { useFocusBoundary } from '../hooks/useFocusBoundary';
import {
  accent,
  accentInk,
  accentTint,
  controlShell,
  fontSans,
  radius,
  surfaceHover,
  textMuted,
  textPrimary,
  textSecondary,
  type,
} from '../design/tokens';
import { GlassPanel } from './Controls';
import { springPop, staggerParent, slideInItem } from '../design/motion';

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
  /** A modal drawer owns focus while the dashboard behind it is inert. */
  disabled?: boolean;
}

export function MetricCardSelector({ items, hiddenIds, onToggle, triggerRef: externalTriggerRef, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const panelOpen = open && !disabled;
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);

  // Derive closure synchronously above so the portal and focus boundary leave
  // immediately; clear latent state so a later resize cannot reopen it.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const setTrigger = useCallback((node: HTMLButtonElement | null) => {
    triggerRef.current = node;
    if (externalTriggerRef) externalTriggerRef.current = node;
  }, [externalTriggerRef]);
  const [position, setPosition] = useState({ top: 8, left: 8, width: 240, maxHeight: 0 });

  useLayoutEffect(() => {
    if (!panelOpen) return;
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
  }, [panelOpen]);

  useFocusBoundary(panelOpen, panelRef);

  useEffect(() => {
    if (!panelOpen && returnFocus.current) {
      returnFocus.current = false;
      if (!disabled) triggerRef.current?.focus();
    }
  }, [panelOpen, disabled]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node) &&
          !panelRef.current?.contains(e.target as Node)) {
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
    if (panelOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [panelOpen]);

  // Count only items that are actually present and not hidden. Using
  // items.length - hiddenIds.size here would undercount when hiddenIds holds
  // stale ids for hardware that no longer exists (e.g. an unplugged disk).
  const visibleCount = items.filter((item) => !hiddenIds.has(item.id)).length;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <motion.button
        type="button"
        ref={setTrigger}
        onClick={() => setOpen((previous) => !previous)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        aria-controls={panelOpen ? 'metric-card-selector-panel' : undefined}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.965 }}
        transition={springPop}
        style={{
          padding: '6px 12px',
          minHeight: 36,
          fontSize: type.label,
          fontWeight: 600,
          fontFamily: fontSans,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          cursor: 'pointer',
          borderRadius: radius.control,
          background: panelOpen ? accentTint : controlShell.background,
          border: panelOpen ? `1px solid ${accent}` : controlShell.border,
          color: textPrimary,
        }}
      >
        {/* Live count pip: how many cards are currently on the dashboard. */}
        <span
          aria-hidden="true"
          style={{
            minWidth: 20,
            padding: '1px 5px',
            borderRadius: radius.chip,
            background: accent,
            color: accentInk,
            fontSize: 10,
            fontWeight: 700,
            fontFamily: fontSans,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {visibleCount}
        </span>
        Metrics ({visibleCount}/{items.length})
        <motion.span
          aria-hidden="true"
          animate={{ rotate: panelOpen ? 180 : 0 }}
          transition={springPop}
          style={{ color: panelOpen ? accent : textMuted, fontSize: 10 }}
        >
          ▾
        </motion.span>
      </motion.button>

      {/* Glass/backdrop and animated ancestors establish fixed containing
          blocks. A viewport-positioned panel must live outside that subtree. */}
      {createPortal(<AnimatePresence>
        {panelOpen && (
          <GlassPanel
            id="metric-card-selector-panel"
            role="dialog"
            aria-label="Metric card visibility"
            tabIndex={-1}
            panelRef={panelRef}
            style={{
              position: 'fixed',
              ...position,
              overflowY: 'auto',
              padding: 6,
              zIndex: 100,
            }}
          >
            <motion.div
              variants={staggerParent(0.03, 0.02)}
              initial="hidden"
              animate="visible"
            >
              <div
                style={{
                  padding: '6px 8px 6px',
                  fontSize: type.label,
                  fontWeight: 700,
                  color: textPrimary,
                  fontFamily: fontSans,
                }}
              >
                Show or hide cards
              </div>
              {items.map((item) => {
                const isVisible = !hiddenIds.has(item.id);
                return (
                  <motion.label
                    key={item.id}
                    variants={slideInItem}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      cursor: 'pointer',
                      borderRadius: radius.chip,
                      fontSize: type.body,
                      fontFamily: fontSans,
                      color: isVisible ? textPrimary : textSecondary,
                    }}
                    whileHover={{ backgroundColor: surfaceHover }}
                    transition={{ duration: 0.12 }}
                  >
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={(e) => onToggle(item.id, e.target.checked)}
                      style={{ cursor: 'pointer', accentColor: accent, width: 15, height: 15, flexShrink: 0 }}
                    />
                    {/* The channel pip: a card keeps its series identity in the
                        list so you can tell what you are turning off. */}
                    <span
                      aria-hidden="true"
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background: isVisible ? accent : 'rgba(255,255,255,0.18)',
                        transition: 'background-color 180ms cubic-bezier(0.22, 1, 0.36, 1)',
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{item.label}</span>
                  </motion.label>
                );
              })}
            </motion.div>
          </GlassPanel>
        )}
      </AnimatePresence>, document.body)}
    </div>
  );
}
