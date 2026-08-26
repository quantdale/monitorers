# user-simulation-platform Delta

## ADDED Requirements

### Requirement: Sidebar ordering is certified across a true process relaunch on the real lane
The platform SHALL provide a real-lane-only journey that certifies hardware-sidebar card ordering across an actual packaged-application process relaunch. The journey SHALL launch the built app with a fresh per-run isolated settings store, wait for native hardware discovery to settle sufficiently for sidebar cards to render, record the initial sidebar identifiers in rendered order via stable semantic DOM attributes, reorder at least two valid sidebar items using the application's supported interaction, assert the rendered order changed, assert the new order was written to the isolated real settings store, terminate the application through the driver's normal cleanup path, prove the original process exited, launch a NEW process (not a page reload or remount), wait for native discovery again, and assert the restore contract. Because native discovery MAY legitimately differ between processes (lazy GPU Engine counter materialization, differing disk enumeration), the restore contract is defined as: (1) APPEND-ONLY NON-DESTRUCTION — every pre-restart persisted id survives with its relative order intact; new discoveries may append; (2) ORDER-PRESERVING RESTORE — rendered ids are a relative-order-preserving subset of the persisted order; and (3) EXACT EQUALITY whenever the relaunch discovers the same device set as the first process. Unrelated persisted settings SHALL remain coherent and live metrics SHALL keep advancing. The runner's isolation self-test (developer store byte-identical) and orphan-process guarantees apply to every run of this journey.

#### Scenario: Reordered sidebar survives a true relaunch
- **WHEN** the sidebar-relaunch-persistence journey runs against the built exe
- **THEN** the post-relaunch rendered `[data-sb-id]` order is an exact match when the discovered device set is unchanged, and otherwise an order-preserving restriction of the persisted order while the store retains every pre-restart id in order; the run used two distinct child processes on distinct CDP ports, in-memory history did not survive the restart, and metrics timestamps advance after the relaunch

#### Scenario: A fake restart cannot satisfy the journey
- **WHEN** the driver were to reload the page or remount React instead of spawning a new process
- **THEN** the journey fails because the page target, CDP port, collector bootstrap sequence, and empty-history checkpoint all differ from a genuine second process

## MODIFIED Requirements

### Requirement: Undrivable scenarios follow the register discipline
Any journey step that cannot be software-driven (physical hardware change, OS power events, multi-process interaction) SHALL be recorded in the exploratory register with a one-line reason and SHALL NOT be implemented as a faked or flaky automation. Register entries SHALL be revisited when a new driver capability makes them drivable, and each converted entry SHALL name the exact automated journey that now covers it.

#### Scenario: A physically undrivable step is registered, not faked
- **WHEN** a proposed journey requires a real drive unplug
- **THEN** the step is added to the exploratory register with its reason, and the journey covers the software-reachable portion via bridge-scripted hotplug instead

#### Scenario: A registered entry is converted when a capability lands
- **WHEN** a previously registered scenario becomes drivable by a new automated journey
- **THEN** the register entry is rewritten to state which journey covers it rather than silently deleted, and genuinely hardware-bound entries remain registered
