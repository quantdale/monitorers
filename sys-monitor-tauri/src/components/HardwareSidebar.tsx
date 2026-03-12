import { useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Monitor,
  Network,
} from 'lucide-react';
import type { SlicedHistory } from '../hooks/useMetrics';
import type { HardwareProfile } from '../hooks/useHardwareProfile';
import { useSettings } from '../hooks/useSettings';
import { SortableSidebarCard } from './SortableSidebarCard';

const SIDEBAR_WIDTH = 220;
const cardStyle: React.CSSProperties = {
  background: '#1e1e1e',
  border: '1px solid #444',
  borderRadius: 8,
  padding: 12,
};
const titleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: '#888',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  marginBottom: 8,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 12,
  marginTop: 4,
};
const labelStyle: React.CSSProperties = { color: '#888' };
const valueStyle: React.CSSProperties = { color: '#fff', fontWeight: 500 };

function cpuVendorDisplay(v: string): string {
  const lower = v.toLowerCase();
  if (lower === 'intel') return 'Intel';
  if (lower === 'amd') return 'AMD';
  return 'Unknown';
}

function gpuVendorDisplay(vendor: string): string {
  switch (vendor) {
    case 'Nvidia': return 'NVIDIA';
    case 'Intel': return 'Intel';
    case 'Amd': return 'AMD';
    default: return vendor || 'Unknown';
  }
}

function gpuKindDisplay(kind: string): string {
  switch (kind) {
    case 'Discrete': return 'Discrete (dGPU)';
    case 'Integrated': return 'Integrated (iGPU)';
    default: return kind || 'Unknown';
  }
}

function diskKindDisplay(kind: string): string {
  switch (kind) {
    case 'Ssd': return 'SSD';
    case 'Hdd': return 'HDD';
    case 'Nvme': return 'NVMe';
    default: return kind || 'Unknown';
  }
}

function defaultSidebarCardOrder(profile: HardwareProfile): string[] {
  return [
    'sb_cpu',
    ...profile.gpus.map((_, i) => `sb_gpu_${i}`),
    'sb_memory',
    ...profile.disks.map((_, i) => `sb_disk_${i}`),
    'sb_network',
  ];
}

interface Props {
  open: boolean;
  profile: HardwareProfile | null;
  metrics: SlicedHistory | null;
}

