import { motion, useReducedMotion } from 'motion/react';
import { LayoutDashboard, LayoutGrid, List } from 'lucide-react';
import type { ViewMode } from '../utils';
import { accent, accentInk, controlShell, fontSans, radius, textMuted, type } from '../design/tokens';
import { springPop } from '../design/motion';

interface Props {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const MODES = [
  { key: 'default', label: 'Default', Icon: LayoutDashboard },
  { key: 'tile', label: 'Tile', Icon: LayoutGrid },
  { key: 'list', label: 'List', Icon: List },
] as const;

export function ViewModeSelector({ value, onChange }: Props) {
  const reduced = useReducedMotion();
  const activeIndex = Math.max(0, MODES.findIndex((mode) => mode.key === value));
  return (
    <div
      role="group"
      aria-label="Dashboard view mode"
      style={{ ...controlShell, position: 'relative', display: 'flex', padding: 3, width: 246 }}
    >
      <motion.span
        aria-hidden="true"
        data-testid="view-mode-thumb"
        initial={false}
        animate={{ x: `${activeIndex * 100}%` }}
        transition={reduced ? { duration: 0 } : springPop}
        style={{
          position: 'absolute', top: 3, bottom: 3, left: 3,
          width: 'calc((100% - 6px) / 3)',
          borderRadius: radius.chip, background: accent,
          boxShadow: '0 3px 14px -4px rgba(200, 247, 81, 0.4)',
          pointerEvents: 'none',
        }}
      />
      {MODES.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          style={{
            position: 'relative', flex: '1 1 0', minWidth: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            padding: '5px 7px', minHeight: 28, borderRadius: radius.chip,
            background: 'transparent', color: value === key ? accentInk : textMuted,
            fontSize: type.label, fontFamily: fontSans, fontWeight: 650,
          }}
        >
          <Icon size={13} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
