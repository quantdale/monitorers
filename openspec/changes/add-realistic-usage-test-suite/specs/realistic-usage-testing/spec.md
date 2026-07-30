This capability defines the test coverage required to verify sys-monitor-tauri behaves correctly under realistic, longitudinal, imperfect human usage. It is scoped to a single-process, no-auth, no-server, no-multi-tenant Windows desktop app: requirement areas from generic testing checklists that have no referent here — authentication/authorization, multi-tab session conflict, background job/queue processing, and API contract testing against a network peer — are intentionally absent because this app has none of those mechanisms.

Requirements below are grouped by the four risk pillars established in design.md. Several requirements are explicitly **characterization** requirements: they pin today's actual (in some cases defective) behavior with a test, rather than asserting it as correct, so a future fix is a deliberate change to a known test rather than a silent behavior shift.

## ADDED Requirements

### Requirement: Dashboard card identity survives unchanged-hardware restarts
The dashboard card identity scheme (`gpuId(name)` for GPUs, drive-letter combo for disks) SHALL be verified to produce the same card id across repeated computation for the same input, and the persisted `cardOrder`/`hiddenCardIds` SHALL be verified to still apply correctly to a card when the underlying hardware list is unchanged between sessions.

#### Scenario: Same GPU name always yields the same card id
- **WHEN** `gpuId` is called multiple times with the same display name
- **THEN** it returns an identical id string each time

#### Scenario: Reordered and hidden cards survive a settings reload with unchanged hardware
- **WHEN** a saved `cardOrder` and `hiddenCardIds` are loaded against a metrics snapshot whose disk/GPU keys match the ids already present in `cardOrder`
- **THEN** the visible card order and hidden-card filtering reproduce the previously saved arrangement exactly

### Requirement: New hardware merges into persisted card order without disrupting existing entries
When a metrics snapshot contains disk or GPU ids not present in the currently saved `cardOrder`, the merge logic SHALL append the new ids to the end of the existing order while leaving the position of all previously known ids unchanged.

#### Scenario: A newly attached disk is appended, not inserted
- **WHEN** the saved `cardOrder` is `["cpu", "memory", "disk_C:"]` and the latest metrics snapshot includes disks `C:` and `D:`
- **THEN** the merged order is `["cpu", "memory", "disk_C:", "disk_D:"]`, preserving the original three entries' relative order

#### Scenario: No merge occurs when no new ids are present
- **WHEN** the saved `cardOrder` already contains every id present in the latest metrics snapshot
- **THEN** the settings save function is not called (no redundant persisted write)

### Requirement: Removed hardware hides its card without deleting persisted state (ghost-entry characterization)
When previously known hardware (e.g. a disk) is no longer present in a metrics snapshot, its card SHALL disappear from the visible card list via `isCardPresent` filtering, and its id SHALL remain in the persisted `cardOrder`/`hiddenCardIds` indefinitely. This requirement characterizes a confirmed gap (no pruning exists) rather than asserting it as desired long-term behavior; see design.md Known Gaps.

#### Scenario: A removed disk's card disappears but its id is retained in settings
- **WHEN** a disk id present in `cardOrder` is absent from the current metrics snapshot's disk list
- **THEN** `isCardPresent` returns false for that id and it is excluded from `visibleCardOrder`, while `cardOrder` itself is left unmodified

#### Scenario: A re-inserted disk under the same key reappears in its original position
- **WHEN** a disk id that was previously absent reappears in a later metrics snapshot with the same key
- **THEN** its card reappears at its original position in `cardOrder` without triggering the new-hardware merge path

### Requirement: Hardware sidebar positional identity is characterized against enumeration-order changes
The hardware sidebar's card ids (`sb_gpu_${i}`, `sb_disk_${i}`) are derived from array position in the hardware profile, not from content. The test suite SHALL characterize today's behavior: if the profile's GPU or disk enumeration order differs between two calls, the same positional id MUST be shown to refer to different hardware, with no detection or warning, so this gap is documented rather than silently rediscovered later.

#### Scenario: Sidebar order silently points at different hardware after an enumeration-order change
- **WHEN** a saved `sidebarCardOrder` is computed against a hardware profile whose GPU array order is `[gpuA, gpuB]`, and the app later loads a profile whose GPU array order is `[gpuB, gpuA]`
- **THEN** `sb_gpu_0` renders `gpuB`'s data instead of `gpuA`'s, with no error surfaced to the user — pinning this as a known, tested gap rather than an undiscovered one

### Requirement: GPU utilization for two same-model GPUs is characterized as merged (known defect)
The PDH GPU-utilization query merges entries by brand-stripped display name. The test suite SHALL pin today's actual behavior as a tested fact, not as correct behavior: two physically distinct GPUs sharing the same display name MUST be shown to produce one merged entry with summed utilization (capped at 100%). See design.md Known Gaps for the recommended fix (key by `(display_name, luid)` or enumeration index instead of display name alone).

