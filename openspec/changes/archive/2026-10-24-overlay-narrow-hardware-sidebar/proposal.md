## Why

At the product's 400×300 minimum window, opening the hardware sidebar (a 220px in-flow rail) shrinks the dashboard to about 140px. Disk and GPU cards then overflow their boxes (measured disk-card scrollWidth 230px inside a 138px client box). The same rail at 700px and above leaves every card inside its box. The containment contract was only proven with the rail closed.

## What Changes

- Below 640px the open hardware sidebar is a fixed overlay drawer with a scrim, a named close control, and Escape dismissal. The dashboard keeps the width it has when the rail is closed, so cards do not overflow.
- At 640px and above the rail still pushes the dashboard aside, unchanged.
- Long sidebar model names wrap inside the 220px rail instead of painting out of the card.
- Collapsed-rail accessibility (hidden from the tree and the tab order, width transition preserved) is unchanged.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `dashboard-layout-containment`: the open hardware rail must not make cards overflow at the minimum window.

## Impact

- Frontend only: `App.tsx`, `HardwareSidebar.tsx`, a viewport media query, and the layout constant. No IPC, settings schema, or collector change.
- Simulation's mock lane uses a 900×1100 viewport, so it stays on the push path.
