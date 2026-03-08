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

function formatKbps(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1)} GB/s`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB/s`;
  return `${kb.toFixed(0)} KB/s`;
}

function formatPercent(v: number | undefined): string {
  return `${(v ?? 0).toFixed(1)}%`;
}

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
            title="CPU"
            value={formatPercent(metrics.cpu.at(-1))}
            history={metrics.cpu}
            color="#4699e8"
          />

          <MetricCard
            title="Memory"
            value={`${formatPercent(metrics.mem.at(-1))}  ${metrics.mem_used_gb.toFixed(1)} / ${metrics.mem_total_gb.toFixed(1)} GB`}
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
            />
          ))}

          <MetricCard
            title="Network ↓ Recv"
            value={formatKbps(metrics.net_recv.at(-1) ?? 0)}
            history={metrics.net_recv}
            color="#50d8f0"
            yDomain={[0, 'auto']}
          />

          <MetricCard
            title="Network ↑ Sent"
            value={formatKbps(metrics.net_sent.at(-1) ?? 0)}
            history={metrics.net_sent}
            color="#f082c8"
            yDomain={[0, 'auto']}
          />

          {metrics.gpus.map((gpu, idx) => (
            <MetricCard
              key={gpu.name}
              title={gpu.name}
              value={formatPercent(gpu.values.at(-1))}
              history={gpu.values}
              color={GPU_COLORS[idx % GPU_COLORS.length]}
            />
          ))}
        </>
      )}
    </div>
  );
}
