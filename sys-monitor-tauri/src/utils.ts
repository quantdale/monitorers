// @dnd-kit — modern accessible drag-and-drop library for React.
// Why not react-beautiful-dnd: it is deprecated and unmaintained.
// Three packages used:
//   @dnd-kit/core      — the drag engine (sensors, collision detection, DndContext)
//   @dnd-kit/sortable  — list/grid reordering preset (useSortable, SortableContext, arrayMove)
//   @dnd-kit/utilities — CSS transform helpers (CSS.Transform.toString)

export type ViewMode = 'default' | 'tile' | 'list';
import type { MetricValue } from './types/metrics';

/** True when running inside the Tauri shell (vs. a plain browser/mock-data context). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
}

/** Stable slug for GPU card ID from display name (e.g. "GeForce RTX 4050" → "gpu_geforce_rtx_4050"). */
export function gpuId(name: string): string {
  return 'gpu_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Returns min and max of a history slice.
 * Computed from the current windowed slice (what the user can see on the graph),
 * not the full 3600-point buffer — so min/max reflects what is visible.
 */
export function historyMinMax(history: MetricValue[]): { min: number; max: number } {
  const finite = history.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (finite.length === 0) return { min: 0, max: 0 };
  return {
    min: Math.min(...finite),
    max: Math.max(...finite),
  };
}
