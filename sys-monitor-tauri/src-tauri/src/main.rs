// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use sys_monitor_tauri::collector::{
    physical_disk_list, run_collector_loop, LoopOutcome, MetricsSnapshot, WmiBootstrap,
};
use sys_monitor_tauri::hardware::{classify_gpu, DiskInfo, DiskKind, GpuInfo, HardwareProfile};
use sys_monitor_tauri::sensor::{CpuSensorProvider, GpuSensorProvider, SensorRegistry};
use sys_monitor_tauri::state::{CollectorState, HistoryStore, SafeAppState, SafeHistoryStore};
use sys_monitor_tauri::{
    build_history_payload, clamp_window_secs, lock_status, supervise, CollectorLifecycleState,
    CollectorStatus, HistoryPayload, RecoveryPolicy, SafeCollectorStatus, SessionRunner,
    SessionSignals,
};
use sysinfo::System;
use tauri::{Emitter, Manager, RunEvent};

// ── MANAGED LIFECYCLE FLAGS ──────────────────────────────────────────────────

/// Cooperative shutdown flag for collector sessions (Tauri managed state).
///
/// Tauri resolves managed state by RUST TYPE: `manage()` returns `false` for a
/// type that is already registered and every `State<'_, T>` resolves to that
/// single first-registered value. Two independent flags therefore MUST be two
/// distinct types — wrapping raw `Arc<AtomicBool>` values twice would silently
/// alias them onto one instance (the defect this newtype pair exists to kill:
/// a Retry click could resolve the shutdown flag and permanently stop
/// collection).
#[derive(Clone, Default)]
struct StopFlag(Arc<AtomicBool>);

/// Manual-retry request flag: signaled by the `retry_collection` command,
/// consumed by the supervisor's terminal wait (Tauri managed state).
#[derive(Clone, Default)]
struct RetryRequest(Arc<AtomicBool>);

impl StopFlag {
    fn set(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    fn load(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }

    /// Plain-atomic handle for the supervision/session boundary (the
    /// supervisor and sessions speak `Arc<AtomicBool>`, not Tauri state).
    fn signal_arc(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.0)
    }
}

impl RetryRequest {
    fn store(&self, value: bool) {
        self.0.store(value, Ordering::Relaxed);
    }

    fn signal_arc(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.0)
    }
}

/// Registers both lifecycle flags as DISTINCT managed types and fails loudly
/// if either registration is refused — a silently dropped registration would
/// leave the corresponding `State<'_, T>` unresolvable (panic at first use)
/// or, worse, aliased to another value of the same type.
fn register_lifecycle_flags<M: tauri::Manager<R>, R: tauri::Runtime>(
    manager: &M,
) -> (StopFlag, RetryRequest) {
    let stop = StopFlag::default();
    let retry = RetryRequest::default();
    assert!(
        manager.manage(stop.clone()),
        "StopFlag managed-state registration was refused — lifecycle flags must be distinct managed types"
    );
    assert!(
        manager.manage(retry.clone()),
        "RetryRequest managed-state registration was refused — lifecycle flags must be distinct managed types"
    );
    (stop, retry)
}

// ── TAURI COMMAND — INITIAL HISTORY LOAD ────────────────────────────────────

/// Called by the frontend on mount and when the time window changes.
/// Returns the samples whose recorded timestamps fall within `window_secs` of
/// the newest committed sample; incremental updates arrive via
/// "metrics-update".
#[tauri::command]
fn get_history(state: tauri::State<SafeAppState>, window_secs: u64) -> HistoryPayload {
    // window_secs is an unvalidated u64 across the IPC boundary; clamp it to
    // [1, MAX_HISTORY] before slicing (see clamp_window_secs) so a malformed or
    // abusive value can never mean "entire history" or worse.
    let window_secs = clamp_window_secs(window_secs);
    let s = state.lock().unwrap_or_else(|e| e.into_inner());
    build_history_payload(&s, window_secs)
}

// ── TAURI COMMAND — HARDWARE PROFILE ────────────────────────────────────────

/// Returns the hardware profile (CPU, GPUs, disks) for settings/about panel. None until a collector session has run detect().
#[tauri::command]
fn get_hardware_profile(state: tauri::State<SafeAppState>) -> Option<HardwareProfile> {
    let s = state.lock().unwrap_or_else(|e| e.into_inner());
    s.profile.clone()
}

