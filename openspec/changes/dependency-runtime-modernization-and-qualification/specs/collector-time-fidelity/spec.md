# collector-time-fidelity Delta

## ADDED Requirements

### Requirement: Collector dependency migrations SHALL preserve timing semantics
An upgrade of sysinfo, WMI, windows-rs, Tauri runtime dependencies, compiler toolchain, or any other library on the collector path SHALL preserve the existing monotonic 250 ms scheduling contract, non-catching-up behavior, 4:1 live/full-poll split, approximately 1 Hz history commits, elapsed-time rate normalization, and first-sample/recovery baseline behavior unless an explicit prior spec migration changes the contract.

#### Scenario: Native collector dependencies are upgraded
- **WHEN** the collector is rebuilt against a newer sysinfo, WMI, windows-rs, NVML, Tauri, or Rust toolchain
- **THEN** the canonical cadence checker and focused collector tests still pass without relaxed thresholds, skipped assertions, or extra history commits

#### Scenario: Upstream refresh API changes
- **WHEN** a sysinfo or Windows API migration changes how CPU/network/disk state is refreshed
- **THEN** startup/recovery baselines remain truthful and downtime or initialization delay is not collapsed into a fabricated rate spike or zero sample

### Requirement: Optional WMI enrichment SHALL remain outside the core-liveness critical path
A WMI library/API migration SHALL preserve collector-session thread ownership and SHALL NOT make the first core PDH/sysinfo snapshot wait for successful WMI connection or enrichment. WMI initialization/retry failure SHALL remain bounded, diagnosed and degradable.

#### Scenario: WMI constructor behavior changes upstream
- **WHEN** the selected WMI crate moves COM initialization into `WMIConnection` or otherwise changes the connection API
- **THEN** the app adapts the constructor while keeping the connection session-local, non-blocking core startup, bounded retry/backoff and degraded core metrics behavior

#### Scenario: WMI stays unavailable after migration
- **WHEN** every bounded WMI initialization attempt fails
- **THEN** core metrics continue at the required cadence and the profile remains useful with explicit unknown/best-effort enrichment rather than stopping collection