#### Scenario: Two identically-named GPU utilization readings are summed into one entry
- **WHEN** `query_gpu_utilization_pdh`-equivalent merge logic processes two LUIDs that both classify to the same brand-stripped display name with utilization values that sum to under 100
- **THEN** the resulting entry list contains exactly one entry for that display name, with utilization equal to the sum of the two inputs

#### Scenario: Summed utilization for same-model GPUs is capped at 100%
- **WHEN** two same-named GPU utilization values sum to more than 100
- **THEN** the merged entry's utilization is capped at 100, not left unbounded

### Requirement: Rapid sequential setting changes converge to a consistent final state
When multiple settings patches are applied in quick succession (e.g. several drag-reorder operations before any async save completes), the in-memory settings state SHALL reflect the last-applied patch for each key, and the sequence of underlying store writes SHALL be verified not to reorder or drop any individual key's final value.

#### Scenario: Several rapid card-order saves converge to the last requested order
- **WHEN** `save({ cardOrder: A })`, then `save({ cardOrder: B })`, then `save({ cardOrder: C })` are invoked in immediate succession without awaiting each call
- **THEN** the final in-memory `settings.cardOrder` equals `C`, and the last store write for the `cardOrder` key persists `C`

#### Scenario: Concurrent patches to different keys do not clobber each other
- **WHEN** `save({ viewMode: 'tile' })` and `save({ windowSecs: 300 })` are invoked concurrently
- **THEN** the final settings state contains both `viewMode: 'tile'` and `windowSecs: 300`

### Requirement: Preferences persist across restart while telemetry history does not
Layout preferences (`cardOrder`, `hiddenCardIds`, `sidebarCardOrder`, `viewMode`, `windowSecs`) SHALL be reloaded unchanged after a simulated app restart (fresh `useSettings` load from the same store), while telemetry history SHALL start empty on a fresh backend process regardless of how much history existed before the previous shutdown. This is a deliberate persistence boundary, not a defect, and this requirement exists so it is never accidentally "fixed" in either direction.

#### Scenario: Settings survive a simulated restart
- **WHEN** `useSettings` saves a non-default `viewMode` and `windowSecs`, and a new `useSettings` instance loads from the same underlying store
- **THEN** the new instance's initial settings match the previously saved values, not the defaults

#### Scenario: History does not survive a fresh backend process
- **WHEN** a new `HistoryStore` is constructed (simulating process restart)
- **THEN** all of its history ring buffers are empty, regardless of any prior process's accumulated history

### Requirement: Dual-instance concurrent settings writes are characterized (known gap)
No single-instance enforcement exists. The test suite SHALL characterize current last-write-wins behavior at the settings-merge-logic level as a documented gap; it MUST NOT be interpreted as asserting that concurrent real-OS-process file writes are safe, since that is outside what unit-level testing can exercise (see design.md Risks).

#### Scenario: Two independent settings-save sequences applied in interleaved order produce a deterministic last-write-wins result
- **WHEN** two independent patch sequences representing two app instances are interleaved and applied to the same in-memory settings reducer in a defined order
- **THEN** the final state equals what plain last-write-wins application of that same interleaved order would produce (i.e., no key is silently lost or duplicated by the merge logic itself)

### Requirement: Collector panic halts metrics permanently until relaunch
When the collector thread's tick body panics, the application SHALL emit a `collector-error` event exactly once, the tick loop SHALL terminate (no further `metrics-update` events emitted), and the frontend SHALL display the error banner and retain the last-known card values indefinitely until the process is relaunched.

#### Scenario: A caught panic emits exactly one error event and stops further snapshots
- **WHEN** a tick body panics inside `catch_unwind`
- **THEN** exactly one `collector-error` payload is emitted and no further `metrics-update` events are emitted afterward on that run

#### Scenario: The frontend error banner persists once set
- **WHEN** `useMetrics`'s `collector-error` listener receives an error payload
- **THEN** `collectorError` remains set to that message for the remainder of the component's lifetime (no automatic clearing)

### Requirement: History commits stay gated to full-poll ticks at all sustained runtimes
The 1Hz history-commit cadence (`is_full_poll_tick`/`on_tick` on the backend, `shouldCommitHistory` on the frontend) SHALL remain correctly gated during sustained runtime, so that a selected time window continues to represent real elapsed time and CPU/GPU history density matches other metrics' density. This requirement absorbs task 8.7 from `fix-history-emission-rate` (manual verification of 1-hour-window real-time tracking) into this suite's regression coverage.

