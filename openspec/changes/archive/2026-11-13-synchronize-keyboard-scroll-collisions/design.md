## Context

The shared custom keyboard sensor synchronizes movement but invokes DOM scrolling after that synchronization. dnd-kit rectangles expose current ancestor scroll offsets through getters, while collision state updates only when scroll notifications trigger rendering. Probes distinguish this from listener timing, unequal card sizing and decorative transforms.

## Goals / Non-Goals

Goals: one consistent geometry state before another key can act, no fixed-frame waits, both sortable surfaces covered by the shared sensor.

Non-goals: replacing sibling-aware coordinate calculation or changing pointer collision semantics.

## Decisions

After instant keyboard scrolling, subtract the summed actual ancestor scroll delta from the keyboard position and synchronously publish that corrected position. dnd-kit separately compensates the dragging transform for ancestor scroll; the keyboard collision point must move with the target's viewport position. Merely forcing scroll notifications was tested and rejected: it keeps the incorrect coordinate and made the failure more frequent. Avoid delays, bespoke sibling indexing, or retaining a guessed target across geometry changes.

A sensor-boundary test uses real closest-center collision calculation and nested live scroll rectangles, then delivers a scroll notification before Enter. Disabling the correction makes it drop on Disk instead of Memory, deterministically. A browser test executes complete forward/reverse gestures in one task, asserts both intermediate orders and prevents a no-op roundtrip from falsely passing; repeated ordinary keyboard tests also cover actual asynchronous notification ordering.

## Risks / Trade-offs

Sum every scroll ancestor exactly once and correct only when offsets changed. Keeping correction in the keyboard sensor bounds work to keyboard interaction; pointer behavior remains native. Nested scrolling and multiple arrows/cancellation require coverage.
