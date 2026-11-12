import { describe, expect, it } from 'vitest';
import type { DragEndEvent } from '@dnd-kit/core';
import { cardDropTarget } from './cardDropTarget';

const sourceOver = {
  id: 'cpu', disabled: false, data: { current: {} },
  rect: { top: 0, left: 0, bottom: 100, right: 200, width: 200, height: 100 },
};
const event = (type: string, collisions: DragEndEvent['collisions']) => ({
  activatorEvent: new Event(type), over: sourceOver, collisions,
});

describe('cardDropTarget', () => {
  it('uses current keyboard collisions when passive over still names the source', () => {
    expect(cardDropTarget(event('keydown', [{ id: 'memory' }, { id: 'cpu' }]))).toBe('memory');
  });
  it('does not invent a keyboard destination when hardware disappears', () => {
    expect(cardDropTarget(event('keydown', []))).toBeNull();
    expect(cardDropTarget(event('keydown', null))).toBeNull();
  });
  it('keeps pointer over semantics even when collision candidates differ', () => {
    expect(cardDropTarget(event('pointerdown', [{ id: 'memory' }]))).toBe('cpu');
  });
  it('keeps a pointer drop outside all targets a no-op', () => {
    expect(cardDropTarget({ ...event('pointerdown', []), over: null })).toBeNull();
  });
  it('preserves non-string hardware identifiers', () => {
    expect(cardDropTarget(event('keydown', [{ id: 7 }]))).toBe(7);
  });
});
