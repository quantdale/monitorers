import type { ViewMode } from '../utils';
import {
  accentTint,
  controlShell,
  fontSans,
  radius,
  textMuted,
  textPrimary,
  type,
} from '../design/tokens';

interface Props {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const MODES: { key: ViewMode; label: string }[] = [
  { key: 'default', label: 'Default' },
  { key: 'tile',    label: 'Tile' },
  { key: 'list',    label: 'List' },
];

/** Segmented control (Polar's time-filter pattern): one quiet shell, the
 *  active mode filled with the accent tint. Keeps the role="group"/aria-pressed
 *  contract the accessibility specs assert. */
export function ViewModeSelector({ value, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Dashboard view mode"
      style={{
        ...controlShell,
        display: 'flex',
        gap: 2,
        padding: 2,
      }}
    >
      {MODES.map(({ key, label }) => {
        const active = key === value;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(key)}
            style={{
              padding: '3px 12px',
              borderRadius: radius.control - 2,
              border: 'none',
              background: active ? accentTint : 'transparent',
              color: active ? textPrimary : textMuted,
              cursor: 'pointer',
              fontSize: type.label,
              fontFamily: fontSans,
              fontWeight: active ? 600 : 500,
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
