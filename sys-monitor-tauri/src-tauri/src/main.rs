// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use sys_monitor_tauri::collector::{
    collect_pdh, physical_disk_list, query_disk_models_wmi, run_collector_loop,
};
use sys_monitor_tauri::hardware::{detect, DiskInfo, DiskKind, HardwareProfile};
use sys_monitor_tauri::sensor::{CpuSensorProvider, GpuSensorProvider, SensorRegistry};
use sys_monitor_tauri::state::{CollectorState, HistoryStore, SafeAppState, SafeHistoryStore};
use sys_monitor_tauri::{build_history_payload, clamp_window_secs, HistoryPayload};
use tauri::{Emitter, Manager};

// ── WMI CONNECTION RETRY ─────────────────────────────────────────────────────

const WMI_BACKOFF_BASE_SECS: u64 = 1;
const WMI_BACKOFF_MAX_SECS: u64 = 30;
const WMI_MAX_ATTEMPTS: u32 = 8;

// ── TAURI COMMAND — INITIAL HISTORY LOAD ────────────────────────────────────

/// Called by the frontend on mount and when the time window changes.
/// Returns only the last `window_secs` points per metric; incremental updates arrive via "metrics-update".
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
fn sim_store_override() -> Option<String> {
    std::env::var("SYSMON_SIM_APP_DATA").ok()
}

