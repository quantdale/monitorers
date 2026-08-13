// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use sys_monitor_tauri::collector::{
    collect_pdh, physical_disk_list, run_collector_loop, MetricsSnapshot, WmiBootstrap,
};
use sys_monitor_tauri::hardware::{
    classify_gpu, detect, DiskInfo, DiskKind, GpuInfo, HardwareProfile,
};
use sys_monitor_tauri::sensor::{CpuSensorProvider, GpuSensorProvider, SensorRegistry};
use sys_monitor_tauri::state::{CollectorState, HistoryStore, SafeAppState, SafeHistoryStore};
use sys_monitor_tauri::{build_history_payload, clamp_window_secs, HistoryPayload};
use tauri::{Emitter, Manager, RunEvent};

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

/// Returns the hardware profile (CPU, GPUs, disks) for settings/about panel. None until background thread has run detect().
#[tauri::command]
fn get_hardware_profile(state: tauri::State<SafeAppState>) -> Option<HardwareProfile> {
    let s = state.lock().unwrap_or_else(|e| e.into_inner());
    s.profile.clone()
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
            let (_, classified_kind) = classify_gpu(&gpu.name);
            let existing = current.gpus.iter().find(|entry| entry.key == gpu.key);
            GpuInfo {
                key: gpu.key.clone(),
                name: gpu.name.clone(),
                vendor: existing
                    .map(|entry| entry.vendor.clone())
                    .unwrap_or_else(|| match gpu.vendor.as_str() {
                        "nvidia" => sys_monitor_tauri::hardware::GpuVendor::Nvidia,
                        "amd" => sys_monitor_tauri::hardware::GpuVendor::Amd,
                        "intel" => sys_monitor_tauri::hardware::GpuVendor::Intel,
                        _ => classify_gpu(&gpu.name).0,
                    }),
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
            // CollectorState::new() must run here (after Tauri/winit has initialised
            // COM via CoInitializeEx) for PDH and sysinfo init.
            let mut collector_state = CollectorState::new();
            let cpu_name = collector_state
                .system
                .cpus()
                .first()
                .map(|c| c.brand().to_string())
                .unwrap_or_default();
            let cpu_name = if cpu_name.is_empty() {
                "CPU".to_string()
            } else {
                cpu_name
            };

            let history_store = HistoryStore::new(&cpu_name);
            app.manage(SafeHistoryStore::new(history_store));

            let mut registry = SensorRegistry::new();
            registry.register(CpuSensorProvider);
            // Register GPU polling even when startup discovery reports no GPU;
            // this permits a later hot-plugged adapter to appear without an
            // application restart. The provider is cheap when PDH exposes no
            // GPU counter and never holds the shared history lock.
            registry.register(GpuSensorProvider);

            let app_handle = app.handle().clone();
            let stop_flag = std::sync::Arc::new(AtomicBool::new(false));
            app.manage(stop_flag.clone());

            // Layer-2 dev tap (SYSMON_CADENCE_LOG=1): also stream one JSONL
            // cadence record per emit to stderr so the assembled app's cadence
            // (real webview + real shouldCommitHistory gating) can be verified
            // with the same checker the headless probe uses. Optional
            // corroboration, not required for PASS — see
            // docs/cadence-verification.md (5.1).
            let cadence_log = std::env::var("SYSMON_CADENCE_LOG").is_ok();

            std::thread::spawn(move || {
                let stop_flag = stop_flag;
                // Wrap the entire background-thread body in catch_unwind so a
                // panic during WMI init, profile detection, or loop startup
                // surfaces as a collector-error instead of silently killing the
                // thread with no user-visible indication.
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    // Build a useful degraded profile before WMI is available.
                    // Core PDH/sysinfo collection must not wait behind WMI
                    // startup or retry sleeps.
                    let _ = collect_pdh(&collector_state);
                    let physical =
                        physical_disk_list(&collector_state.sysinfo_disks, &collector_state.pdh);
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
                    collector_state.profile =
                        detect(Some(&collector_state.pdh), None, disk_infos.clone());
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
                    emit_hardware_profile_ready(&app_handle, &stop_flag);

                    // The store handle is resolved once before the loop; the loop
                    // itself is sink-agnostic and lives in the library
                    // (sys_monitor_tauri::collector::run_loop), so the Tauri app and
                    // the headless cadence probe share the exact same code path.
                    let store = app_handle.state::<SafeHistoryStore>();
                    // Cadence records start at the first emitted tick, not at
                    // app/WMI/profile bootstrap, so startup enrichment cannot
                    // make the wall-clock SLO appear late.
                    let cadence_epoch = std::cell::Cell::new(None::<std::time::Instant>);
                    let last_timing = std::cell::Cell::new(Default::default());
                    let mut wmi_bootstrap = WmiBootstrap::new();
                    run_collector_loop(
                        &mut collector_state,
                        &mut wmi_bootstrap,
                        &mut registry,
                        &store,
                        None, // production: loop forever
                        Some(&*stop_flag),
                        |timing| last_timing.set(timing),
                        |state, wmi| {
                            // WMI enrichment becomes available independently
                            // of the core loop. The connection remains on this
                            // collector MTA thread for all future polls.
                            state.profile = detect(Some(&state.pdh), Some(wmi), disk_infos.clone());
                            let mut shared = store.lock().unwrap_or_else(|e| e.into_inner());
                            shared.profile = Some(state.profile.clone());
                            drop(shared);
                            emit_hardware_profile_ready(&app_handle, &stop_flag);
                        },
                        |snap| {
                            // The collector's grace/prune logic has already
                            // determined the current stable device set in this
                            // snapshot. Keep the sidebar on that same set and
                            // notify the frontend only when metadata changes.
                            let profile_changed = {
                                let mut shared = store.lock().unwrap_or_else(|e| e.into_inner());
                                if let Some(current) = shared.profile.clone() {
                                    let next = reconcile_profile_with_snapshot(&current, snap);
                                    if next != current {
                                        shared.profile = Some(next);
                                        true
                                    } else {
                                        false
                                    }
                                } else {
                                    false
                                }
                            };
                            if profile_changed {
                                emit_hardware_profile_ready(&app_handle, &stop_flag);
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
                                static METRICS_EMIT_ERROR: std::sync::OnceLock<()> =
                                    std::sync::OnceLock::new();
                                if !stop_flag.load(Ordering::Relaxed) {
                                    METRICS_EMIT_ERROR.get_or_init(|| {
                                        eprintln!(
                                            "[Collector] metrics-update delivery failed: {error}"
                                        );
                                    });
                                }
                            }
                        },
                        |msg| {
                            if let Err(error) = app_handle.emit("collector-error", msg) {
                                static COLLECTOR_ERROR_EMIT_ERROR: std::sync::OnceLock<()> =
                                    std::sync::OnceLock::new();
                                if !stop_flag.load(Ordering::Relaxed) {
                                    COLLECTOR_ERROR_EMIT_ERROR.get_or_init(|| {
                                        eprintln!(
                                            "[Collector] collector-error delivery failed: {error}"
                                        );
                                    });
                                }
                            }
                        },
                    );
                }));

                if let Err(e) = result {
                    eprintln!("[Collector] background thread panicked: {:?}", e);
                    // Best-effort: emit a collector-error so the frontend knows.
                    let app_handle_for_error = app_handle.clone();
                    if !stop_flag.load(Ordering::Relaxed) {
                        if let Err(emit_error) = app_handle_for_error.emit(
                            "collector-error",
                            "metrics collection stopped — restart the app",
                        ) {
                            eprintln!("[Collector] failed to deliver panic error: {emit_error}");
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_history,
            get_hardware_profile,
            sim_store_override
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("error while building tauri application: {:?}", e);
            std::process::exit(1);
        });

    app.run(move |app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            if let Some(stop) = app_handle.try_state::<std::sync::Arc<AtomicBool>>() {
                stop.store(true, Ordering::Relaxed);
            }
        }
    });
}

// ── TESTS ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    // Kept (asserts the exact error payload string — distinct from the
    // run_collector_loop panic test in collector/run_loop.rs, which asserts
    // emit/error counts on the real loop). The previous
    // test_catch_unwind_catches_synthetic_panic (tests stdlib) and
    // test_tick_loop_panic_emits_exactly_one_error_and_stops (a hand-rolled
    // reimplementation of the loop) were deleted as tautological/duplicative.

    #[test]
    fn test_catch_unwind_error_payload_emitted() {
        use std::sync::mpsc::channel;

        let (tx, rx) = channel::<String>();
        let emit_error = |payload: &str| tx.send(payload.to_string()).ok();

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            panic!("background thread panicked");
        }));

        if result.is_err() {
            emit_error("metrics collection stopped — restart the app");
        }

        assert_eq!(
            rx.recv().expect("error payload must be emitted"),
            "metrics collection stopped — restart the app"
        );
    }

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
            schema_version: 4,
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
                temp_c: None,
            }],
            net_recv_kb: 0.0,
            net_sent_kb: 0.0,
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
}
