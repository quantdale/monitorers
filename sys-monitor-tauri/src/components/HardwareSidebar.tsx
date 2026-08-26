import { memo, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Monitor,
  Network,
} from 'lucide-react';
import type { HardwareProfile, HardwareProfileState } from '../hooks/useHardwareProfile';
import { useSettings } from '../hooks/useSettings';
import { SortableSidebarCard } from './SortableSidebarCard';
import { formatGigabytes } from '../cards/formatters';

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

export function defaultSidebarCardOrder(profile: HardwareProfile): string[] {
  return [
    'sb_cpu',
    ...profile.gpus.map((gpu) => `sb_gpu_${gpu.key}`),
    'sb_memory',
    ...profile.disks.map((disk) => `sb_disk_${disk.key}`),
    'sb_network',
  ];
}

/**
 * Merge a saved sidebar card order with the current default ids.
 * IDs are keyed by the backend's stable hardware identity. Legacy positional
 * ids cannot be mapped safely after enumeration reordering, so they are
 * discarded and the current stable ids are appended in deterministic profile
 * order rather than attaching an old position to a different device.
 */
export function migrateLegacySidebarCardOrder(current: string[], profile: HardwareProfile): string[] {
  void profile;
  return current.filter((id) => !/^sb_(?:gpu|disk)_\d+$/.test(id));
}

export function mergeSidebarCardOrder(
  current: string[],
  defaultIds: string[],
  profile?: HardwareProfile
): string[] {
  const migrated = profile ? migrateLegacySidebarCardOrder(current, profile) : current;
  if (migrated.length === 0) return defaultIds;
  const currentSet = new Set(migrated);
  const hasNew = defaultIds.some((id) => !currentSet.has(id));
  if (!hasNew) return migrated.filter((id) => defaultIds.includes(id));
  const merged: string[] = [];
  for (const id of migrated) {
    if (defaultIds.includes(id)) merged.push(id);
  }
  for (const id of defaultIds) {
    if (!merged.includes(id)) merged.push(id);
  }
  return merged;
}

interface Props {
  open: boolean;
  profileState?: HardwareProfileState;
  /** Kept for focused component tests and embedders that already have a profile. */
  profile?: HardwareProfile | null;
  /** The single metrics-derived value this sidebar shows (memory card's total
   *  RAM). Passing the scalar instead of the whole SlicedHistory keeps the
   *  memoized sidebar from re-rendering on every metrics tick. */
  memTotalGb?: number | null;
}

// Memoized: App re-renders every metrics tick, but every prop here is a
// primitive or a stable object (profileState is useMemo'd in
// useHardwareProfile), so the whole sidebar subtree skips those renders.
export const HardwareSidebar = memo(function HardwareSidebar({ open, profileState, profile: suppliedProfile, memTotalGb }: Props) {
  const { settings, save } = useSettings();
  const profile = suppliedProfile !== undefined ? suppliedProfile : profileState?.profile ?? null;
  const loading = suppliedProfile === undefined ? profileState?.loading ?? false : profile === null;
  const profileError = suppliedProfile === undefined ? profileState?.error ?? null : null;

  // Compute ordered list: merge saved order with new cards from profile
  const cardOrder = profile
    ? mergeSidebarCardOrder(settings.sidebarCardOrder ?? [], defaultSidebarCardOrder(profile), profile)
    : [];

  useEffect(() => {
    if (!profile) return;
    const defaultIds = defaultSidebarCardOrder(profile);
    if (defaultIds.length > 0) {
      const migrated = migrateLegacySidebarCardOrder(settings.sidebarCardOrder ?? [], profile);
      const next = mergeSidebarCardOrder(migrated, defaultIds);
      if (settings.sidebarCardOrder === null || next.join('|') !== settings.sidebarCardOrder.join('|')) {
        save({ sidebarCardOrder: next });
      }
    }
  }, [profile, settings.sidebarCardOrder, save]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
      const key = id.slice('sb_gpu_'.length);
      const gpu = profile.gpus.find((entry) => entry.key === key);
      if (!gpu) return null;
      const idx = profile.gpus.findIndex((entry) => entry.key === key);
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
                {memTotalGb != null && formatGigabytes(memTotalGb) !== '—'
                  ? `${formatGigabytes(memTotalGb)} GB`
                  : '—'}
              </span>
            </div>
          </div>
        </div>
      );
    }
    if (id.startsWith('sb_disk_')) {
      const key = id.slice('sb_disk_'.length);
      const disk = profile.disks.find((entry) => entry.key === key);
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
      id="hardware-sidebar"
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
        {profileError && (
          <div role="alert" style={{ color: '#ffd6d3', fontSize: 12, padding: 8 }}>
            <div>Hardware detection failed — {profileError}</div>
            {profileState && <button type="button" onClick={profileState.retry} style={{ marginTop: 8 }}>Retry</button>}
          </div>
        )}
        {profile === null && loading ? (
          <div role="status" aria-live="polite" style={{ color: '#888', fontSize: 12, padding: 8 }}>
            Detecting hardware…
          </div>
        ) : profile === null ? (
          <div role="status" style={{ color: '#888', fontSize: 12, padding: 8 }}>
            No hardware profile is available yet.
          </div>
        ) : profile !== null ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={cardOrder} strategy={verticalListSortingStrategy}>
              {cardOrder.map((id) => (
                <SortableSidebarCard key={id} id={id}>
                  {(dragHandle) => renderCardContent(id, dragHandle)}
                </SortableSidebarCard>
              ))}
            </SortableContext>
          </DndContext>
        ) : null}
      </div>
    </div>
  );
});
