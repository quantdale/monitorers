# stable-hardware-identity Specification

## Purpose
Defines stable physical-device identity and safe per-device telemetry association across the collector, IPC payloads, frontend cards, sidebar, and persisted layout.

## Requirements

### Requirement: Physical hardware identity is stable and separate from display labels
Dashboard cards, sidebar cards, history entries, React keys, drag state, and persisted layout SHALL use a stable hardware key from the strongest available OS/API identity. Display names SHALL remain presentation-only. Identical names, slug collisions, enumeration reorder, remove/reappear, and restart SHALL not silently merge or reassign devices.

#### Scenario: Identical GPUs remain separate
- **WHEN** two GPUs expose the same display name but distinct stable API identities
- **THEN** two keyed cards and two histories remain distinct through every snapshot

#### Scenario: Enumeration reorder preserves layout
- **WHEN** the provider returns the same physical disks/GPUs in a different order after a restart
- **THEN** persisted card and sidebar positions follow stable keys rather than array positions

#### Scenario: Ambiguous legacy migration is safe
- **WHEN** an old display-name slug maps to multiple current devices
- **THEN** the migration does not choose one silently; it retains a deterministic orphan/fallback state and never moves telemetry between devices

### Requirement: Nvidia telemetry is associated per device
NVML/NVAPI readings SHALL be normalized with stable identity candidates and attached only to an exact or uniquely safe GPU match. An unmapped reading SHALL be unavailable for that card. A fallback provider that identifies only one device SHALL attach only to that device and SHALL never broadcast values to all Nvidia cards.

#### Scenario: Distinct telemetry stays distinct
- **WHEN** two Nvidia fixtures have different UUID/PCI identities and different temperature, power, memory, fan, and clock readings
- **THEN** each card renders only its own readings

#### Scenario: Unmapped telemetry is unavailable
- **WHEN** a provider reading cannot be reconciled to a stable GPU key
- **THEN** the affected card shows unavailable telemetry rather than another card's values

### Requirement: Hardware profile degrades and updates truthfully
The hardware profile SHALL retain PDH-discovered devices when optional WMI classification is unavailable, marking unknown enrichment explicitly. Profile changes SHALL be emitted when the stable hardware set changes after the configured grace/debounce; if a platform cannot update live, the UI SHALL label the profile as a startup snapshot. A physical disk's **display name** SHALL be enriched from the authoritative OS-reported model when one is available, and a raw device path or other non-model identifier SHALL NOT be shown to the user as the disk's name. Such an enriched name SHALL remain presentation-only: it SHALL never become part of a device's identity, and the disk's stable key SHALL continue to be derived from the drive letters the PDH/sysinfo mapping produces, identically for the dashboard and the sidebar.

#### Scenario: WMI unavailable does not hide GPUs
- **WHEN** WMI bootstrap fails but PDH reports GPU instances
- **THEN** the profile contains those GPUs with unknown/best-effort vendor or kind metadata

#### Scenario: Hotplug profile converges
- **WHEN** a disk or GPU appears or disappears beyond the collector's grace threshold
- **THEN** the sidebar profile converges to the stable set without transient duplicate cards

#### Scenario: Disk name is enriched from the OS model when available
- **WHEN** a physical disk's model can be read from the OS and the drive mapping exposes that disk's physical index
- **THEN** the profile reports the OS-reported model as the disk's display name instead of a raw device path

#### Scenario: Disk name degrades truthfully without the enrichment
- **WHEN** the OS model cannot be read (for example before WMI is available, or on a query failure)
- **THEN** the profile falls back to the previously available name, the device remains present, and the fallback does not become an identity or remove the disk

#### Scenario: Enriched name is presentation-only
- **WHEN** a disk's display name is enriched from the OS model
- **THEN** the disk's stable key, its history channel, and its persisted layout identity are unchanged, and two disks that share a model string remain distinct devices

#### Scenario: Dashboard and sidebar agree on disk identity
- **WHEN** the same physical disk is observed by the metric poll and by the profile
- **THEN** both use the identical drive-letter key for that disk, so the sidebar card and the dashboard card refer to the same device

### Requirement: Collector library migrations SHALL preserve stable device identity
Upgrading sysinfo, WMI, windows-rs, NVML/NVAPI bindings, the Rust toolchain, or Tauri SHALL NOT change persisted disk/GPU/card/sidebar identity merely because an upstream library changes enumeration order, display formatting, wrapper types, or refresh APIs. Existing stable keys SHALL remain the identity source unless an explicit migration provides deterministic backward mapping.

#### Scenario: sysinfo disk enumeration changes order or metadata representation
- **WHEN** the same physical disks are reported by the upgraded dependency in a different order or through changed wrapper APIs
- **THEN** dashboard/sidebar persisted layout continues to follow stable device keys and does not reset or attach an old position to a different device

#### Scenario: WMI enrichment becomes available later than PDH discovery
- **WHEN** a GPU first appears with conservative PDH identity and later receives WMI vendor/name enrichment after dependency migration
- **THEN** the stable GPU key remains unchanged and enrichment does not create a duplicate card/history

### Requirement: Nvidia dependency migrations SHALL remain fail-closed for ambiguous adapters
An NVML/NVAPI library migration SHALL retain one-to-one telemetry association. Exact UUID/PCI identity takes precedence; a normalized-name fallback is allowed only when unique on both collector and provider sides. No migration convenience may attach one provider reading to multiple physical cards.

#### Scenario: two identical Nvidia names remain ambiguous
- **WHEN** two collector GPUs and two NVML readings share the same display name but no unique identity can be reconciled
- **THEN** per-card optional Nvidia telemetry remains unavailable rather than being assigned by enumeration index

#### Scenario: upstream NVML API changes identity field representation
- **WHEN** UUID or PCI information changes type/format in the selected wrapper version
- **THEN** the adapter normalizes that representation for exact identity comparison and regression fixtures prove two distinct identities still receive distinct telemetry

### Requirement: Physical qualification claims SHALL match available hardware
Dependency migration evidence SHALL distinguish deterministic identity fixtures and single-machine packaged behavior from physical identical-multi-GPU qualification.

#### Scenario: execution host lacks qualifying identical GPUs
- **WHEN** all deterministic identity tests pass but the Windows host does not contain two qualifying identical physical GPUs
- **THEN** the campaign reports the physical scenario as still exploratory/unqualified and does not promote fixture evidence into a hardware claim

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