// ── TAURI COMMAND — COLLECTOR LIFECYCLE ─────────────────────────────────────

/// Latest supervised-collector lifecycle status. Lets a late-mounting frontend
/// learn the current state without waiting for the next transition event.
#[tauri::command]
fn get_collector_status(status: tauri::State<SafeCollectorStatus>) -> CollectorStatus {
    lock_status(&status).clone()
}

/// Manual retry for an exhausted recovery budget. A request is honored only
/// while supervision is `Failed`: the retry flag is signaled, a replacement
/// generation is requested, and `Failed` is returned so the caller can tell
/// the honored path from a coalesced one. Outside `Failed` the command is a
/// no-op that echoes the current state back.
///
/// This command resolves ONLY [`RetryRequest`] — never [`StopFlag`]. The two
/// are distinct managed types precisely so this wiring cannot regress.
#[tauri::command]
fn retry_collection(
    retry: tauri::State<'_, RetryRequest>,
    status: tauri::State<SafeCollectorStatus>,
) -> CollectorLifecycleState {
    let current = lock_status(&status);
    if current.state == CollectorLifecycleState::Failed {
        drop(current);
        retry.store(true);
        return CollectorLifecycleState::Failed;
    }
    current.state
}

/// Simulation-only override: the app-data directory for the per-run settings
/// store. Set by the user-simulation real-app driver (SYSMON_SIM_APP_DATA) so
/// a packaged-app run never touches a developer's real settings.json. Returns
/// None in normal operation (env unset) — production behavior is unchanged.
#[tauri::command]
fn sim_store_override() -> Result<Option<String>, String> {
    let Some(raw) = std::env::var_os("SYSMON_SIM_APP_DATA") else {
        return Ok(None);
    };
    let path = std::path::PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("SYSMON_SIM_APP_DATA must be an absolute path".to_string());
    }
    if !path.is_dir() {
        return Err(format!(
            "simulation settings directory is not available: {}",
            path.display()
        ));
    }
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn emit_hardware_profile_ready(app_handle: &tauri::AppHandle, stopping: &AtomicBool) {
    if let Err(error) = app_handle.emit("hardware-profile-ready", ()) {
        static PROFILE_EMIT_ERROR: std::sync::OnceLock<()> = std::sync::OnceLock::new();
        if !stopping.load(Ordering::Relaxed) {
            PROFILE_EMIT_ERROR.get_or_init(|| {
                eprintln!("[Collector] hardware-profile-ready delivery failed: {error}");
            });
        }
    }
}

/// Best-effort append of a fatal collector error to `collector-error.log` in
/// the app-data directory, so a crash leaves a trace that survives relaunch
/// (stderr is invisible in a windowed release build). Never panics; any I/O
/// failure is reported once on stderr and otherwise ignored.
fn persist_collector_error(app_handle: &tauri::AppHandle, msg: &str) {
    let unix_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = sys_monitor_tauri::error_log::format_error_line(unix_secs, msg);
    let result = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())
        .and_then(|dir| {
            sys_monitor_tauri::error_log::append_capped(
                &dir.join(sys_monitor_tauri::error_log::ERROR_LOG_FILE),
                &line,
                sys_monitor_tauri::error_log::ERROR_LOG_CAP_BYTES,
            )
            .map_err(|e| e.to_string())
        });
    if let Err(error) = result {
        static PERSIST_ERROR: std::sync::OnceLock<()> = std::sync::OnceLock::new();
        PERSIST_ERROR.get_or_init(|| {
            eprintln!("[Collector] could not persist collector-error log: {error}");
        });
    }
}

// ── SUPERVISED SESSION RUNNER ─────────────────────────────────────────────────

/// Production `SessionRunner`: launches one real collector session (fresh
/// `CollectorState`, sensor registry, WMI bootstrap) on its own thread and
/// reports outcomes back to the supervisor. All OS-facing state is constructed
/// per session and discarded when the session ends, so a replacement session
/// never inherits potentially poisoned handles or counters.
struct TauriSessionRunner {
    app_handle: tauri::AppHandle,
    cadence_log: bool,
}

