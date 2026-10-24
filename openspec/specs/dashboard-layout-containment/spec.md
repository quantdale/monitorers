# dashboard-layout-containment Specification

## Purpose

The dashboard keeps every card inside its box at the product's minimum window, including when the hardware sidebar is open, and exposes a heading plus header and main landmarks.

## Requirements

### Requirement: The dashboard keeps every card and every rendered number inside its container at the product's minimum window size
The dashboard's column layouts SHALL keep grid tracks equal and keep each card's box inside the scroll container at the application's minimum window size (400×300) and above, and the List view's rows SHALL grow rather than clip content when a card's metadata does not fit on one line.

#### Scenario: Tile view has equal tracks at a wide window
- **WHEN** Tile view renders at the product's normal window width (900 px)
- **THEN** the card grid exposes two equal-width column tracks and no card is wider than the grid container

#### Scenario: Tile view collapses instead of overflowing at the minimum window
- **WHEN** Tile view renders at or below the product's minimum window width (400 px)
- **THEN** the grid resolves to a single column whose cards fit inside the scroll container, so no column is wider than the container and no card overflows its own box

#### Scenario: List rows do not clip metadata
- **WHEN** List view renders a card whose metadata (value and range) does not fit on one line at the current width
- **THEN** the row grows to show the wrapped metadata instead of hiding it, i.e. the row's scroll height never exceeds its client height

### Requirement: The dashboard exposes landmark structure and a heading
The application shell SHALL expose a header landmark containing the product title as the page's top-level heading, and a main landmark containing the dashboard content, so assistive technology can navigate the page by landmark and heading.

#### Scenario: Landmark and heading structure
- **WHEN** the dashboard renders
- **THEN** the page contains exactly one top-level heading naming the product, a header landmark and a main landmark, and the dashboard's cards live inside the main landmark

### Requirement: An open hardware sidebar does not crush the dashboard at the minimum window
At the application's minimum window size (400×300) and any viewport narrower than 640px, opening the hardware sidebar SHALL present it as an overlay that does not reduce the dashboard column width. Cards SHALL remain inside their boxes (no card's scroll width exceeds its client width). At 640px and wider, the sidebar SHALL remain an in-flow rail that reduces the dashboard column by the rail width. The collapsed sidebar SHALL stay hidden from assistive technology and the tab order.

#### Scenario: Minimum window overlays the rail
- **WHEN** the hardware sidebar is opened at a 400px-wide window
- **THEN** the dashboard card list keeps the width it had while the sidebar was closed, no metric card overflows its own box, and the sidebar is a fixed overlay rather than an in-flow column

#### Scenario: Wide window still pushes
- **WHEN** the hardware sidebar is opened at a 900px-wide window
- **THEN** the dashboard card list becomes narrower by the rail width and no metric card overflows its own box

#### Scenario: Overlay dismisses without leaving focus behind
- **WHEN** the overlay sidebar is open and the user activates its close control, its scrim, or Escape (and Escape was not already consumed by an in-progress keyboard drag)
- **THEN** the sidebar collapses out of the accessibility tree and focus returns to the sidebar toggle

### Requirement: Hardware labels and large live values remain readable
At the minimum window and above, all view modes SHALL keep long CPU/GPU/model names and large network rate values inside their allocated panels. Primary live values SHALL remain visible and SHALL NOT be squeezed behind non-shrinking hardware names or clipped by a neighboring chart. Disk model display SHALL NOT replace stable-key identity.

#### Scenario: Long hardware label in list view
- **WHEN** List view renders a long CPU or GPU model name at 400px width
- **THEN** the name wraps inside its panel, the live value is visible, and neither overlaps the chart

#### Scenario: Large network rate in tile view
- **WHEN** a 300px-wide tile renders a large finite network rate
- **THEN** its direction label and live value reflow within the card instead of painting past its edge
