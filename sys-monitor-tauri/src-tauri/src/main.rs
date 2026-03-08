// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod collector;
mod state;

use state::{CollectorState, HistoryStore, SafeAppState, SafeHistoryStore};
use tauri::Manager;

// ── WMI CONNECTION RETRY ─────────────────────────────────────────────────────

const WMI_BACKOFF_BASE_SECS: u64 = 1;
const WMI_BACKOFF_MAX_SECS: u64 = 30;
const WMI_MAX_ATTEMPTS: u32 = 8;

// ── SERIALISABLE PAYLOAD TYPES ───────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
pub struct MetricsSnapshot {
    pub cpu: f64,
    pub cpu_name: String,
    pub cpu_temp_c: Option<f64>,
    pub nvidia_temp: Option<f64>,
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
    pub avg_response_ms: f64,
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
    pub avg_response_ms: f64,
    pub temp_c: Option<f64>,
}

// ── SNAPSHOT BUILDER ─────────────────────────────────────────────────────────

fn build_snapshot(s: &state::HistoryStore) -> MetricsSnapshot {
    let cpu = s.cpu_history.back().copied().unwrap_or(0.0);
    let mem = s.mem_history.back().copied().unwrap_or(0.0);

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
            avg_response_ms: s.disk_avg_response_ms.get(k).copied().unwrap_or(0.0),
            temp_c: None,
        })
        .collect();

    let nvidia_temp = s.nvidia_temp;
    let gpus = s
        .gpu_entries
        .iter()
        .map(|(_, name, hist)| {
            let temp_c = if collector::is_nvidia_gpu(name) && nvidia_temp.is_some() {
                nvidia_temp
            } else {
                None
            };
            GpuSnapshot {
                name: name.clone(),
                util: hist.back().copied().unwrap_or(0.0),
                temp_c,
            }
        })
        .collect();

    MetricsSnapshot {
        cpu,
        cpu_name: s.cpu_name.clone(),
        cpu_temp_c: s.cpu_temp_c,
        nvidia_temp,
        mem,
        mem_used_gb: s.mem_used_gb,
        mem_total_gb: s.mem_total_gb,
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
    let s = state.lock().unwrap_or_else(|e| e.into_inner());
    HistoryPayload {
        cpu: s.cpu_history.iter().copied().collect(),
        cpu_name: s.cpu_name.clone(),
        cpu_temp_c: s.cpu_temp_c,
        mem: s.mem_history.iter().copied().collect(),
        disks: s
            .disk_display_order
            .iter()
            .map(|k| DiskHistory {
                key: k.clone(),
                values: s
                    .disk_active_histories
                    .get(k)
                    .map(|h| h.iter().copied().collect::<Vec<f64>>())
                    .unwrap_or_default(),
                read_mb_s: s.disk_read_mb_s.get(k).copied().unwrap_or(0.0),
                write_mb_s: s.disk_write_mb_s.get(k).copied().unwrap_or(0.0),
                avg_response_ms: s.disk_avg_response_ms.get(k).copied().unwrap_or(0.0),
                temp_c: None,
            })
            .collect(),
        net_recv: s.net_recv_history.iter().copied().collect(),
        net_sent: s.net_sent_history.iter().copied().collect(),
        gpus: s
            .gpu_entries
            .iter()
            .map(|(_, name, hist)| {
                let temp_c = if collector::is_nvidia_gpu(name) && s.nvidia_temp.is_some() {
                    s.nvidia_temp
                } else {
                    None
                };
                GpuHistory {
                    name: name.clone(),
                    values: hist.iter().copied().collect(),
                    temp_c,
                }
            })
            .collect(),
    }
}

// ── ENTRY POINT ──────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
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

            let app_handle = app.handle();

            std::thread::spawn(move || {
                // Initialize COM for this thread (MTA — not yet initialized here,
                // so COMLibrary::new() works, unlike the main thread where winit
                // has already called CoInitializeEx(COINIT_APARTMENTTHREADED)).
                // The WMI connection stays local to this thread so COM thread
                // affinity is respected (no RPC_E_WRONG_THREAD errors).
                // Retry with exponential backoff on transient COM/WMI failures.
                let wmi_con: Option<wmi::WMIConnection> = 'wmi_init: loop {
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
                                    break 'wmi_init None;
                                }
                            }
                            Ok(com) => match wmi::WMIConnection::new(com) {
                                Ok(con) => {
                                    eprintln!("[WMI] Background thread connection initialized (MTA).");
                                    break 'wmi_init Some(con);
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
                                        break 'wmi_init None;
                                    }
                                }
                            },
                        }
                    }
                    break None;
                };

                loop {
                    std::thread::sleep(std::time::Duration::from_secs(1));

                    // All slow I/O — no lock held
                    let raw = collector::poll(&mut collector_state, wmi_con.as_ref());

                    // Lock held for microseconds only
                    let snapshot = {
                        let store = app_handle.state::<SafeHistoryStore>();
                        let mut s = store.lock().unwrap_or_else(|e| e.into_inner());
                        collector::commit(&mut s, &raw);
                        build_snapshot(&s)
                    };

                    app_handle.emit_all("metrics-update", snapshot).ok();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_history])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