impl SessionRunner for TauriSessionRunner {
    fn start(
        &mut self,
        _generation: u32,
        signals: SessionSignals,
    ) -> std::thread::JoinHandle<LoopOutcome> {
        let app_handle = self.app_handle.clone();
        let cadence_log = self.cadence_log;
        let first_emit = signals.first_emit;
        let stop_flag = signals.stop;

        std::thread::Builder::new()
            .name("collector-session".to_string())
            .spawn(move || {
                // Wrap the entire session body in catch_unwind so a panic during
                // state construction, profile detection, or loop startup becomes
                // a supervised Panicked outcome instead of a silently dead
                // thread with no user-visible indication.
                match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    run_session_body(&app_handle, &stop_flag, &first_emit, cadence_log)
                })) {
                    Ok(outcome) => outcome,
                    Err(payload) => LoopOutcome::Panicked(
                        sys_monitor_tauri::collector::panic_message_of(&payload),
                    ),
                }
            })
            .expect("spawning a collector session thread must not fail")
    }
}

/// One supervised collector session: fresh OS-facing state, bootstrap +
/// hardware-profile enrichment, then the shared tick loop until stop/limit.
fn run_session_body(
    app_handle: &tauri::AppHandle,
    stop_flag: &AtomicBool,
    first_emit: &AtomicBool,
    cadence_log: bool,
) -> LoopOutcome {
    // Fresh session-owned OS state. CollectorState::new() must run after
    // Tauri/winit has initialised COM via CoInitializeEx for PDH/sysinfo init;
    // the WMI connection is opened lazily on this session thread (MTA affinity).
    let mut collector_state = CollectorState::new();

    // Build a useful degraded profile before WMI is available. Core
    // PDH/sysinfo collection must not wait behind WMI startup or retry sleeps.
    let physical = physical_disk_list(&collector_state.sysinfo_disks, &collector_state.pdh);
    use sysinfo::DiskKind as SysDiskKind;
    let disk_infos: Option<Vec<DiskInfo>> = if physical.is_empty() {
        None
    } else {
        Some(
            physical
                .into_iter()
                .map(|(disk_key, kind, sysinfo_name, _drive_index)| {
                    let k = match kind {
                        SysDiskKind::SSD => DiskKind::Ssd,
                        SysDiskKind::HDD => DiskKind::Hdd,
                        _ => DiskKind::Unknown,
                    };
                    DiskInfo {
                        key: disk_key,
                        name: sysinfo_name,
                        kind: k,
                    }
                })
                .collect(),
        )
    };
    // Re-detect with PDH-derived GPUs, reusing the CPU identity the fresh
    // CollectorState already resolved (no second CPU enumeration) and the
    // physical-disk list resolved above.
    collector_state.profile = sys_monitor_tauri::hardware::detect_with_cpu(
        Some(&collector_state.pdh),
        None,
        disk_infos.clone(),
        &collector_state.profile.cpu_identity(),
    );
    let profile = &collector_state.profile;
    println!(
        "[HardwareProfile] CPU: {:?} — {}",
        profile.cpu_vendor, profile.cpu_name
    );
    for gpu in &profile.gpus {
        println!(
            "[HardwareProfile] GPU: {} — {:?} {:?}",
            gpu.name, gpu.vendor, gpu.kind
        );
    }
    for disk in &profile.disks {
        println!("[HardwareProfile] Disk: {} — {:?}", disk.name, disk.kind);
    }
    {
        let store = app_handle.state::<SafeHistoryStore>();
        let mut s = store.lock().unwrap_or_else(|e| e.into_inner());
        s.profile = Some(collector_state.profile.clone());
    }
    emit_hardware_profile_ready(app_handle, stop_flag);

    let mut registry = SensorRegistry::new();
    registry.register(CpuSensorProvider);
    // Register GPU polling even when startup discovery reports no GPU; this
    // permits a later hot-plugged adapter to appear without an application
    // restart. The provider is cheap when PDH exposes no GPU counter and never
    // holds the shared history lock.
    registry.register(GpuSensorProvider);

    let store = app_handle.state::<SafeHistoryStore>();
    // Cadence records start at the first emitted tick, not at app/WMI/profile
    // bootstrap, so startup enrichment cannot make the wall-clock SLO appear late.
    let cadence_epoch = std::cell::Cell::new(None::<std::time::Instant>);
    let last_timing = std::cell::Cell::new(Default::default());
    let mut wmi_bootstrap = WmiBootstrap::new();
    run_collector_loop(
        &mut collector_state,
        &mut wmi_bootstrap,
        &mut registry,
        &store,
        None, // production: loop until stopped
        Some(stop_flag),
        |timing| last_timing.set(timing),
        |state, wmi| {
            // WMI enrichment becomes available independently of the core loop.
            // The connection remains on this session MTA thread for all future
            // polls.
            state.profile = sys_monitor_tauri::hardware::detect_with_cpu(
                Some(&state.pdh),
                Some(wmi),
                disk_infos.clone(),
                &state.profile.cpu_identity(),
            );
            let mut shared = store.lock().unwrap_or_else(|e| e.into_inner());
            shared.profile = Some(state.profile.clone());
            drop(shared);
            emit_hardware_profile_ready(app_handle, stop_flag);
        },
        |snap| {
            // First successful emission marks the session healthy for the
            // supervisor's lifecycle reporting.
            first_emit.store(true, Ordering::Relaxed);

            // The collector's grace/prune logic has already determined the
            // current stable device set in this snapshot. Keep the sidebar on
            // that same set and notify the frontend only when metadata changes.
            // Borrowed (not cloned) read of the current profile: this runs on
            // EVERY emitted tick, so the steady state must not pay a full
            // HardwareProfile deep clone just to conclude "nothing changed".
            let profile_changed = {
                let mut shared = store.lock().unwrap_or_else(|e| e.into_inner());
                match shared.profile.as_ref() {
                    Some(current) => {
                        let next = reconcile_profile_with_snapshot(current, snap);
                        if next != *current {
                            shared.profile = Some(next);
                            true
                        } else {
                            false
                        }
                    }
                    None => false,
                }
            };
            if profile_changed {
                emit_hardware_profile_ready(app_handle, stop_flag);
            }
            if cadence_log {
                let epoch = cadence_epoch.get().unwrap_or_else(|| {
                    let now = std::time::Instant::now();
                    cadence_epoch.set(Some(now));
                    now
                });
                let rec = sys_monitor_tauri::cadence::CadenceRecord::from_snapshot(
                    &store,
                    snap.on_tick,
                    epoch.elapsed().as_millis() as u64,
                    last_timing.get(),
                );
                eprintln!("{}", rec.to_json_line());
            }
            if let Err(error) = app_handle.emit("metrics-update", snap) {
                static METRICS_EMIT_ERROR: std::sync::OnceLock<()> = std::sync::OnceLock::new();
                if !stop_flag.load(Ordering::Relaxed) {
                    METRICS_EMIT_ERROR.get_or_init(|| {
                        eprintln!("[Collector] metrics-update delivery failed: {error}");
                    });
                }
            }
        },
        |msg| {
            // Legacy terminal-message channel: persisted + emitted so existing
            // diagnostics keep working alongside the typed status contract.
            persist_collector_error(app_handle, msg);
            if let Err(error) = app_handle.emit("collector-error", msg) {
                static COLLECTOR_ERROR_EMIT_ERROR: std::sync::OnceLock<()> =
                    std::sync::OnceLock::new();
                if !stop_flag.load(Ordering::Relaxed) {
                    COLLECTOR_ERROR_EMIT_ERROR.get_or_init(|| {
                        eprintln!("[Collector] collector-error delivery failed: {error}");
                    });
                }
            }
        },
    )
}

