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
