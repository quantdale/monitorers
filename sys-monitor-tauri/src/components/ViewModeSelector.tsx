import type { ViewMode } from '../utils';

interface Props {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const MODES: { key: ViewMode; label: string }[] = [
  { key: 'default', label: 'Default' },
  { key: 'tile',    label: 'Tile' },
  { key: 'list',    label: 'List' },
];

export function ViewModeSelector({ value, onChange }: Props) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {MODES.map(({ key, label }) => {
        const active = key === value;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{
              padding: '4px 12px',
              borderRadius: 4,
              border: active ? '1px solid #4699e8' : '1px solid #444',
              background: active ? 'rgba(70, 153, 232, 0.2)' : 'transparent',
              color: active ? '#4699e8' : '#888',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              transition: 'all 0.15s ease',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