export function HardwareSidebar({ open, profile, metrics }: Props) {
  const { settings, save } = useSettings();

  // Compute ordered list: merge saved order with new cards from profile
  const cardOrder = (() => {
    if (!profile) return [];
    const defaultIds = defaultSidebarCardOrder(profile);
    const current = settings.sidebarCardOrder ?? [];
    if (current.length === 0) return defaultIds;
    const currentSet = new Set(current);
    const hasNew = defaultIds.some((id) => !currentSet.has(id));
    if (!hasNew) return current.filter((id) => defaultIds.includes(id));
    const merged: string[] = [];
    for (const id of current) {
      if (defaultIds.includes(id)) merged.push(id);
    }
    for (const id of defaultIds) {
      if (!merged.includes(id)) merged.push(id);
    }
    return merged;
  })();

  useEffect(() => {
    if (!profile) return;
    const defaultIds = defaultSidebarCardOrder(profile);
    if (settings.sidebarCardOrder === null && defaultIds.length > 0) {
      save({ sidebarCardOrder: defaultIds });
    }
  }, [profile, settings.sidebarCardOrder, save]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = cardOrder.indexOf(active.id as string);
      const newIndex = cardOrder.indexOf(over.id as string);
      if (oldIndex >= 0 && newIndex >= 0) {
        save({ sidebarCardOrder: arrayMove(cardOrder, oldIndex, newIndex) });
      }
    }
  }

  function renderCardContent(id: string, dragHandle: React.ReactNode): React.ReactNode {
    if (!profile) return null;
    if (id === 'sb_cpu') {
      return (
        <div style={cardStyle}>
          <div style={{ ...titleStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
            {dragHandle}
            <Cpu size={14} color="#888" />
            Processor
          </div>
          <div style={{ borderTop: '1px solid #333', paddingTop: 8 }}>
            <div style={{ marginBottom: 6 }}>
              <div style={{ color: '#888', fontSize: 11, marginBottom: 2 }}>Model</div>
              <div style={{ color: '#fff', fontSize: 12, fontWeight: 600, wordBreak: 'break-word', lineHeight: 1.4 }}>
                {profile.cpu_name}
              </div>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>Vendor</span>
              <span style={valueStyle}>{cpuVendorDisplay(profile.cpu_vendor)}</span>
            </div>
          </div>
        </div>
      );
    }
    if (id.startsWith('sb_gpu_')) {
      const idx = parseInt(id.replace('sb_gpu_', ''), 10);
      const gpu = profile.gpus[idx];
      if (!gpu) return null;
      return (
        <div style={cardStyle}>
          <div style={{ ...titleStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
            {dragHandle}
            <Monitor size={14} color="#888" />
            {profile.gpus.length > 1 ? `Graphics (${idx + 1} of ${profile.gpus.length})` : 'Graphics'}
          </div>
          <div style={{ borderTop: '1px solid #333', paddingTop: 8 }}>
            <div style={rowStyle}>
              <span style={labelStyle}>Name</span>
              <span style={{ ...valueStyle, maxWidth: '60%', textAlign: 'right' }}>{gpu.name}</span>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>Vendor</span>
              <span style={valueStyle}>{gpuVendorDisplay(gpu.vendor)}</span>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>Type</span>
              <span style={valueStyle}>{gpuKindDisplay(gpu.kind)}</span>
            </div>
          </div>
        </div>
      );
    }
    if (id === 'sb_memory') {
      return (
        <div style={cardStyle}>
          <div style={{ ...titleStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
            {dragHandle}
            <MemoryStick size={14} color="#888" />
            Memory
          </div>
          <div style={{ borderTop: '1px solid #333', paddingTop: 8 }}>
            <div style={rowStyle}>
              <span style={labelStyle}>Total RAM</span>
              <span style={valueStyle}>
                {metrics != null && metrics.mem_total_gb != null && Number.isFinite(metrics.mem_total_gb)
                  ? `${metrics.mem_total_gb.toFixed(1)} GB`
                  : '—'}
              </span>
            </div>
          </div>
        </div>
      );
    }
    if (id.startsWith('sb_disk_')) {
      const idx = parseInt(id.replace('sb_disk_', ''), 10);
      const disk = profile.disks[idx];
      if (!disk) return null;
      return (
        <div style={cardStyle}>
          <div style={{ ...titleStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
            {dragHandle}
            <HardDrive size={14} color="#888" />
            Storage
          </div>
          <div style={{ borderTop: '1px solid #333', paddingTop: 8 }}>
            <div style={rowStyle}>
              <span style={labelStyle}>Name</span>
              <span style={{ ...valueStyle, maxWidth: '60%', textAlign: 'right' }}>{disk.name}</span>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>Type</span>
              <span style={valueStyle}>{diskKindDisplay(disk.kind)}</span>
            </div>
          </div>
        </div>
      );
    }
    if (id === 'sb_network') {
      return (
        <div style={cardStyle}>
          <div style={{ ...titleStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
            {dragHandle}
            <Network size={14} color="#888" />
            Network
          </div>
          <div style={{ borderTop: '1px solid #333', paddingTop: 8 }}>
            <div style={rowStyle}>
              <span style={labelStyle}>Interface</span>
              <span style={valueStyle}>Monitoring active interface</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div
      style={{
        width: open ? SIDEBAR_WIDTH : 0,
        flexShrink: 0,
        overflow: 'hidden',
        transition: 'width 250ms ease',
        background: '#0f0f0f',
        borderRight: open ? '1px solid #444' : 'none',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          width: SIDEBAR_WIDTH,
          minHeight: 0,
          overflowY: 'auto',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {profile === null ? (
          <div style={{ color: '#666', fontSize: 12, padding: 8 }}>
            Detecting hardware…
          </div>
        ) : (
          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={cardOrder} strategy={verticalListSortingStrategy}>
              {cardOrder.map((id) => (
                <SortableSidebarCard key={id} id={id}>
                  {(dragHandle) => renderCardContent(id, dragHandle)}
                </SortableSidebarCard>
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