#### Scenario: Only every 4th tick commits to history
- **WHEN** the tick counter advances over a sustained range (e.g. 0 through 399, representing 100 seconds of runtime)
- **THEN** exactly one quarter of ticks are classified as full-poll/history-committing ticks, matching the 4-tick cadence

#### Scenario: History array length tracks real elapsed time, not event count
- **WHEN** the frontend receives a mix of `on_tick: true` and `on_tick: false` events at the real 250ms rate over a sustained period
- **THEN** the resulting history array length corresponds to 1 entry per elapsed second, not 1 entry per received event

#### Scenario: Manual verification — 1-hour window tracks real elapsed time during a live session (absorbed task 8.7)
- **WHEN** `npm run tauri dev` runs continuously for at least the length of one selected time window
- **THEN** a human tester confirms (via stopwatch or timestamp spot-check) that the "1 hour" window's displayed span matches real elapsed time 1:1, and that CPU/GPU card readouts visibly update multiple times per second throughout — tracked as a manual/exploratory task, not automatable with current tooling

### Requirement: Schema version mismatch is detectable in test, even though production only logs it
A mismatch between the frontend's `EXPECTED_SCHEMA_VERSION` and a payload's `schema_version` SHALL be verified to trigger `assertSchemaVersion`'s error path. This characterizes the current silent-degrade behavior (console error only, no user-facing block) as a documented, tested fact.

#### Scenario: Mismatched schema version logs an error
- **WHEN** `assertSchemaVersion` is called with an `actual` value different from `EXPECTED_SCHEMA_VERSION`
- **THEN** an error is logged identifying both the expected and actual versions

#### Scenario: Matching schema version produces no error
- **WHEN** `assertSchemaVersion` is called with `actual` equal to `EXPECTED_SCHEMA_VERSION`
- **THEN** no error is logged

### Requirement: WMI slow-start does not block metrics collection or crash the app
When WMI connection attempts are slow or exhausted (all 8 backoff attempts fail), CPU/mem/net/disk metrics collection SHALL continue via PDH/sysinfo independent of WMI availability, and the app SHALL NOT crash or hang waiting for WMI.

#### Scenario: Metrics collection proceeds when WMI is unavailable
- **WHEN** `wmi_con` is `None` (all connection attempts exhausted)
- **THEN** CPU, memory, network, and disk polling still produce valid snapshots; only GPU vendor classification and CPU thermal data are absent

### Requirement: History ring buffers wrap correctly under sustained long-running use
Each history ring buffer (`cpu_history`, `mem_history`, disk/GPU per-key histories, `timestamps`) SHALL be verified to cap at `HISTORY_LEN` (3600) samples and to drop the oldest sample when a new one is pushed at capacity, without growing unbounded or losing internal consistency between parallel buffers (e.g. `timestamps` and `cpu_history` staying the same length).

#### Scenario: Pushing past capacity drops the oldest sample
- **WHEN** `push_history` is called on a buffer already at `HISTORY_LEN` capacity
- **THEN** the buffer's length remains at `HISTORY_LEN` and its oldest previous element is no longer present

#### Scenario: Parallel histories stay length-synchronized over many pushes
- **WHEN** `timestamps` and `cpu_history` both receive a push on every full-poll tick over a long simulated run exceeding `HISTORY_LEN` ticks
- **THEN** both buffers have identical length at every point in the run

### Requirement: Cold-start and empty states render safely before first data arrives
Before the first metrics snapshot or hardware profile arrives, and when a hardware category (disks, GPUs) is entirely absent, the frontend SHALL render a safe loading/empty state rather than throwing or showing undefined values.

#### Scenario: No cards render before the first metrics snapshot
- **WHEN** `useMetrics` has not yet received an initial `HistoryPayload` or any `metrics-update` event
- **THEN** the app shows the "Collecting metrics…" state instead of attempting to render any card

#### Scenario: A machine with no discrete GPU renders without a GPU card or NVML fields
- **WHEN** a metrics snapshot has an empty `gpus` array and all `nvidia_*` fields are `null`
- **THEN** no GPU card is rendered and `hasNvidiaData` evaluates to false, without any null-reference error

### Requirement: Hidden-card state survives hardware presence changes
A card hidden via `hiddenCardIds` SHALL remain hidden across the hardware it represents temporarily disappearing and reappearing (e.g. a disk removed and reinserted with the same key), without needing to be re-hidden by the user.

#### Scenario: A hidden disk stays hidden after being removed and reinserted
- **WHEN** a disk id is added to `hiddenCardIds`, then the disk is absent from a later snapshot, then present again in a subsequent snapshot with the same key
- **THEN** the disk's card remains excluded from `visibleCardOrder` throughout, without any change to `hiddenCardIds`
