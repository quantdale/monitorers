import { Clock3, ChevronDown } from 'lucide-react';
import type { Ref } from 'react';
import { accent, controlShell, fontSans, surface, textMuted, textPrimary, type } from '../design/tokens';

interface Option {
  label: string;
  value: number;
}

interface Props {
  options: Option[];
  value: number;
  onChange: (value: number) => void;
  selectRef?: Ref<HTMLSelectElement>;
}

/** Keep the native select's keyboard, typeahead and automation semantics. */
export function TimeRangeSelector({ options, value, onChange, selectRef }: Props) {
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <Clock3 size={13} aria-hidden="true" style={{ position: 'absolute', left: 10, color: textMuted, pointerEvents: 'none' }} />
      <select
        ref={selectRef}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="History time range"
        style={{
          ...controlShell,
          padding: '7px 28px', minHeight: 36,
          fontSize: type.label, fontWeight: 650, fontFamily: fontSans,
          fontVariantNumeric: 'tabular-nums', cursor: 'pointer', appearance: 'none',
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} style={{ background: surface, color: textPrimary }}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} aria-hidden="true" style={{ position: 'absolute', right: 9, color: accent, pointerEvents: 'none' }} />
    </div>
  );
}
