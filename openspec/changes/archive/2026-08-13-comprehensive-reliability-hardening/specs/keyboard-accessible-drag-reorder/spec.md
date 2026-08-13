## ADDED Requirements

### Requirement: Sidebar drag handles share visible focus semantics
Dashboard and sidebar drag handles SHALL be labeled interactive controls with a visible `:focus-visible` treatment, keyboard reorder behavior, and decorative grip content hidden from the accessibility tree where appropriate.

#### Scenario: Sidebar handle is visibly focused
- **WHEN** a keyboard user tabs to a sidebar handle
- **THEN** the handle is visible and has a focus indicator without requiring mouse hover

#### Scenario: Keyboard reorder preserves stable identity
- **WHEN** a user moves a sidebar device with the keyboard
- **THEN** the persisted order changes for that device's stable key, not its old enumeration index