/// Reconcile the sidebar profile with the stable identities currently present
/// in the committed dashboard snapshot. This is intentionally metadata-only:
/// all PDH/WMI/sysinfo work remains on the collector thread and outside the
/// HistoryStore lock. WMI enrichment may later replace the conservative
/// metadata for the same keys, but a hot-plugged device becomes visible (and a
/// pruned device disappears) without waiting for an app restart.
fn reconcile_profile_with_snapshot(
    current: &HardwareProfile,
    snapshot: &MetricsSnapshot,
) -> HardwareProfile {
    let gpus = snapshot
        .gpus
        .iter()
        .map(|gpu| {
            let (classified_vendor, classified_kind) = classify_gpu(&gpu.name);
            let existing = current.gpus.iter().find(|entry| entry.key == gpu.key);
            GpuInfo {
                key: gpu.key.clone(),
                name: gpu.name.clone(),
                vendor: existing.map(|entry| entry.vendor.clone()).unwrap_or(
                    match gpu.vendor.as_str() {
                        "nvidia" => sys_monitor_tauri::hardware::GpuVendor::Nvidia,
                        "amd" => sys_monitor_tauri::hardware::GpuVendor::Amd,
                        "intel" => sys_monitor_tauri::hardware::GpuVendor::Intel,
                        _ => classified_vendor,
                    },
                ),
                kind: existing
                    .filter(|entry| entry.kind != sys_monitor_tauri::hardware::GpuKind::Unknown)
                    .map(|entry| entry.kind.clone())
                    .unwrap_or(classified_kind),
            }
        })
        .collect();
    let disks = snapshot
        .disks
        .iter()
        .map(|disk| {
            current
                .disks
                .iter()
                .find(|entry| entry.key == disk.key)
                .cloned()
                .unwrap_or_else(|| DiskInfo {
                    key: disk.key.clone(),
                    // The snapshot contract intentionally carries only the
                    // stable key; physical_disk_list/WMI can enrich the
                    // presentation on the next profile refresh.
                    name: disk.key.clone(),
                    kind: DiskKind::Unknown,
                })
        })
        .collect();
    HardwareProfile {
        cpu_vendor: current.cpu_vendor.clone(),
        cpu_name: current.cpu_name.clone(),
        gpus,
        disks,
    }
}

