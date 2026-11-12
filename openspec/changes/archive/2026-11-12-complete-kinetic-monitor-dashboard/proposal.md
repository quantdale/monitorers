## Why

The staging frontend redesign is unfinished: keyboard reorder and short-window metric selection regress, motion is not consistently reduced-motion aware, and several new visual primitives are unused or misleadingly documented. Finish the Refero-informed overhaul without changing collection, IPC, settings, timestamps, history, or hardware identity.

## What Changes

- Complete the dark instrument-panel design across the shell, three dashboard modes, hardware rail/drawer, controls, charts, errors, loading, and empty states.
- Retain a lime action accent, channel-specific series colors, system typography, responsive card tracks, and tactile motion; isolate decorative motion from measured drag geometry and viewport-positioned dialogs.
- Diagnose and regression-test keyboard reorder and selector placement with real browser measurements rather than continuing the earlier speculative property bisection.
- Respect OS reduced-motion preferences, keep charts unanimated, remove dead primitives/experimental commentary, and qualify all existing capabilities through frontend, E2E, simulation, and packaged checks.

## Capabilities

### New Capabilities

- `kinetic-dashboard-presentation`: cohesive, responsive presentation and motion that never compromises monitoring accuracy, immediate interaction, or accessibility.

### Modified Capabilities

- `accessible-ui-feedback`: allow decorative recovery feedback only with reduced-motion support and unchanged live-region/focus behavior, replacing the older blanket prohibition on new motion.

## Impact

React presentation files, global base CSS, design tokens, a lightweight motion dependency, browser regression tests, and OpenSpec documentation. No Rust, payload/schema, collector, persistence, or data-flow changes. Delivery is explicitly authorized to `main`, using a normal non-force push only after validation and final review.
