import { useState } from 'react';
import { useMetrics } from './hooks/useMetrics';
import { MetricCard } from './components/MetricCard';
import { TimeRangeSelector } from './components/TimeRangeSelector';

const TIME_OPTIONS = [
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
  { label: '10m', value: 600 },
  { label: '30m', value: 1800 },
  { label: '1h', value: 3600 },
];

const DISK_COLORS = ['#e88246', '#c46be8', '#e8d446', '#46e8d4'];
const GPU_COLORS = ['#64b4ff', '#78c888', '#e8a050', '#c080e0'];

function formatThroughput(kb: number): string {
  if (kb >= 1000 * 1000) return `${(kb / 1e6).toFixed(1)} GB/s`;
  if (kb >= 1000) return `${(kb / 1000).toFixed(1)} MB/s`;
  return `${kb.toFixed(0)} KB/s`;
}

function formatPercent(v: number | undefined): string {
  const x = Math.max(0, v ?? 0);
  return `${x.toFixed(1)}%`;
}

function formatTempC(temp: number | null | undefined): string {
  if (temp == null || Number.isNaN(temp)) return '— °C';
  return `${Math.round(temp)} °C`;
}

const badgeStyle: React.CSSProperties = {
  border: '1px solid #444',
  padding: '4px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: 'monospace',
  color: '#aaa',
};

export default function App() {
  const [windowSecs, setWindowSecs] = useState(60);
  const metrics = useMetrics(windowSecs);

  return (
    <div
      style={{
        background: '#141414',
        minHeight: '100vh',
        padding: '12px 16px',
        overflowY: 'auto',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: '#fff',
      }}
    >
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0' }}>
          System Monitor
        </span>
      </div>

      <div style={{ marginBottom: 8 }}>
        <TimeRangeSelector
          options={TIME_OPTIONS}
          value={windowSecs}
          onChange={setWindowSecs}
        />
      </div>

      {!metrics ? (
        <div
          style={{
            color: '#666',
            padding: '32px 0',
            textAlign: 'center',
            fontSize: 14,
          }}
        >
          Collecting metrics…
        </div>
      ) : (
        <>
          <MetricCard
            title={metrics.cpu_name || 'CPU'}
            value={formatPercent(metrics.cpu.at(-1))}
            history={metrics.cpu}
            color="#4699e8"
            badge={<span style={badgeStyle}>{formatTempC(metrics.cpu_temp_c)}</span>}
          />

          <MetricCard
            title="Memory"
            value={
              <>
                <span
                  style={{
                    border: '1px solid #444',
                    padding: '4px 8px',
                    borderRadius: 4,
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: 'monospace',
                  }}
                >
                  {formatPercent(metrics.mem.at(-1))}
                </span>
                <span
                  style={{
                    border: '1px solid #444',
                    padding: '4px 8px',
                    borderRadius: 4,
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: 'monospace',
                  }}
                >
                  {`${metrics.mem_used_gb.toFixed(1)} / ${metrics.mem_total_gb.toFixed(1)} GB`}
                </span>
              </>
            }
            history={metrics.mem}
            color="#4ed87a"
          />

          {metrics.disks.map((disk, idx) => (
            <MetricCard
              key={disk.key}
              title={`Disk ${disk.key} — Active Time`}
              value={formatPercent(disk.values.at(-1))}
              history={disk.values}
              color={DISK_COLORS[idx % DISK_COLORS.length]}
              badge={
                <>
                  <span style={badgeStyle}>
                    R: {disk.read_mb_s.toFixed(1)} MB/s · W: {disk.write_mb_s.toFixed(1)} MB/s
                  </span>
                  <span style={badgeStyle}>{formatTempC(disk.temp_c)}</span>
                </>
              }
            />
          ))}

          <MetricCard
            title="Network"
            value={formatThroughput(metrics.net_recv.at(-1) ?? 0)}
            history={metrics.net_recv}
            color="#50d8f0"
            yDomain={[0, 'auto']}
            badge={
              <span style={badgeStyle}>
                ↓ {formatThroughput(metrics.net_recv.at(-1) ?? 0)} · ↑ {formatThroughput(metrics.net_sent.at(-1) ?? 0)}
              </span>
            }
          />

          {metrics.gpus.map((gpu, idx) => (
            <MetricCard
              key={gpu.name}
              title={gpu.name}
              value={formatPercent(gpu.values.at(-1))}
              history={gpu.values}
              color={GPU_COLORS[idx % GPU_COLORS.length]}
              badge={<span style={badgeStyle}>{formatTempC(gpu.temp_c)}</span>}
            />
          ))}
        </>
      )}
    </div>
  );
}