// ── ENTRY POINT ──────────────────────────────────────────────────────────────

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            // Startup fast path: only the CPU brand string is needed here, so
            // build it from a CPU-only sysinfo refresh. A full CollectorState
            // would additionally open the PDH query + counters, load the NVML
            // DLL, enumerate disks/networks and pay sysinfo's
            // MINIMUM_CPU_UPDATE_INTERVAL re-refresh — several hundred ms of
            // duplicated OS work that the supervised session (which owns the
            // real state) repeats properly moments later.
            let probe_system = System::new_with_specifics(
                sysinfo::RefreshKind::nothing()
                    .with_cpu(sysinfo::CpuRefreshKind::everything()),
            );
            let cpu_name = probe_system
                .cpus()
                .first()
                .map(|c| c.brand().to_string())
                .unwrap_or_default();

            let history_store = HistoryStore::new(&cpu_name);
            app.manage(SafeHistoryStore::new(history_store));

            let policy = RecoveryPolicy::production();
            app.manage(SafeCollectorStatus::new(CollectorStatus::initial(
                policy.max_attempts,
            )));

            let (stop_flag, retry_request) = register_lifecycle_flags(app);

            // Layer-2 dev tap (SYSMON_CADENCE_LOG=1): also stream one JSONL
            // cadence record per emit to stderr so the assembled app's cadence
            // (real webview + real shouldCommitHistory gating) can be verified
            // with the same checker the headless probe uses. Optional
            // corroboration, not required for PASS — see
            // docs/cadence-verification.md (5.1).
            let cadence_log = std::env::var("SYSMON_CADENCE_LOG").is_ok();

            // Supervised lifecycle: owns exactly one live session, replaces
            // panicked sessions within the bounded budget, reports every
            // transition through the typed status contract.
            let supervisor_handle = app.handle().clone();
            std::thread::Builder::new()
                .name("collector-supervisor".to_string())
                .spawn(move || {
                    let mut runner = TauriSessionRunner {
                        app_handle: supervisor_handle.clone(),
                        cadence_log,
                    };
                    let status_store = supervisor_handle.state::<SafeCollectorStatus>();
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        supervise(
                            &mut runner,
                            stop_flag.signal_arc(),
                            retry_request.signal_arc(),
                            policy,
                            |status| {
                                {
                                    let mut guard = lock_status(&status_store);
                                    *guard = status.clone();
                                }
                                if let Err(error) =
                                    supervisor_handle.emit("collector-status", status)
                                {
                                    static STATUS_EMIT_ERROR: std::sync::OnceLock<()> =
                                        std::sync::OnceLock::new();
                                    if !stop_flag.load() {
                                        STATUS_EMIT_ERROR.get_or_init(|| {
                                            eprintln!(
                                                "[Supervisor] collector-status delivery failed: {error}"
                                            );
                                        });
                                    }
                                }
                            },
                        );
                    }));
                    // Insurance: the supervisor itself must never die silently.
                    if result.is_err() {
                        eprintln!("[Supervisor] supervisor thread panicked");
                        persist_collector_error(
                            &supervisor_handle,
                            "metrics collection stopped — restart the app",
                        );
                        let _ = supervisor_handle.emit(
                            "collector-error",
                            "metrics collection stopped — restart the app",
                        );
                    }
                })
                .expect("spawning the supervisor thread must not fail");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_history,
            get_hardware_profile,
            get_collector_status,
            retry_collection,
            sim_store_override
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("error while building tauri application: {:?}", e);
            std::process::exit(1);
        });

    app.run(move |app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            // Shutdown resolves ONLY the typed stop flag — it must never touch
            // RetryRequest (see the StopFlag/RetryRequest type distinction).
            if let Some(stop) = app_handle.try_state::<StopFlag>() {
                stop.set();
            }
        }
    });
}