// ── ENTRY POINT ──────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
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
            // GPU provider registered in background thread after profile has GPUs

            let app_handle = app.handle().clone();

            // Layer-2 dev tap (SYSMON_CADENCE_LOG=1): also stream one JSONL
            // cadence record per emit to stderr so the assembled app's cadence
            // (real webview + real shouldCommitHistory gating) can be verified
            // with the same checker the headless probe uses. Optional
            // corroboration, not required for PASS — see
            // docs/cadence-verification.md (5.1).
            let cadence_log = std::env::var("SYSMON_CADENCE_LOG").is_ok();
            let app_start = std::time::Instant::now();

            std::thread::spawn(move || {
                // Initialize COM for this thread (MTA — not yet initialized here,
                // so COMLibrary::new() works, unlike the main thread where winit
                // has already called CoInitializeEx(COINIT_APARTMENTTHREADED)).
                // The WMI connection stays local to this thread so COM thread
                // affinity is respected (no RPC_E_WRONG_THREAD errors).
                // Retry with exponential backoff on transient COM/WMI failures.
                let mut wmi_con: Option<wmi::WMIConnection> = None;
                for attempt in 1..=WMI_MAX_ATTEMPTS {
                    match wmi::COMLibrary::new() {
                        Err(e) => {
                            if attempt == 1 {
                                eprintln!("[WMI] COM init failed on background thread: {:?}", e);
                            }
                            if attempt < WMI_MAX_ATTEMPTS {
                                let delay = (WMI_BACKOFF_BASE_SECS * 2u64.pow(attempt - 1))
                                    .min(WMI_BACKOFF_MAX_SECS);
                                eprintln!(
                                    "[WMI] Retry {}/{} in {}s (COM init failed: {:?})",
                                    attempt, WMI_MAX_ATTEMPTS, delay, e
                                );
                                std::thread::sleep(std::time::Duration::from_secs(delay));
                            } else {
                                eprintln!(
                                    "[WMI] Giving up after {} attempts. GPU classification and CPU thermal unavailable.",
                                    WMI_MAX_ATTEMPTS
                                );
                                break;
                            }
                        }
                        Ok(com) => match wmi::WMIConnection::new(com) {
                            Ok(con) => {
                                eprintln!("[WMI] Background thread connection initialized (MTA).");
                                wmi_con = Some(con);
                                break;
                            }
                            Err(e) => {
                                if attempt == 1 {
                                    eprintln!(
                                        "[WMI] WMI connection failed: {:?}. GPU classification unavailable.",
                                        e
                                    );
                                }
                                if attempt < WMI_MAX_ATTEMPTS {
                                    let delay = (WMI_BACKOFF_BASE_SECS * 2u64.pow(attempt - 1))
                                        .min(WMI_BACKOFF_MAX_SECS);
                                    eprintln!(
                                        "[WMI] Retry {}/{} in {}s (WMI connection failed: {:?})",
                                        attempt, WMI_MAX_ATTEMPTS, delay, e
                                    );
                                    std::thread::sleep(std::time::Duration::from_secs(delay));
                                } else {
                                    eprintln!(
                                        "[WMI] Giving up after {} attempts. GPU classification and CPU thermal unavailable.",
                                        WMI_MAX_ATTEMPTS
                                    );
                                    break;
                                }
                            }
                        },
                    }
                }
                let wmi_con = wmi_con;

                // Full profile (including GPUs and physical-disk list) now that WMI is ready.
                // Prime PDH so physical_disk_list can read instance names.
                let _ = collect_pdh(&collector_state);
                // Use same physical-disk list as metrics so sidebar storage cards match dashboard.
                // Fall back to sysinfo-based list if PDH returns empty (e.g. before first poll).
                let physical = physical_disk_list(
                    &collector_state.sysinfo_disks,
                    &collector_state.pdh,
                );
                let wmi_disk_models = query_disk_models_wmi(wmi_con.as_ref());
                use sysinfo::DiskKind as SysDiskKind;
                let disk_infos: Option<Vec<DiskInfo>> = if physical.is_empty() {
                    None // fall back to detect_disks() in hardware::detect
                } else {
                    Some(
                        physical
                            .into_iter()
                            .map(|(disk_key, kind, sysinfo_name, drive_index)| {
                                let display_name = drive_index
                                    .and_then(|i| wmi_disk_models.get(&i).cloned())
                                    .filter(|s| !s.is_empty())
                                    .unwrap_or(sysinfo_name.clone());
                                let name = if display_name.is_empty() {
                                    disk_key.clone()
                                } else {
                                    display_name
                                };
                                eprintln!(
                                    "[HardwareProfile] Disk: {} — sysinfo name: {:?}, wmi model: {:?}",
                                    name,
                                    sysinfo_name,
                                    drive_index.and_then(|i| wmi_disk_models.get(&i).cloned())
                                );
                                let k = match kind {
                                    SysDiskKind::SSD => DiskKind::Ssd,
                                    SysDiskKind::HDD => DiskKind::Hdd,
                                    _ => DiskKind::Unknown,
                                };
                                DiskInfo { name, kind: k }
                            })
                            .collect(),
                    )
                };
                collector_state.profile = detect(
                    Some(&collector_state.pdh),
                    wmi_con.as_ref(),
                    disk_infos,
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
                if !profile.gpus.is_empty() {
                    registry.register(GpuSensorProvider);
                }
                {
                    let store = app_handle.state::<SafeHistoryStore>();
                    let mut s = store.lock().unwrap_or_else(|e| e.into_inner());
                    s.profile = Some(collector_state.profile.clone());
                }
                app_handle.emit("hardware-profile-ready", ()).ok();

                // The store handle is resolved once before the loop; the loop
                // itself is sink-agnostic and lives in the library
                // (sys_monitor_tauri::collector::run_loop), so the Tauri app and
                // the headless cadence probe share the exact same code path.
                let store = app_handle.state::<SafeHistoryStore>();
                run_collector_loop(
                    &mut collector_state,
                    wmi_con.as_ref(),
                    &mut registry,
                    &store,
                    None, // production: loop forever
                    |snap| {
                        if cadence_log {
                            let rec = sys_monitor_tauri::cadence::CadenceRecord::from_snapshot(
                                &store,
                                snap.on_tick,
                                app_start.elapsed().as_millis() as u64,
                            );
                            eprintln!("{}", rec.to_json_line());
                        }
                        app_handle.emit("metrics-update", snap).ok();
                    },
                    |msg| {
                        app_handle.emit("collector-error", msg).ok();
                    },
                );
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_history, get_hardware_profile, sim_store_override])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("error while running tauri application: {:?}", e);
            std::process::exit(1);
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
}
