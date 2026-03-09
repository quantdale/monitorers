// @dnd-kit — modern accessible drag-and-drop library for React.
// Why not react-beautiful-dnd: it is deprecated and unmaintained.
// Three packages used:
//   @dnd-kit/core      — the drag engine (sensors, collision detection, DndContext)
//   @dnd-kit/sortable  — list/grid reordering preset (useSortable, SortableContext, arrayMove)
//   @dnd-kit/utilities — CSS transform helpers (CSS.Transform.toString)

export type ViewMode = 'default' | 'tile' | 'list';

/**
 * Returns min and max of a history slice.
 * Computed from the current windowed slice (what the user can see on the graph),
 * not the full 3600-point buffer — so min/max reflects what is visible.
 */
export function historyMinMax(history: number[]): { min: number; max: number } {
  if (history.length === 0) return { min: 0, max: 0 };
  return {
    min: Math.min(...history),
    max: Math.max(...history),
  };
}

/**
 * Downsample an array to at most maxPoints using stride sampling.
 * Always includes the last element so the chart shows the latest value.
 * Returns the original array if it is already within the limit.
 */
export function downsample(data: number[], maxPoints: number): number[] {
  if (data.length <= maxPoints) return data;
  const stride = Math.ceil(data.length / maxPoints);
  const result: number[] = [];
  for (let i = 0; i < data.length; i += stride) {
    result.push(data[i]);
  }
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1]);
  }
  return result;
}
