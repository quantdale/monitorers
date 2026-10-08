# dashboard-layout-containment Specification

## Purpose
TBD - created by archiving change 2026-10-08-harden-dashboard-layout-and-semantics. Update Purpose after archive.

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
