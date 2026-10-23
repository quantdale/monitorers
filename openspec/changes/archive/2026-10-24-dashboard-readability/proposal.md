## Why

The narrow-window sidebar crush was fixed, but the dashboard still hid the things a person needs in order to use it. Reorder handles were invisible until hover. The hardware control was an unlabeled icon. Default and tile charts had no readable window range, and the network chart had no scale at all. Hiding every card left a sentence instead of an action.

## What Changes

- The hardware toggle shows the word Hardware and meets a 32px target, without changing its accessible name.
- Dashboard reorder handles stay visible at rest. Keyboard focus still shows the focus ring.
- Default and tile percent cards show the window min/max. The network card shows peak down and peak up, because its chart has no Y-axis.
- The all-hidden state is a card with a Choose metrics action that opens the existing selector. Collecting metrics explains the wait and reserves card-shaped placeholders.
- The metrics dialog has a visible heading and traps Tab inside the panel.
- The hardware rail has a Hardware heading in both presentations. Its network row no longer claims an interface the host does not report. When a hardware profile has a disk model, the matching dashboard card shows it under the stable disk key.

## Capabilities

### Modified Capabilities

- `keyboard-accessible-drag-reorder`: handles are visible at rest, not only on hover or focus.
- `accessible-ui-feedback`: the all-hidden state is actionable, and the metrics dialog keeps Tab inside itself.

## Impact

Frontend only. Card ids, chart semantics, and the sidebar overlay breakpoint are unchanged. The mock harness still has no hardware profile, so sidebar cards stay absent there.
