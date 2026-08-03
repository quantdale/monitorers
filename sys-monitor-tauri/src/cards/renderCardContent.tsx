import type { ReactNode } from 'react';
import type { ViewMode } from '../utils';
import { gpuId, historyMinMax } from '../utils';
import type { SlicedHistory } from '../hooks/useMetrics';
import { SortableCard } from '../components/SortableCard';
import {
  badgeStyle,
  formatPercent,
  formatResponseMs,
  formatTempC,
  formatThroughput,
  gpuVendorBadgeStyle,
  gpuVendorLabel,
} from './formatters';

const DISK_COLORS = ['#e88246', '#c46be8', '#e8d446', '#46e8d4'];
const GPU_COLORS = ['#64b4ff', '#78c888', '#e8a050', '#c080e0'];

export interface RenderCardContentParams {
  id: string;
  metrics: SlicedHistory;
  viewMode: ViewMode;
  hasNvidiaData: boolean;
}

// Maps a card ID back to the correct SortableCard with its props.
export function renderCardContent({ id, metrics, viewMode, hasNvidiaData }: RenderCardContentParams): ReactNode | null {
  if (id === 'cpu') {
    return (
      <SortableCard
        key={id}
        id={id}
        title={metrics.cpu_name || 'CPU'}
        value={formatPercent(metrics.latestCpu)}
        history={metrics.cpu}
        timestamps={metrics.timestamps}
        color="#4699e8"
        badge={<span style={badgeStyle}>{formatTempC(metrics.cpu_temp_c)}</span>}
        viewMode={viewMode}
      />
    );
  }

  if (id === 'memory') {
    return (
      <SortableCard
        key={id}
        id={id}
        title="Memory"
        value={formatPercent(metrics.mem.at(-1))}
        history={metrics.mem}
        timestamps={metrics.timestamps}
        color="#4ed87a"
        badge={
          <span style={badgeStyle}>
            {`${metrics.mem_used_gb.toFixed(1)} / ${metrics.mem_total_gb.toFixed(1)} GB`}
          </span>
        }
        viewMode={viewMode}
      />
    );
  }

  if (id.startsWith('disk_')) {
    const diskKey = id.slice('disk_'.length);
    const diskIdx = metrics.disks.findIndex(d => d.key === diskKey);
    if (diskIdx === -1) return null;
    const disk = metrics.disks[diskIdx];
    const avgStr = formatResponseMs(disk.avg_response_ms);
    return (
      <SortableCard
        key={id}
        id={id}
        title={`Disk ${disk.key}`}
        value={`Active Time ${formatPercent(disk.values.at(-1))}`}
        history={disk.values}
        timestamps={metrics.timestamps}
        color={DISK_COLORS[diskIdx % DISK_COLORS.length]}
        listViewValue={
          <>
            <span>Active Time {formatPercent(disk.values.at(-1))}</span>
            <span style={{ color: '#888', marginLeft: 4 }}>{avgStr}</span>
          </>
        }
        badge={
          <>
            <span style={badgeStyle}>
              R: {disk.read_mb_s.toFixed(1)} MB/s · W: {disk.write_mb_s.toFixed(1)} MB/s
            </span>
            <span style={badgeStyle}>{formatResponseMs(disk.avg_response_ms)}</span>
            <span style={badgeStyle}>{formatTempC(disk.temp_c)}</span>
          </>
        }
        viewMode={viewMode}
      />
    );
  }

  if (id === 'network') {
    const recv = metrics.net_recv.at(-1) ?? 0;
    const sent = metrics.net_sent.at(-1) ?? 0;
    const { min: rawMinR, max: rawMaxR } = historyMinMax(metrics.net_recv);
    const minR = Math.max(0, rawMinR);
    const maxR = Math.max(0, rawMaxR);
    const { min: rawMinS, max: rawMaxS } = historyMinMax(metrics.net_sent);
    const minS = Math.max(0, rawMinS);
    const maxS = Math.max(0, rawMaxS);
    return (
      <SortableCard
        key={id}
        id={id}
        title="Network"
        value=""
        history={metrics.net_recv}
        secondaryHistory={metrics.net_sent}
        timestamps={metrics.timestamps}
        color="#50d8f0"
        secondaryColor="#e88a50"
        yDomain={[0, 'auto']}
        badge={
          <>
            <span style={{ ...badgeStyle, border: '1px solid rgba(80, 216, 240, 0.55)' }}>↓ {formatThroughput(recv)}</span>
            <span style={{ ...badgeStyle, border: '1px solid rgba(232, 138, 80, 0.55)' }}>↑ {formatThroughput(sent)}</span>
          </>
        }
        listViewValue={
          <>
            <span style={{ border: '1px solid rgba(80, 216, 240, 0.55)', padding: '2px 6px', borderRadius: 4, fontSize: 13, fontFamily: 'monospace', color: '#fff', fontWeight: 600 }}>↓ {formatThroughput(recv)}</span>
            <span style={{ border: '1px solid rgba(232, 138, 80, 0.55)', padding: '2px 6px', borderRadius: 4, fontSize: 13, fontFamily: 'monospace', color: '#fff', fontWeight: 600 }}>↑ {formatThroughput(sent)}</span>
          </>
        }
        listViewMinMax={
          <>
            <span style={{ border: '1px solid rgba(80, 216, 240, 0.55)', padding: '2px 6px', borderRadius: 4, fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
              ↓ {formatThroughput(minR)} – {formatThroughput(maxR)}
            </span>
            <span style={{ border: '1px solid rgba(232, 138, 80, 0.55)', padding: '2px 6px', borderRadius: 4, fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
              ↑ {formatThroughput(minS)} – {formatThroughput(maxS)}
            </span>
          </>
        }
        viewMode={viewMode}
      />
    );
  }

  if (id.startsWith('gpu_')) {
    const gpuIdx = metrics.gpus.findIndex(g => gpuId(g.name) === id);
    if (gpuIdx === -1) return null;
    const gpu = metrics.gpus[gpuIdx];
    const gpuTitle = gpu.name || (gpu.vendor === 'unknown' ? 'Unknown GPU' : 'GPU');
    const showNvmlForThisCard = hasNvidiaData && gpu.vendor === 'nvidia';
    const powerText =
      metrics.nvidia_power_w != null ? `${metrics.nvidia_power_w.toFixed(1)} W` : '—';
    const vramText =
      metrics.nvidia_mem_used_mb != null && metrics.nvidia_mem_total_mb != null
        ? `${metrics.nvidia_mem_used_mb} / ${metrics.nvidia_mem_total_mb} MB`
        : '—';
    const fanText =
      metrics.nvidia_fan_speed_pct != null ? `${metrics.nvidia_fan_speed_pct}%` : '—';
    const clockText =
      metrics.nvidia_clock_mhz != null ? `${metrics.nvidia_clock_mhz} MHz` : '—';
    return (
      <SortableCard
        key={id}
        id={id}
        title={gpuTitle}
        value={formatPercent(gpu.latest)}
        history={gpu.values}
        timestamps={metrics.timestamps}
        color={GPU_COLORS[gpuIdx % GPU_COLORS.length]}
        badge={
          <>
            <span style={gpuVendorBadgeStyle(gpu.vendor)}>
              {gpuVendorLabel(gpu.vendor)}
            </span>
            <span style={badgeStyle}>
              {gpu.temp_c != null ? `${gpu.temp_c.toFixed(1)}°C` : '—'}
            </span>
            {showNvmlForThisCard && (
              <>
                <span style={badgeStyle}>{powerText}</span>
                <span style={badgeStyle}>{vramText}</span>
                <span style={badgeStyle}>{fanText}</span>
                <span style={badgeStyle}>{clockText}</span>
              </>
            )}
          </>
        }
        viewMode={viewMode}
      />
    );
  }

  return null;
}
