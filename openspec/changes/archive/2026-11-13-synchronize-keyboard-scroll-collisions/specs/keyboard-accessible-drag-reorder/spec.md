## ADDED Requirements

### Requirement: Keyboard scrolling and drop geometry stay synchronous
Keyboard-driven card movement SHALL synchronize actual scroll offsets and collision geometry before processing another movement, drop, or cancellation key. Immediate drops SHALL use the intended adjacent target even when native scroll notifications have not yet been delivered. Pointer behavior SHALL remain unchanged.

#### Scenario: Immediate drop after scrolling
- **WHEN** an arrow key moves a card and scrolls an ancestor, followed immediately by Enter before a native scroll notification
- **THEN** the card is reordered onto the adjacent sibling rather than its source or another card

#### Scenario: Reverse movement after a previous scroll
- **WHEN** a keyboard user drops a card, activates it again and immediately moves it back across the scrolled boundary
- **THEN** its original order is restored

#### Scenario: Cancellation after several movements
- **WHEN** multiple arrow keys cause scroll and then Escape cancels the drag
- **THEN** card order stays unchanged and a later drag remains operable
