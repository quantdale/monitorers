import type { CSSProperties } from 'react';

export function formatThroughput(kb: number): string {
  if (!Number.isFinite(kb)) return '—';
  if (kb >= 1000 * 1000) return `${(kb / 1e6).toFixed(1)} GB/s`;
  if (kb >= 1000) return `${(kb / 1000).toFixed(1)} MB/s`;
  return `${kb.toFixed(0)} KB/s`;
}

export function formatPercent(v: number | undefined): string {
  const x = Math.max(0, v ?? 0);
  if (!Number.isFinite(x)) return '—%';
  return `${x.toFixed(1)}%`;
}

export function formatTempC(temp: number | null | undefined): string {
  if (temp == null || Number.isNaN(temp)) return '— °C';
  return `${Math.round(temp)} °C`;
}

export function formatResponseMs(ms: number): string {
  if (!ms || ms <= 0 || !isFinite(ms)) return 'Avg: —';
  if (ms < 10) return `Avg: ${ms.toFixed(1)} ms`;
  return `Avg: ${Math.round(ms)} ms`;
}

/** Human-readable label for card ids that do not resolve to a known metric. */
export function fallbackCardLabel(id: string): string {
  return id
    .replace(/^(gpu|disk|net)_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function gpuVendorLabel(vendor: string): string {
  if (vendor === 'nvidia') return 'NVIDIA';
  if (vendor === 'intel') return 'Intel';
  if (vendor === 'amd') return 'AMD';
  return 'GPU';
}

export const badgeStyle: CSSProperties = {
  border: '1px solid #444',
  padding: '4px 8px',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'monospace',
  color: '#fff',
  fontWeight: 600,
};

export function gpuVendorBadgeStyle(vendor: string): CSSProperties {
  let border = '#555';
  let background = 'rgba(255,255,255,0.04)';
  let color = '#ddd';
  if (vendor === 'nvidia') {
    border = 'rgba(46, 204, 113, 0.7)';
    background = 'rgba(46, 204, 113, 0.08)';
    color = '#c8f7c5';
  } else if (vendor === 'intel') {
    border = 'rgba(52, 152, 219, 0.7)';
    background = 'rgba(52, 152, 219, 0.08)';
    color = '#d0e9ff';
  } else if (vendor === 'amd') {
    border = 'rgba(231, 76, 60, 0.7)';
    background = 'rgba(231, 76, 60, 0.08)';
    color = '#ffd6d3';
  }
  return {
    ...badgeStyle,
    border,
    background,
    color,
  };
}
