import type { ReactNode } from 'react';
import type { ViewMode } from '../utils';
import { historyMinMax } from '../utils';
import type { SlicedHistory } from '../hooks/useMetrics';
import { SortableCard } from '../components/SortableCard';
import {
  badgeStyle,
  formatPercent,
  formatGigabytes,
  formatCompactTempC,
  formatFanPercent,
  formatMegabytes,
  formatMegabytesPerSecond,
  formatMegahertz,
  formatResponseMs,
  formatTempC,
  formatThroughput,
  formatWatts,
  gpuVendorBadgeStyle,
  gpuVendorLabel,
} from './formatters';
import { buildNetworkScaleCaption } from './chartLabels';
import {
  cpuSeries,
  diskSeries,
  gpuSeries,
  memorySeries,
  netDownSeries,
  netUpSeries,
  textMuted,
} from '../design/tokens';

/** Hoisted so the network card passes an identity-stable yDomain to the
 * memoized MetricChart (see MetricChart.tsx for why this matters). */
const Y_DOMAIN_AUTO: [number, 'auto'] = [0, 'auto'];

export interface RenderCardContentParams {
  id: string;
  metrics: SlicedHistory;
  viewMode: ViewMode;
  hasNvidiaData: boolean;
  /** Profile display names keyed by stable disk key. Presentation only. */
  diskNames?: ReadonlyMap<string, string>;
}

// Maps a card ID back to the correct SortableCard with its props.
export function renderCardContent({ id, metrics, viewMode, hasNvidiaData, diskNames }: RenderCardContentParams): ReactNode | null {
  if (id === 'cpu') {
    return (
      <SortableCard
        key={id}
        id={id}
        title={metrics.cpu_name || 'CPU'}
        value={formatPercent(metrics.latestCpu)}
        history={metrics.cpu}
        timestamps={metrics.timestamps}
        color={cpuSeries}
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
        color={memorySeries}
        badge={
          <span style={badgeStyle}>
            {`${formatGigabytes(metrics.mem_used_gb)} / ${formatGigabytes(metrics.mem_total_gb)} GB`}
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
    const diskModel = diskNames?.get(disk.key);
    return (
      <SortableCard
        key={id}
        id={id}
        title={`Disk ${disk.key}`}
        subtitle={diskModel !== disk.key && diskModel !== `Disk ${disk.key}` ? diskModel : undefined}
        valueLabel="Active Time"
        value={formatPercent(disk.values.at(-1))}
        history={disk.values}
        timestamps={metrics.timestamps}
        color={diskSeries[diskIdx % diskSeries.length]}
        listViewValue={
          <>
            <span>Active Time {formatPercent(disk.values.at(-1))}</span>
            <span style={{ color: textMuted, marginLeft: 4 }}>{avgStr}</span>
          </>
        }
        badge={
          <>
            <span style={badgeStyle}>
              R: {formatMegabytesPerSecond(disk.read_mb_s)} MB/s · W: {formatMegabytesPerSecond(disk.write_mb_s)} MB/s
            </span>
            <span style={badgeStyle}>{formatResponseMs(disk.avg_response_ms)}</span>
          </>
        }
        viewMode={viewMode}
      />
    );
  }

  if (id === 'network') {
    const recv = metrics.net_recv.at(-1);
    const sent = metrics.net_sent.at(-1);
    const { min: rawMinR, max: rawMaxR } = historyMinMax(metrics.net_recv);
    const hasDown = metrics.net_recv.some(Number.isFinite);
    const minR = hasDown ? Math.max(0, rawMinR) : Number.NaN;
    const maxR = hasDown ? Math.max(0, rawMaxR) : Number.NaN;
    const { min: rawMinS, max: rawMaxS } = historyMinMax(metrics.net_sent);
    const hasUp = metrics.net_sent.some(Number.isFinite);
    const minS = hasUp ? Math.max(0, rawMinS) : Number.NaN;
    const maxS = hasUp ? Math.max(0, rawMaxS) : Number.NaN;
    return (
      <SortableCard
        key={id}
        id={id}
        title="Network"
        // Download is the chart's primary series. An empty value left this
        // card as the only one without a glance numeral — the rates lived
        // only in corner badges. The label names the direction so the number
        // is not mistaken for a combined total; the colored badges stay as
        // the two-series legend.
        valueLabel="Down"
        value={formatThroughput(recv)}
        history={metrics.net_recv}
        secondaryHistory={metrics.net_sent}
        timestamps={metrics.timestamps}
        color={netDownSeries}
        secondaryColor={netUpSeries}
        yDomain={Y_DOMAIN_AUTO}
        rangeCaption={buildNetworkScaleCaption(maxR, maxS)}
        badge={
          <>
            <span style={{ ...badgeStyle, border: `1px solid ${netDownSeries}66` }}>↓ {formatThroughput(recv)}</span>
            <span style={{ ...badgeStyle, border: `1px solid ${netUpSeries}66` }}>↑ {formatThroughput(sent)}</span>
          </>
        }
        listViewValue={
          <>
            <span style={{ ...badgeStyle, border: `1px solid ${netDownSeries}66` }}>↓ {formatThroughput(recv)}</span>
            <span style={{ ...badgeStyle, border: `1px solid ${netUpSeries}66` }}>↑ {formatThroughput(sent)}</span>
          </>
        }
        listViewMinMax={
          <>
            <span style={{ ...badgeStyle, border: `1px solid ${netDownSeries}66` }}>
              ↓ {formatThroughput(minR)} – {formatThroughput(maxR)}
            </span>
            <span style={{ ...badgeStyle, border: `1px solid ${netUpSeries}66` }}>
              ↑ {formatThroughput(minS)} – {formatThroughput(maxS)}
            </span>
          </>
        }
        viewMode={viewMode}
      />
    );
  }

  if (id.startsWith('gpu_')) {
    const gpuIdx = metrics.gpus.findIndex(g => `gpu_${g.key}` === id);
    if (gpuIdx === -1) return null;
    const gpu = metrics.gpus[gpuIdx];
    const gpuTitle = gpu.name || (gpu.vendor === 'unknown' ? 'Unknown GPU' : 'GPU');
    const showNvmlForThisCard = hasNvidiaData && gpu.vendor === 'nvidia' && gpu.nvidia != null;
    const telemetry = gpu.nvidia;
    const powerText = formatWatts(telemetry?.power_w);
    const vramText =
      telemetry?.mem_used_mb != null && telemetry.mem_total_mb != null &&
      Number.isFinite(telemetry.mem_used_mb) && Number.isFinite(telemetry.mem_total_mb) &&
      telemetry.mem_used_mb >= 0 && telemetry.mem_total_mb >= 0
        ? `${formatMegabytes(telemetry.mem_used_mb)} / ${formatMegabytes(telemetry.mem_total_mb)} MB`
        : '—';
    const fanText = formatFanPercent(telemetry?.fan_speed_pct);
    const clockText = formatMegahertz(telemetry?.clock_mhz);
    return (
      <SortableCard
        key={id}
        id={id}
        title={gpuTitle}
        value={formatPercent(gpu.latest)}
        history={gpu.values}
        timestamps={metrics.timestamps}
        color={gpuSeries[gpuIdx % gpuSeries.length]}
        badge={
          <>
            <span style={gpuVendorBadgeStyle(gpu.vendor)}>
              {gpuVendorLabel(gpu.vendor)}
            </span>
            <span style={badgeStyle}>
              {formatCompactTempC(gpu.temp_c)}
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
