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
