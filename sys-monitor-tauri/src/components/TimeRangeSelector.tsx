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
    <div
      style={{
        display: 'flex',
        gap: 6,
        marginBottom: 12,
        flexWrap: 'wrap',
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
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
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
