import { controlShell, fontSans, type } from '../design/tokens';

interface Option {
  label: string;
  value: number;
}

interface Props {
  options: Option[];
  value: number;
  onChange: (value: number) => void;
}

export function TimeRangeSelector({ options, value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="History time range"
      style={{
        ...controlShell,
        padding: '5px 10px',
        fontSize: type.label,
        fontWeight: 600,
        fontFamily: fontSans,
        cursor: 'pointer',
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} style={{ background: '#15181E', color: '#F2F4F8' }}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
