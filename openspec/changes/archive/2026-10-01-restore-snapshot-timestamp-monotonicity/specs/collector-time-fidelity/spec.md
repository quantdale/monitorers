## MODIFIED Requirements

### Requirement: Time windows and rates use elapsed timestamps
History window selection SHALL use recorded monotonic-derived timestamps and apply one aligned index range to every channel. The history ring SHALL have exactly one timestamp source: the timestamps the backend commits SHALL be the same values the frontend stores when it appends a live full-tick snapshot, so that no point in the ring is stamped by a second, independent clock. Where a live snapshot is reconciled against a history response, the "already covered" comparison SHALL be made between timestamps from that single source. Network throughput SHALL divide byte deltas by the elapsed monotonic refresh interval and SHALL handle first samples, counter resets, interface changes, near-zero intervals, and long pauses without inventing rates.

#### Scenario: Irregular history selects real duration
- **WHEN** timestamps are irregular and a 60-second window is requested
- **THEN** the selected suffix spans the newest timestamp back to approximately 60 seconds, regardless of how many samples that contains

#### Scenario: Equivalent byte ratios agree
- **WHEN** 250 ms, 1 s, and 2 s refreshes each observe byte deltas proportional to the same bytes-per-second rate
- **THEN** the normalized KB/s values agree within floating-point tolerance

#### Scenario: Counter reset is safe
- **WHEN** a network counter decreases or an elapsed interval is non-positive
- **THEN** the rate helper returns an explicit unavailable/zero-safe result and does not report a negative or fabricated spike

#### Scenario: Live commits reuse the backend's timestamp
- **WHEN** the frontend appends a history-committing live snapshot to the ring
- **THEN** it stores the timestamp carried by that snapshot, and does not mint an independent timestamp from a different clock

#### Scenario: Ring has a single timestamp source
- **WHEN** a history ring is inspected after both an initial history response and a sequence of live full-tick commits
- **THEN** every entry's timestamp originates from the same producer, so consecutive values are comparable and a window selection over the ring is well defined

#### Scenario: Reconciliation compares like with like
- **WHEN** a live event is reconciled against an in-flight history response
- **THEN** the already-covered decision compares timestamps produced by the same source, so a genuinely new sample is never discarded and an already-included sample is never duplicated

#### Scenario: Missing timestamp on the wire is handled explicitly
- **WHEN** a live snapshot arrives without a usable timestamp
- **THEN** the frontend applies the documented fallback rule, records that the fallback was used, and does not silently interleave a second clock's values into the ring without marking them
