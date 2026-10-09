## Context

See proposal.md for why the axis is the change. `MetricChart` already receives committed chart points and a `showTimeAxis` flag. Default and Tile pass `true`; List passes `false`. The y-axis is `hide`d. Tick styling is `tick={{ fontSize: 10 }}` with no fill, and the axis margin is `{ top: 2, right: 0, bottom: 0, left: 0 }`, so a 10px label has no room inside the SVG. The chart body is memoized on its props; live 250 ms scalars must not become a prop of that body.

The Vite mock seeds about 300 one-second points. Selecting a 30-minute or 1-hour window does not paint a span that long. Long-span behavior has to be proven on a pure function, not by waiting.

## Goals / Non-Goals

**Goals:**

- Explicit tick fill and axis stroke that meet the spec's contrast floors on the Default/Tile card surface (`#1e1e1e`).
- A pure tick formatter keyed on the visible span, plus enough tick gap and bottom margin that labels cannot collide or clip.
- Tests that lock those facts without a new simulation API and without defeating the chart memo.

**Non-Goals:**

- Showing the y-axis, changing `[0, 100]` or the network `[0, auto]` domain, or adding gridlines.
- Pinning the toolbar, restyling badges, renaming view modes, or extracting a token file.
- Seeding a longer mock ring so Playwright can wait out a one-hour span.

## Decisions

### 1. Reuse the existing grays; do not add a palette

Tick text uses `#888`, the muted text color already required to clear 4.5:1 on these near-black surfaces. The axis stroke uses `#7a7a7a`, the non-text gray already measured at 3.88:1 on `#1e1e1e`. Both are set on the axis (`tick.fill`, `stroke`), not left to the library default and not introduced as new tokens.

Alternative considered: keep the library default and only add `minTickGap`. Rejected — the default is the contrast defect, and an unspecified fill cannot be asserted.

### 2. Format from the visible span, in local `HH:MM[:SS]`

A pure helper, colocated with the other chart-label helpers, takes a timestamp and the span in milliseconds. Span is `latest.t - first.t` of the points already passed into `MetricChart`. Under 300_000 ms, the label is `HH:MM:SS`; at or above that, `HH:MM`. Hours and minutes come from the local `Date`, zero-padded. No `toLocaleTimeString`.

The helper is called from the memoized chart body. It closes over `data`, which already changes only when committed samples change, so a 250 ms scalar tick still does not rebuild the axis.

Alternative considered: key the format on the selected window control. Rejected — a 1-hour selection with twenty seconds of samples should still show seconds, and the chart would take a new prop it does not need. Alternative considered: keep locale formatting. Rejected — `AM/PM` and locale width make the overlap budget unknowable and the unit test flaky.

### 3. Prevent overlap with gap and margin, not a custom tick

Set `minTickGap` to at least the width of the longest label (`HH:MM:SS` at 10px, budget 80px) and keep `interval="preserveStartEnd"`. Raise the time-axis bottom margin from 0 to 16 so the label baseline sits inside the 140px chart box instead of on its edge. Do not add a custom tick renderer.

Alternative considered: a tick component that hides collisions after layout. Rejected — it is more code, it fights the library's own layout, and it is harder to memoize.

### 4. What each test lane proves

- Unit: the helper's short-span and long-span strings, including a single-sample span; a contrast check that `#888` on `#1e1e1e` is at least 4.5:1 and `#7a7a7a` on `#1e1e1e` is at least 3:1; the chart module's tick `fill`, axis `stroke`, `minTickGap`, and bottom margin match those decisions. The existing fan-out test still passes.
- Playwright, mock lane only: at 400×300 and 900×1100, in Default and Tile, rendered tick text does not overlap and is not clipped, and the computed tick fill is the explicit color. List view has no tick text. This runs against the span the harness actually seeds (about five minutes) and the 30-second window. It does not select 30m or 1h and pretend that paints an hour.

## Risks / Trade-offs

- [A 16px bottom margin shrinks the plot inside the fixed 140px chart] → Accepted. The card height does not change, so the layout-containment grid is untouched. If a containment assertion measures chart-box overflow, the new margin is inside the SVG, not outside the card.
- [24-hour labels differ from a 12-hour locale clock] → Accepted. Width and tests stay stable. The accessible chart name is unchanged and still carries the value, not the axis text.
- [Playwright never sees a one-hour axis] → The long-span rule is unit-tested. The rendered collision rule is tested on the widest labels the harness can show (`HH:MM:SS`), which is the worse overlap case.
- [`#888` / `#7a7a7a` are still literals] → They match colors already in the UI. A token extraction is a different change.

## Migration Plan

Frontend-only. No settings migration, no schema bump, no rollback beyond reverting the chart component and the helper. Existing List-view and y-domain behavior is preserved by the spec's last requirement and by not passing new props through `renderCardContent`.

## Open Questions

None. The contrast floors, the five-minute span cut, and the decision not to seed a longer mock ring are settled above.
