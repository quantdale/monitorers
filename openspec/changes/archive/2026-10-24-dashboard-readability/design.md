## Context

Refero monitoring dashboards (Weights & Biases system metrics, Stellate metrics, Chargetrip analytics) put the current value, a readable range or scale, and a labeled control on the card or toolbar. They do not hide the only reorder affordance until hover, and an empty chart state offers a next action rather than a stranded sentence.

This product already has the tokens, the chart memo contract, and the sidebar overlay. This change fills the gaps those pieces left, without a second visual system.

## Goals / Non-Goals

**Goals:**

- A sighted pointer user can see how to open hardware info and how to reorder a card without hovering or reading a tooltip.
- Default and tile views show the same window range List view already showed, plus a network peak line so the auto-scaled chart has a number.
- Hiding every card leads back to the selector in one click. Tab does not leave the open selector.

**Non-Goals:**

- Inventing network interface names the hardware profile does not contain.
- Seeding a mock hardware profile. That would make sidebar reorder mock-drivable and change the simulation contract.
- Showing a Y-axis inside Recharts. The peak caption carries the scale without touching tick layout or the chart memo.

## Decisions

1. **Range text lives outside MetricChart.** It is derived from the same window scan List view uses, or from `buildNetworkScaleCaption` for throughput. Live 250ms scalars still do not enter the chart's props.
2. **Disk identity stays the key.** A profile model is a subtitle. The card title remains `Disk C:` so tests and persisted ids do not depend on a display name.
3. **The hardware button's accessible name stays "Show/Hide hardware info".** Visible text is "Hardware". Simulation still finds the control by its title attribute.
4. **Empty-state action clicks the existing trigger.** It does not grow a second selector.

## Risks / Trade-offs

- Always-visible grips add a little noise on every card. That is the point: reorder was undiscoverable. The glyph stays the decorative token color, which already meets the 3:1 floor at full opacity.
- The network peak line updates as the window max moves. It is not inside the chart memo, so it does not remount Recharts.

## Migration Plan

Frontend-only. No settings migration.

## Open Questions

- None.
