## ADDED Requirements

### Requirement: Stable identity replaces positional hardware characterization
Realistic-usage tests SHALL treat dashboard and sidebar identity as a correctness property. Tests SHALL cover same-name devices, slug collisions, enumeration reorder, remove/reappear, restart persistence, and safe legacy migration; they SHALL not preserve known positional or display-name defects as expected behavior.

#### Scenario: Sidebar reorder follows physical device
- **WHEN** two same-model devices reverse enumeration order
- **THEN** the saved sidebar order remains attached to their stable keys

### Requirement: Settings schema version is read and migrated
The settings loader SHALL read `settingsVersion`, treat absence as legacy v0, migrate recognized older versions stepwise, validate current fields, preserve future-version files without destructive downgrade, and surface corruption/fallback warnings as designed.

#### Scenario: Future settings are preserved
- **WHEN** a store contains a future settings version
- **THEN** the app does not overwrite it with a downgraded schema and exposes a visible safe error/fallback state
