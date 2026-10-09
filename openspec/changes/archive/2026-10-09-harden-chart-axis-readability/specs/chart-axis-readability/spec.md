## Purpose

Makes the time scale on a live metric chart readable: tick text and the axis stroke clear their contrast floors, and tick labels neither overlap nor clip as the visible span grows.

## ADDED Requirements

### Requirement: Time-axis text and stroke clear their contrast floors
In any view that draws a time axis, tick text SHALL have a contrast ratio of at least 4.5:1 against the card surface it is painted on, and the visible axis stroke SHALL have a contrast ratio of at least 3:1 against that same surface. The colors SHALL be explicit, so the chart library's default gray is not the rendered color.

#### Scenario: Default view tick text is readable on the card
- **WHEN** Default view renders a metric chart that has a time axis
- **THEN** the tick text color achieves at least 4.5:1 contrast against the card surface, and that color is set by the application rather than left to the chart library default

#### Scenario: Axis stroke is distinguishable on the card
- **WHEN** Default or Tile view renders a metric chart that has a time axis
- **THEN** the axis stroke achieves at least 3:1 contrast against the card surface

### Requirement: Time-axis labels do not overlap or clip
Tick labels on a visible time axis SHALL lie fully inside the chart box — allowing at most a 1px sub-pixel rounding tolerance on any edge — and the bounding boxes of adjacent tick labels SHALL NOT overlap, at the product's minimum window (400×300) and its normal window (900×1100), in both Default and Tile view. The tolerance exists because label boxes are measured in fractional layout pixels; it SHALL NOT be read as permission for a visible clip.

#### Scenario: Labels fit at the minimum window
- **WHEN** Default or Tile view renders charts at 400×300
- **THEN** every visible time-axis label is inside its chart box (at most 1px of sub-pixel rounding on any edge) and no two labels on the same chart overlap

#### Scenario: Labels fit at the normal window
- **WHEN** Default or Tile view renders charts at 900×1100
- **THEN** every visible time-axis label is inside its chart box (at most 1px of sub-pixel rounding on any edge) and no two labels on the same chart overlap

### Requirement: Label precision follows the visible span
A time-axis label SHALL include seconds when the chart's visible span is under five minutes, and SHALL NOT include a seconds field when the visible span is five minutes or longer. Labels SHALL use local time in a fixed `HH:MM` or `HH:MM:SS` form, so width does not depend on locale or a 12-hour marker. A span under five minutes includes a chart with a single sample.

#### Scenario: A short span keeps seconds
- **WHEN** a chart's visible span is under five minutes
- **THEN** each time-axis label includes the hour, the minute, and the second

#### Scenario: A long span drops seconds
- **WHEN** a chart's visible span is five minutes or longer
- **THEN** each time-axis label includes the hour and the minute and does not include a seconds field

### Requirement: Hidden scales stay hidden
List view SHALL NOT draw a time axis. No view SHALL draw a numeric y-axis. Percentage charts SHALL keep a 0–100 domain, and the network chart SHALL keep an automatic upper domain.

#### Scenario: List view has no time labels
- **WHEN** List view renders a metric chart
- **THEN** the chart has no visible time-axis tick text

#### Scenario: No numeric y-axis appears
- **WHEN** any view renders a metric chart
- **THEN** the chart has no visible y-axis tick text, and the plotted domain is unchanged from the domain that view used before this change
