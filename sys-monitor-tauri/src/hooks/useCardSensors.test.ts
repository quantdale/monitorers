import { describe, expect, it } from 'vitest';
import { closestCenter, type Collision, type KeyboardSensorProps } from '@dnd-kit/core';
import { CardKeyboardSensor } from './useCardSensors';

describe('keyboard scroll geometry', () => {
  it('drops onto the intended sibling after nested ancestors scroll', () => {
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    const node = document.createElement('div');
    outer.append(inner);
    inner.append(node);
    document.body.append(outer);
    const rect = (top: number) => ({ top, bottom: top + 300, left: 0, right: 860, width: 860, height: 300 });
    const ids = ['cpu', 'memory', 'disk'];
    const droppables = ids.map((id) => ({ id }));
    // Model the library's live rectangle getters: scrolling takes effect
    // immediately even before the native scroll notification is dispatched.
    const droppableRects = new Map(ids.map((id, index) => [id, {
      get top() { return 123 + index * 314 - outer.scrollTop - inner.scrollTop; },
      get bottom() { return this.top + 300; },
      left: 0, right: 860, width: 860, height: 300,
    }]));
    const context = { current: {
      collisionRect: rect(123),
      scrollableAncestors: [inner, outer],
      droppableContainers: new Map(),
      collisions: [{ id: 'cpu' }] as Collision[],
    } };
    const updateCollisions = () => {
      context.current.collisions = closestCenter({
        active: { id: 'cpu' },
        collisionRect: context.current.collisionRect,
        droppableRects,
        droppableContainers: droppables,
        pointerCoordinates: null,
      } as Parameters<typeof closestCenter>[0]);
    };
    inner.addEventListener('scroll', updateCollisions);
    let droppedOn: string | number | undefined;
    node.scrollIntoView = () => { outer.scrollTop = 200; inner.scrollTop = 39; };
    const props = {
      active: { id: 'cpu' },
      activeNode: { node: { current: node } },
      event: new KeyboardEvent('keydown', { code: 'Space' }),
      context,
      options: { coordinateGetter: () => ({ x: 0, y: 437 }) },
      onStart: () => undefined,
      onCancel: () => undefined,
      onMove: (position: { x: number; y: number }) => {
        context.current.collisionRect = rect(123 + position.y);
        updateCollisions();
      },
      onEnd: () => { droppedOn = context.current.collisions[0]?.id; },
    } as unknown as KeyboardSensorProps;
    new CardKeyboardSensor(props);
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown' }));
      // Deliver the queued notification before Enter: the old sensor now
      // recomputes collisions against scrolled rectangles at the old point.
      inner.dispatchEvent(new Event('scroll'));
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
      expect(outer.scrollTop + inner.scrollTop).toBe(239);
      expect(droppedOn).toBe('memory');
    } finally {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      outer.remove();
    }
  });
});
