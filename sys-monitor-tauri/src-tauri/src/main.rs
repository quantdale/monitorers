// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod collector;
mod state;

use state::SafeAppState;
use tauri::Manager;

// ── SERIALISABLE PAYLOAD TYPES ───────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
pub struct MetricsSnapshot {
    pub cpu: f64,
    pub cpu_name: String,
    pub cpu_temp_c: Option<f64>,
    pub mem: f64,
    pub mem_used_gb: f64,
    pub mem_total_gb: f64,
    pub disks: Vec<DiskSnapshot>,
    pub net_recv_kb: f64,
    pub net_sent_kb: f64,
    pub gpus: Vec<GpuSnapshot>,
}

#[derive(serde::Serialize, Clone)]
pub struct GpuSnapshot {
    pub name: String,
    pub util: f64,
    pub temp_c: Option<f64>,
}

#[derive(serde::Serialize, Clone)]
pub struct DiskSnapshot {
    pub key: String,
    pub active: f64,
    pub read_mb_s: f64,
    pub write_mb_s: f64,
    pub temp_c: Option<f64>,
}

#[derive(serde::Serialize, Clone)]
pub struct HistoryPayload {
    pub cpu: Vec<f64>,
    pub cpu_name: String,
    pub cpu_temp_c: Option<f64>,
    pub mem: Vec<f64>,
    pub disks: Vec<DiskHistory>,
    pub net_recv: Vec<f64>,
    pub net_sent: Vec<f64>,
    pub gpus: Vec<GpuHistory>,
}

#[derive(serde::Serialize, Clone)]
pub struct GpuHistory {
    pub name: String,
    pub values: Vec<f64>,
    pub temp_c: Option<f64>,
}

#[derive(serde::Serialize, Clone)]
pub struct DiskHistory {
    pub key: String,
    pub values: Vec<f64>,
    pub read_mb_s: f64,
    pub write_mb_s: f64,
    pub temp_c: Option<f64>,
}

// ── SNAPSHOT BUILDER ─────────────────────────────────────────────────────────

fn build_snapshot(s: &state::AppState) -> MetricsSnapshot {
    let cpu = s.cpu_history.back().copied().unwrap_or(0.0);
    let mem = s.mem_history.back().copied().unwrap_or(0.0);
    let total_mem_bytes = s.system.total_memory();
    let used_mem_bytes = s.system.used_memory();
    let mem_total_gb = total_mem_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
    let mem_used_gb = used_mem_bytes as f64 / (1024.0 * 1024.0 * 1024.0);

    let disks = s
        .disk_display_order
        .iter()
        .map(|k| DiskSnapshot {
            key: k.clone(),
            active: s
                .disk_active_histories
                .get(k)
                .and_then(|h| h.back().copied())
                .unwrap_or(0.0),
            read_mb_s: s.disk_read_mb_s.get(k).copied().unwrap_or(0.0),
            write_mb_s: s.disk_write_mb_s.get(k).copied().unwrap_or(0.0),
            temp_c: None,
        })
        .collect();

    let gpus = s
        .gpu_histories
        .iter()
        .map(|(_, name, hist)| GpuSnapshot {
            name: name.clone(),
            util: hist.back().copied().unwrap_or(0.0),
            temp_c: None,
        })
        .collect();

    MetricsSnapshot {
        cpu,
        cpu_name: s.cpu_name.clone(),
        cpu_temp_c: s.cpu_temp_c,
        mem,
        mem_used_gb,
        mem_total_gb,
        disks,
        net_recv_kb: s.net_recv_history.back().copied().unwrap_or(0.0),
        net_sent_kb: s.net_sent_history.back().copied().unwrap_or(0.0),
        gpus,
    }
}

// ── TAURI COMMAND — INITIAL HISTORY LOAD ────────────────────────────────────

/// Called by the frontend once on mount to get the full 3600-point history.
/// After that, incremental updates arrive via the "metrics-update" event.
#[tauri::command]
fn get_history(state: tauri::State<SafeAppState>) -> HistoryPayload {
    let s = state.lock().unwrap();
    HistoryPayload {
        cpu: s.cpu_history.iter().copied().collect(),
        cpu_name: s.cpu_name.clone(),
        cpu_temp_c: s.cpu_temp_c,
        mem: s.mem_history.iter().copied().collect(),
        disks: s
            .disk_display_order
            .iter()
            .map(|k: &String| DiskHistory {
                key: k.clone(),
                values: s
                    .disk_active_histories
                    .get(k)
                    .map(|h: &std::collections::VecDeque<f64>| {
                        h.iter().copied().collect::<Vec<f64>>()
                    })
                    .unwrap_or_default(),
                read_mb_s: s.disk_read_mb_s.get(k).copied().unwrap_or(0.0),
                write_mb_s: s.disk_write_mb_s.get(k).copied().unwrap_or(0.0),
                temp_c: None,
            })
            .collect(),
        net_recv: s.net_recv_history.iter().copied().collect(),
        net_sent: s.net_sent_history.iter().copied().collect(),
        gpus: s
            .gpu_histories
            .iter()
            .map(|(_, name, hist)| GpuHistory {
                name: name.clone(),
                values: hist.iter().copied().collect(),
                temp_c: None,
            })
            .collect(),
    }
}

// ── ENTRY POINT ──────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // AppState::new() must run here (after Tauri/winit has initialised
            // COM via CoInitializeEx) rather than inside manage(), because
            // WMIConnection uses assume_initialized() which requires COM to
            // already be set up on the calling thread.
            let app_state = state::AppState::new();
            app.manage(SafeAppState::new(app_state));

            // Clone the AppHandle — it is Send + Clone and carries a reference
            // to all managed state via Arc internally.
            let app_handle = app.handle();

            std::thread::spawn(move || {
                // Initialize COM for this thread (MTA — not yet initialized here,
                // so COMLibrary::new() works, unlike the main thread where winit
                // has already called CoInitializeEx(COINIT_APARTMENTTHREADED)).
                // The WMI connection stays local to this thread so COM thread
                // affinity is respected (no RPC_E_WRONG_THREAD errors).
                let wmi_con: Option<wmi::WMIConnection> = match wmi::COMLibrary::new() {
                    Ok(com) => match wmi::WMIConnection::new(com) {
                        Ok(con) => {
                            eprintln!("[WMI] Background thread connection initialized (MTA).");
                            Some(con)
                        }
                        Err(e) => {
                            eprintln!("[WMI] WMI connection failed: {:?}. GPU classification unavailable.", e);
                            None
                        }
                    },
                    Err(e) => {
                        eprintln!("[WMI] COM init failed on background thread: {:?}", e);
                        None
                    }
                };
                let wmi_thermal: Option<wmi::WMIConnection> = match wmi::COMLibrary::new() {
                    Ok(com) => match wmi::WMIConnection::with_namespace_path("ROOT\\WMI", com) {
                        Ok(con) => {
                            eprintln!("[WMI] Thermal (ROOT\\WMI) connection initialized.");
                            Some(con)
                        }
                        Err(_) => None,
                    },
                    Err(_) => None,
                };

                loop {
                    std::thread::sleep(std::time::Duration::from_secs(1));

                    // Acquire managed state, poll all metrics, build snapshot.
                    let snapshot = {
                        let state = app_handle.state::<SafeAppState>();
                        let mut s = state.lock().unwrap();
                        collector::refresh_all(&mut s, wmi_con.as_ref(), wmi_thermal.as_ref());
                        build_snapshot(&s)
                    };

                    // Emit to all open frontend windows.
                    app_handle.emit_all("metrics-update", snapshot).ok();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_history])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
