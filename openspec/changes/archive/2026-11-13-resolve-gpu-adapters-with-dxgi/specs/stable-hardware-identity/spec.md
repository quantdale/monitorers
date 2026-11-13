## ADDED Requirements

### Requirement: GPU adapter enrichment uses exact OS identity
GPU captions and software classification SHALL come from the same OS adapter identity as the utilization channel. The collector SHALL NOT pair unrelated caption and engine enumerations by position or assign surplus adapters the last known name. Known software renderers SHALL NOT appear as physical GPU cards. Missing enrichment SHALL retain an explicit unknown GPU channel rather than borrowing another adapter's identity or telemetry. Successful metadata refreshes SHALL converge additions, removals and labels with bounded enumeration work outside history locks; transient failures SHALL retain last-good metadata.

#### Scenario: Software renderer sorts between physical adapters
- **WHEN** engine counters contain Intel, a software renderer and Nvidia identities while physical controller captions contain only Intel and Nvidia
- **THEN** the physical cards use their exact adapter names, the software renderer is excluded, and Nvidia telemetry is not made ambiguous by a fabricated duplicate

#### Scenario: Adapter enumeration order changes
- **WHEN** the OS returns identical physical adapters in a different sequence
- **THEN** their keys and labels remain associated with the same utilization channels

#### Scenario: Metadata is unavailable
- **WHEN** adapter metadata cannot be refreshed
- **THEN** known good metadata is retained and newly seen unclassified counter identities remain explicit unknown devices without guessed vendor data

#### Scenario: Final physical adapter is removed
- **WHEN** successful adapter enumeration and PDH polling confirm no remaining physical GPU channels
- **THEN** the last GPU is removed after the normal ghost grace period, while unavailable polling preserves last-known channels

### Requirement: GPU LUID keys preserve both halves with compatible migration
GPU channel keys SHALL distinguish LUIDs with equal low halves and different high halves. Existing canonical keys with a zero high half SHALL remain unchanged. Historical hexadecimal casing SHALL resolve to the canonical identity without losing saved choices. A uniquely resolvable legacy low-half layout or visibility identity SHALL migrate to its complete key in dashboard and sidebar settings. Ambiguous legacy identities SHALL NOT be assigned by enumeration position. A migration without newly added devices SHALL still persist its changed settings.

#### Scenario: Nonzero high halves collide on the low half
- **WHEN** two counter instances have different nonzero high halves and equal low halves
- **THEN** they produce distinct GPU keys and histories

#### Scenario: Compatible common key
- **WHEN** a counter LUID has a zero high half
- **THEN** its existing low-half GPU key remains identical

#### Scenario: Historical hexadecimal casing
- **WHEN** persisted LUID identities use different hexadecimal casing from the canonical key
- **THEN** uniquely resolved order and visibility choices follow the canonical GPU, without case-folding arbitrary device IDs

#### Scenario: Unique legacy key migrates
- **WHEN** a saved low-half GPU identity has exactly one complete current identity
- **THEN** dashboard order/hidden state and sidebar order follow the complete key and the migration is persisted even without another new device

#### Scenario: Ambiguous legacy identity is retained
- **WHEN** a saved low-half alias maps to multiple complete current identities
- **THEN** no adapter is chosen silently and unresolved saved state remains available as an orphan
