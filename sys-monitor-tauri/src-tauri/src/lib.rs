//! Library facade for the sys-monitor-tauri backend.
//!
//! Splits the collection logic out of the historical `main.rs` monolith so that
//! both the Tauri app binary (`main.rs`) and the headless cadence probe
//! (`src/bin/cadence_probe.rs`) can share the real collector loop
//! (`run_collector_loop`) and the snapshot/payload types without a live Tauri
//! `AppHandle`. The bin target stays a thin Tauri shell; everything
//! collection-related lives in this library crate.

pub mod cadence;
pub mod collector;
pub mod error_log;
pub mod hardware;
pub mod pdh;
pub mod sensor;
pub mod state;

pub use cadence::{check_records, parse_jsonl, CadenceCheck, CadenceRecord};
pub use collector::supervisor::{
    lock_status, supervise, CollectorLifecycleState, CollectorStatus, RecoveryPolicy,
    SafeCollectorStatus, SessionRunner, SessionSignals, LIFECYCLE_SCHEMA_VERSION,
    SUPERVISOR_POLL_INTERVAL,
};
pub use collector::{
    build_history_payload, build_snapshot, clamp_window_secs, collect_pdh, is_full_poll_tick,
    physical_disk_list, prime_rate_baselines, query_disk_models_wmi, run_collector_loop,
    slice_aligned_history, slice_history, slice_timestamps, timestamp_window_range, DiskHistory,
    DiskSnapshot, GpuHistory, GpuSnapshot, HistoryPayload, LoopLimit, LoopOutcome, MetricsSnapshot,
    TickTiming, WmiBootstrap, SCHEMA_VERSION, TICK_INTERVAL,
};
pub use sensor::{CpuSensorProvider, GpuSensorProvider, SensorRegistry};
pub use state::{CollectorState, HistoryStore, SafeAppState, SafeHistoryStore};
