## Why

The existing keyboard scroll/drop regression fails intermittently (7/60 stress attempts). Instrumentation shows droppable rectangles moving with a real ancestor scroll while the collision rectangle still represents the previous scroll offset; immediate Enter can therefore drop onto the source.

## What Changes

- Synchronize keyboard-induced ancestor scroll offsets with collision calculation before accepting the next key.
- Add a deterministic delayed-scroll-notification regression and repeat real keyboard round trips.
- Preserve sibling-aware movement, instant scrolling, pointer semantics, cancellation and both sortable surfaces.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `keyboard-accessible-drag-reorder`: scrolling during keyboard movement cannot leave collision state stale at immediate drop.

## Impact

Shared keyboard sensor and browser interaction tests. No visual redesign, dependencies, persisted shape, or collector changes.
