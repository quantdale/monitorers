import { KeyboardSensor, PointerSensor, useSensor, useSensors, type KeyboardSensorProps } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { flushSync } from 'react-dom';

/** Keep dnd-kit's sibling-aware coordinates, but commit movement before a
 * subsequent drop. The stock keyboard sensor defers its listener installation
 * and uses a scroll-only path that can drop against stale `over` state.
 * Neither a timeout nor waiting a fixed number of frames makes that reliable.
 */
export class CardKeyboardSensor {
  static activators = KeyboardSensor.activators;
  autoScrollEnabled = false;
  private position = { x: 0, y: 0 };
  private finished = false;
  private document: Document;
  private window: Window;

  constructor(private props: KeyboardSensorProps) {
    this.document = props.activeNode.node.current?.ownerDocument ?? document;
    this.window = this.document.defaultView ?? window;
    // Ignore the activation event itself rather than deferring registration.
    this.document.addEventListener('keydown', this.onKeyDown);
    this.document.addEventListener('visibilitychange', this.onCancel);
    this.window.addEventListener('resize', this.onCancel);
    flushSync(() => props.onStart(this.position));
  }

  private onCancel = () => this.finish(true);

  private finish(cancel: boolean) {
    if (this.finished) return;
    this.finished = true;
    this.document.removeEventListener('keydown', this.onKeyDown);
    this.document.removeEventListener('visibilitychange', this.onCancel);
    this.window.removeEventListener('resize', this.onCancel);
    flushSync(() => cancel ? this.props.onCancel() : this.props.onEnd());
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event === this.props.event || this.finished) return;
    const codes = this.props.options.keyboardCodes;
    if ((codes?.cancel ?? ['Escape']).includes(event.code)) {
      event.preventDefault();
      this.finish(true);
      return;
    }
    if ((codes?.end ?? ['Space', 'Enter', 'Tab']).includes(event.code)) {
      event.preventDefault();
      this.finish(false);
      return;
    }
    const context = this.props.context.current;
    const rect = context.collisionRect;
    if (!rect) return;
    const currentCoordinates = { x: rect.left, y: rect.top };
    const targetId = context.collisions?.[0]?.id;
    const target = targetId == null ? undefined : context.droppableContainers.get(targetId);
    const targetRect = target?.rect.current;
    const next = (this.props.options.coordinateGetter ?? sortableKeyboardCoordinates)(event, {
      active: this.props.active,
      context: {
        ...context,
        // The library publishes `over` in a passive effect. Consecutive keys
        // must see the current collision instead of that lagging state.
        over: target && targetRect ? { id: target.id, data: target.data, disabled: target.disabled, rect: targetRect } : null,
      },
      currentCoordinates,
    });
    if (!next) return;
    event.preventDefault();
    this.position = {
      x: this.position.x + next.x - currentCoordinates.x,
      y: this.position.y + next.y - currentCoordinates.y,
    };
    // Unlike the stock scroll-only path, always publish the actual move first.
    flushSync(() => this.props.onMove(this.position));
    const ancestors = this.props.context.current.scrollableAncestors;
    const before = ancestors.map((element) => ({ x: element.scrollLeft, y: element.scrollTop }));
    this.props.activeNode.node.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    // dnd-kit compensates dragging transforms for ancestor scrolling. Keyboard
    // movement must subtract that same delta so its collision rectangle moves
    // with the scrolled target, rather than staying at the old viewport point.
    const delta = ancestors.reduce((sum, element, index) => ({
      x: sum.x + element.scrollLeft - before[index].x,
      y: sum.y + element.scrollTop - before[index].y,
    }), { x: 0, y: 0 });
    if (delta.x || delta.y) {
      this.position = { x: this.position.x - delta.x, y: this.position.y - delta.y };
      flushSync(() => this.props.onMove(this.position));
    }
  };
}

/** One input policy for dashboard and hardware cards. */
export function useCardSensors() {
  return useSensors(
    useSensor(PointerSensor),
    useSensor(CardKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}
