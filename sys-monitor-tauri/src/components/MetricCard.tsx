import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from 'recharts';

interface Props {
  title: string;
  value: string;
  history: number[];
  color: string;
  yDomain?: [number, number | 'auto'];
}

export function MetricCard({
  title,
  value,
  history,
  color,
  yDomain = [0, 100],
}: Props) {
  const data = history.map((v, i) => ({ i, v }));

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
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
        }}
      >
        <span style={{ color: '#999', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {title}
        </span>
        <span style={{ color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}>
          {value}
        </span>
      </div>
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
    </div>
  );
}
