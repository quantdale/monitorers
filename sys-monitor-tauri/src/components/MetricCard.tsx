import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from 'recharts';

interface Props {
  title: string;
  value: string | React.ReactNode;
  history?: number[];
  color: string;
  yDomain?: [number, number | 'auto'];
  badge?: React.ReactNode;
}

export function MetricCard({
  title,
  value,
  history,
  color,
  yDomain = [0, 100],
  badge,
}: Props) {
  const hasChart = history != null && history.length > 0;
  const data = hasChart ? history.map((v, i) => ({ i, v: Math.max(0, v) })) : [];

  const borderStyle = { border: '1px solid #444', padding: '4px 8px', borderRadius: 4 };

  return (
    <div
      style={{
        background: '#1e1e1e',
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          marginBottom: hasChart ? 6 : 0,
        }}
      >
        <span
          style={{
            color: '#999',
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            ...borderStyle,
          }}
        >
          {title}
        </span>
        {typeof value === 'string' ? (
          <span
            style={{
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: 'monospace',
              ...borderStyle,
            }}
          >
            {value}
          </span>
        ) : (
          value
        )}
        {badge && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
            }}
          >
            {badge}
          </div>
        )}
      </div>
      {hasChart && (
      <ResponsiveContainer width="100%" height={100}>
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <YAxis domain={yDomain} hide />
          <XAxis dataKey="i" hide />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            fill={color}
            fillOpacity={0.15}
            strokeWidth={1.5}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      )}
    </div>
  );
}
