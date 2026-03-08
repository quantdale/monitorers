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
        outline: 'none',
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} style={{ background: '#1e1e1e', color: '#fff' }}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
