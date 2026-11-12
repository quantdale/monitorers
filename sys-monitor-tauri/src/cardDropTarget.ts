import type { DragEndEvent, UniqueIdentifier } from '@dnd-kit/core';

/** Keyboard movement commits collision geometry synchronously; dnd-kit's
 * `over` state is published by a later React effect and can still name the
 * source on an immediate Enter. Use the current collision result for keyboard
 * drops. Pointer drops retain the library's existing `over` semantics.
 */
export function cardDropTarget({ activatorEvent, collisions, over }: Pick<DragEndEvent, 'activatorEvent' | 'collisions' | 'over'>): UniqueIdentifier | null {
  return activatorEvent.type === 'keydown'
    ? collisions?.[0]?.id ?? null
    : over?.id ?? null;
}
