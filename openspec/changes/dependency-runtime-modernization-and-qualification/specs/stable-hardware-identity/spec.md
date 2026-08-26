# stable-hardware-identity Delta

## ADDED Requirements

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