// ── TESTS ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    #[test]
    fn test_profile_reconciliation_follows_committed_stable_device_set() {
        use super::{
            reconcile_profile_with_snapshot, DiskInfo, DiskKind, GpuInfo, HardwareProfile,
            MetricsSnapshot,
        };
        use sys_monitor_tauri::collector::{DiskSnapshot, GpuSnapshot};
        use sys_monitor_tauri::hardware::{CpuVendor, GpuKind, GpuVendor};

        let profile = HardwareProfile {
            cpu_vendor: CpuVendor::Unknown,
            cpu_name: "CPU".to_string(),
            gpus: vec![GpuInfo {
                key: "gpu-old".to_string(),
                name: "GeForce RTX 3060".to_string(),
                vendor: GpuVendor::Nvidia,
                kind: GpuKind::Discrete,
            }],
            disks: vec![DiskInfo {
                key: "disk-old".to_string(),
                name: "Old disk".to_string(),
                kind: DiskKind::Ssd,
            }],
        };
        let snapshot = MetricsSnapshot {
            schema_version: 5,
            on_tick: true,
            cpu: 10.0,
            cpu_name: "CPU".to_string(),
            cpu_temp_c: None,
            mem: 20.0,
            mem_used_gb: 1.0,
            mem_total_gb: 2.0,
            disks: vec![DiskSnapshot {
                key: "disk-new".to_string(),
                active: 0.0,
                read_mb_s: 0.0,
                write_mb_s: 0.0,
                avg_response_ms: 0.0,
            }],
            net_recv_kib_s: 0.0,
            net_sent_kib_s: 0.0,
            gpus: vec![GpuSnapshot {
                key: "gpu-new".to_string(),
                name: "Intel Arc A770".to_string(),
                vendor: "intel".to_string(),
                util: 0.0,
                temp_c: None,
                nvidia: None,
            }],
        };

        let next = reconcile_profile_with_snapshot(&profile, &snapshot);
        assert_eq!(next.gpus[0].key, "gpu-new");
        assert_eq!(next.gpus[0].kind, GpuKind::Discrete);
        assert_eq!(next.disks[0].key, "disk-new");
        assert_eq!(next.disks[0].kind, DiskKind::Unknown);
    }

    // ── Retry/stop managed-state wiring (real Tauri seam) ──
    //
    // These tests exercise the actual type-keyed managed-state resolution and
    // the real command body against a headless MockRuntime app. The historical
    // defect: two raw `Arc<AtomicBool>` values were both passed to `manage()`;
    // Tauri keys state by type, so the second registration was refused, its
    // value dropped on the floor, and BOTH the retry command and the exit path
    // resolved the shutdown flag — a Retry click could stop collection forever.

    use super::{
        lock_status, register_lifecycle_flags, retry_collection, supervise,
        CollectorLifecycleState, CollectorStatus, RecoveryPolicy, RetryRequest,
        SafeCollectorStatus, SessionRunner, SessionSignals, StopFlag,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex as StdMutex};
    type SharedLog<T> = Arc<StdMutex<Vec<T>>>;
    use std::time::{Duration, Instant};
    use tauri::Manager as _;

    fn failed_status(reason: &str) -> CollectorStatus {
        CollectorStatus {
            schema_version: 1,
            state: CollectorLifecycleState::Failed,
            generation: 3,
            attempt: 4,
            max_attempts: 2,
            reason: Some(reason.to_string()),
            timestamp_ms: 0,
        }
    }

    #[test]
    fn retry_command_signals_only_the_retry_flag_from_failed() {
        let app = tauri::test::mock_app();
        let (stop, _retry) = register_lifecycle_flags(&app);
        app.manage(StdMutex::new(failed_status("budget exhausted")));

        // The registered flags must be independent values: same-type aliasing
        // would make Arc::ptr_eq hold here.
        let retry_state = app.state::<RetryRequest>();
        assert!(!Arc::ptr_eq(&stop.signal_arc(), &retry_state.signal_arc()));

        // Real command body, real State resolution.
        let answer = retry_collection(retry_state, app.state::<SafeCollectorStatus>());
        assert_eq!(answer, CollectorLifecycleState::Failed);
        assert!(
            app.state::<RetryRequest>().0.load(Ordering::Relaxed),
            "retry must be signaled"
        );
        assert!(!stop.load(), "a Retry click must NEVER set the stop flag");
    }

    #[test]
    fn flag_resolution_is_independent_of_registration_order() {
        let app = tauri::test::mock_app();
        // Deliberately REVERSE the production registration order to prove the
        // wiring does not depend on insertion order (with aliased same-type
        // state, whichever flag registered first would absorb both writes).
        assert!(
            app.manage(RetryRequest::default()),
            "first registration must win"
        );
        assert!(
            app.manage(StopFlag::default()),
            "distinct types never collide"
        );
        // A duplicate same-type registration is refused loudly by manage();
        // our register helper asserts on it. Raw behavior check:
        assert!(
            !app.manage(RetryRequest::default()),
            "duplicate type must be refused"
        );

        app.state::<RetryRequest>().store(true);
        assert!(app.state::<RetryRequest>().0.load(Ordering::Relaxed));
        assert!(!app.state::<StopFlag>().load());
        app.state::<StopFlag>().set();
        assert!(app.state::<StopFlag>().load());
        assert!(app.state::<RetryRequest>().0.load(Ordering::Relaxed));
    }

    #[test]
    fn retry_outside_failed_is_coalesced_and_signals_nothing() {
        let app = tauri::test::mock_app();
        let (stop, _retry) = register_lifecycle_flags(&app);
        let mut healthy = failed_status("x");
        healthy.state = CollectorLifecycleState::Healthy;
        healthy.attempt = 0;
        app.manage(StdMutex::new(healthy));

        for state in [
            CollectorLifecycleState::Healthy,
            CollectorLifecycleState::Starting,
            CollectorLifecycleState::Recovering,
            CollectorLifecycleState::Stopping,
        ] {
            {
                let status_state = app.state::<SafeCollectorStatus>();
                let mut guard = lock_status(&status_state);
                guard.state = state;
            }
            let answer = retry_collection(
                app.state::<RetryRequest>(),
                app.state::<SafeCollectorStatus>(),
            );
            assert_eq!(answer, state, "coalesced click echoes the current state");
            assert!(
                !app.state::<RetryRequest>().0.load(Ordering::Relaxed),
                "{state:?} must not be signaled"
            );
            assert!(!stop.load(), "{state:?} must not touch the stop flag");
        }
    }

    // Scripted runner for the end-to-end supervision seam: generations 1..=N
    // panic instantly (driving escalation into Failed); the generation started
    // by a manual retry emits data and stays alive until stopped.
    struct RetryScriptRunner {
        fail_generations: u32,
        generations_seen: SharedLog<u32>,
        replacement_started: Arc<AtomicUsize>,
    }

    impl SessionRunner for RetryScriptRunner {
        fn start(
            &mut self,
            generation: u32,
            signals: SessionSignals,
        ) -> std::thread::JoinHandle<super::LoopOutcome> {
            self.generations_seen
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(generation);
            let panics = generation <= self.fail_generations;
            let replacement_started = Arc::clone(&self.replacement_started);
            std::thread::Builder::new()
                .name("scripted-session".to_string())
                .spawn(move || {
                    if panics {
                        return super::LoopOutcome::Panicked(format!(
                            "synthetic panic gen {generation}"
                        ));
                    }
                    replacement_started.fetch_add(1, Ordering::SeqCst);
                    // First successful emission → supervisor reports Healthy.
                    signals.first_emit.store(true, Ordering::Relaxed);
                    // Replacement session stays alive until cooperative stop.
                    while !signals.stop.load(Ordering::Relaxed) {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                    super::LoopOutcome::Stopped
                })
                .expect("scripted session spawn must not fail")
        }
    }

    impl RetryScriptRunner {
        fn new(
            fail_generations: u32,
        ) -> (Self, SharedLog<u32>, SharedLog<CollectorLifecycleState>) {
            let generations = Arc::new(StdMutex::new(Vec::new()));
            let statuses = Arc::new(StdMutex::new(Vec::new()));
            (
                Self {
                    fail_generations,
                    generations_seen: Arc::clone(&generations),
                    replacement_started: Arc::new(AtomicUsize::new(0)),
                },
                generations,
                statuses,
            )
        }
    }

    fn wait_for_status(
        statuses: &StdMutex<Vec<CollectorLifecycleState>>,
        want: CollectorLifecycleState,
        timeout: Duration,
    ) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if statuses.lock().unwrap_or_else(|e| e.into_inner()).last() == Some(&want) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        false
    }

    #[test]
    fn manual_retry_from_failed_starts_exactly_one_replacement_generation_without_stopping() {
        let app = tauri::test::mock_app();
        // The supervisor thread consumes EXACTLY the instances registered as
        // managed state — the same seam production setup wires.
        let (stop_flag, retry_request) = register_lifecycle_flags(&app);
        app.manage(StdMutex::new(CollectorStatus::initial(2)));

        // 3 failing sessions exhaust the 2-attempt budget → Failed.
        let (mut runner, generations, statuses) = RetryScriptRunner::new(3);
        let policy = RecoveryPolicy {
            max_attempts: 2,
            base_backoff: Duration::from_millis(1),
            max_backoff: Duration::from_millis(2),
            healthy_reset_after: Duration::from_secs(3600),
        };
        let statuses_cb = Arc::clone(&statuses);
        let supervisor_stop = stop_flag.signal_arc();
        let supervisor_retry = retry_request.signal_arc();
        let supervisor_handle = app.handle().clone();
        let supervisor = std::thread::Builder::new()
            .name("test-supervisor".to_string())
            .spawn(move || {
                supervise(
                    &mut runner,
                    supervisor_stop,
                    supervisor_retry,
                    policy,
                    |status| {
                        // Mirror production wiring: transitions land in the
                        // MANAGED status store the command reads.
                        {
                            let store = supervisor_handle.state::<SafeCollectorStatus>();
                            let mut guard = lock_status(&store);
                            *guard = status.clone();
                        }
                        statuses_cb
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .push(status.state);
                    },
                );
            });

        assert!(
            wait_for_status(
                &statuses,
                CollectorLifecycleState::Failed,
                Duration::from_secs(10)
            ),
            "supervision must reach Failed after exhausting the budget"
        );

        // THE REGRESSION: from Failed, a user Retry click goes through the real
        // managed-state/command seam. It must signal the supervisor's retry
        // path — never the stop flag — and produce exactly one replacement
        // generation whose first data makes it Healthy, with no Stopping in
        // between.
        let answer = retry_collection(
            app.state::<RetryRequest>(),
            app.state::<SafeCollectorStatus>(),
        );
        assert_eq!(
            answer,
            CollectorLifecycleState::Failed,
            "honored retry answers Failed"
        );
        assert!(
            !app.state::<StopFlag>().load(),
            "stop flag must stay false across the retry click"
        );

        assert!(
            wait_for_status(
                &statuses,
                CollectorLifecycleState::Healthy,
                Duration::from_secs(10)
            ),
            "replacement session must become Healthy after its first data"
        );

        let seen = generations
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        assert_eq!(
            seen,
            vec![1, 2, 3, 4],
            "exactly one replacement generation may start"
        );

        let history = statuses.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let failed_idx = history
            .iter()
            .rposition(|s| *s == CollectorLifecycleState::Failed)
            .unwrap();
        let healthy_idx = history
            .iter()
            .rposition(|s| *s == CollectorLifecycleState::Healthy)
            .unwrap();
        assert!(healthy_idx > failed_idx);
        assert!(
            !history[failed_idx..=healthy_idx].contains(&CollectorLifecycleState::Stopping),
            "no Stopping transition may appear between Failed and post-retry Healthy: {history:?}"
        );

        // Cooperative shutdown ends the test cleanly.
        app.state::<StopFlag>().set();
        supervisor
            .expect("test supervisor thread must spawn")
            .join()
            .expect("supervisor thread must not panic");
    }
}
