## MODIFIED Requirements

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
