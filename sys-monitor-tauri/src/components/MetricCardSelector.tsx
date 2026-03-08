import { useState, useRef, useEffect } from 'react';

interface Item {
  id: string;
  label: string;
}

interface Props {
  items: Item[];
  hiddenIds: Set<string>;
  onToggle: (id: string, visible: boolean) => void;
}

export function MetricCardSelector({ items, hiddenIds, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const visibleCount = items.length - hiddenIds.size;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          padding: '4px 12px',
          borderRadius: 4,
          border: '1px solid #444',
          background: '#1e1e1e',
          color: '#fff',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: 'inherit',
        }}
      >
        Metrics ({visibleCount}/{items.length}) ▾
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            minWidth: 200,
            maxHeight: 320,
            overflowY: 'auto',
            background: '#1e1e1e',
            border: '1px solid #444',
            borderRadius: 6,
            padding: 8,
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          {items.map((item) => {
            const isVisible = !hiddenIds.has(item.id);
            return (
              <label
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  fontSize: 12,
                  color: '#fff',
                }}
              >
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={(e) => onToggle(item.id, e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: '#4699e8' }}
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
