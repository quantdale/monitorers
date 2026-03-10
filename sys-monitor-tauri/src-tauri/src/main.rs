// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod collector;
mod sensor;
mod state;

use sensor::{CpuSensorProvider, GpuSensorProvider, SensorRegistry};
use state::{CollectorState, HistoryStore, SafeAppState, SafeHistoryStore};
use std::collections::VecDeque;
use tauri::{Emitter, Manager};

// ── WMI CONNECTION RETRY ─────────────────────────────────────────────────────

const WMI_BACKOFF_BASE_SECS: u64 = 1;
const WMI_BACKOFF_MAX_SECS: u64 = 30;
const WMI_MAX_ATTEMPTS: u32 = 8;

const SCHEMA_VERSION: u32 = 1;

// ── SERIALISABLE PAYLOAD TYPES ───────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
pub struct MetricsSnapshot {
    pub schema_version: u32,
    pub cpu: f64,
    pub cpu_name: String,
    pub cpu_temp_c: Option<f64>,
    pub nvidia_temp: Option<f64>,
    #[cfg(feature = "nvml")]
    pub nvidia_power_w: Option<f64>,
    #[cfg(feature = "nvml")]
    pub nvidia_mem_used_mb: Option<u64>,
    #[cfg(feature = "nvml")]
    pub nvidia_mem_total_mb: Option<u64>,
    #[cfg(feature = "nvml")]
    pub nvidia_fan_speed_pct: Option<u32>,
    #[cfg(feature = "nvml")]
    pub nvidia_clock_mhz: Option<u32>,
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
    pub schema_version: u32,
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

/// Returns the last `window_secs` points from the deque, or all if window_secs is 0 or >= len.
fn slice_history(deque: &VecDeque<f64>, window_secs: u64) -> Vec<f64> {
    let n = window_secs as usize;
    let len = deque.len();
    if n == 0 || n >= len {
        deque.iter().copied().collect()
    } else {
        deque.iter().skip(len - n).copied().collect()
    }
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
        schema_version: SCHEMA_VERSION,
        cpu,
        cpu_name: s.cpu_name.clone(),
        cpu_temp_c: s.cpu_temp_c,
        nvidia_temp,
        #[cfg(feature = "nvml")]
        nvidia_power_w: s.nvidia_power_w,
        #[cfg(feature = "nvml")]
        nvidia_mem_used_mb: s.nvidia_mem_used_mb,
        #[cfg(feature = "nvml")]
        nvidia_mem_total_mb: s.nvidia_mem_total_mb,
        #[cfg(feature = "nvml")]
        nvidia_fan_speed_pct: s.nvidia_fan_speed_pct,
        #[cfg(feature = "nvml")]
        nvidia_clock_mhz: s.nvidia_clock_mhz,
        mem,
        mem_used_gb: s.mem_used_gb,
        mem_total_gb: s.mem_total_gb,
        disks,
        net_recv_kb: s.net_recv_history.back().copied().unwrap_or(0.0),
        net_sent_kb: s.net_sent_history.back().copied().unwrap_or(0.0),
        gpus,
    }
}

// ── HISTORY PAYLOAD BUILDER (SLICED) ─────────────────────────────────────────

fn build_history_payload(s: &state::HistoryStore, window_secs: u64) -> HistoryPayload {
    HistoryPayload {
        schema_version: SCHEMA_VERSION,
        cpu: slice_history(&s.cpu_history, window_secs),
        cpu_name: s.cpu_name.clone(),
        cpu_temp_c: s.cpu_temp_c,
        mem: slice_history(&s.mem_history, window_secs),
        disks: s
            .disk_display_order
            .iter()
            .map(|k| DiskHistory {
                key: k.clone(),
                values: s
                    .disk_active_histories
                    .get(k)
                    .map(|h| slice_history(h, window_secs))
                    .unwrap_or_default(),
                read_mb_s: s.disk_read_mb_s.get(k).copied().unwrap_or(0.0),
                write_mb_s: s.disk_write_mb_s.get(k).copied().unwrap_or(0.0),
                avg_response_ms: s.disk_avg_response_ms.get(k).copied().unwrap_or(0.0),
                temp_c: None,
            })
            .collect(),
        net_recv: slice_history(&s.net_recv_history, window_secs),
        net_sent: slice_history(&s.net_sent_history, window_secs),
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
                    values: slice_history(hist, window_secs),
                    temp_c,
                }
            })
            .collect(),
    }
}

// ── TAURI COMMAND — INITIAL HISTORY LOAD ────────────────────────────────────

/// Called by the frontend on mount and when the time window changes.
/// Returns only the last `window_secs` points per metric; incremental updates arrive via "metrics-update".
#[tauri::command]
fn get_history(state: tauri::State<SafeAppState>, window_secs: u64) -> HistoryPayload {
    let s = state.lock().unwrap_or_else(|e| e.into_inner());
    build_history_payload(&s, window_secs)
}

// ── ENTRY POINT ──────────────────────────────────────────────────────────────

// ── TESTS ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    fn deque(vals: &[f64]) -> VecDeque<f64> {
        vals.iter().copied().collect()
    }

    // --- slice_history ---

    #[test]
    fn test_slice_history_window_smaller_than_len() {
        let d = deque(&[1.0, 2.0, 3.0, 4.0, 5.0]);
        assert_eq!(slice_history(&d, 3), vec![3.0, 4.0, 5.0]);
    }

    #[test]
    fn test_slice_history_window_equals_len() {
        let d = deque(&[1.0, 2.0, 3.0]);
        assert_eq!(slice_history(&d, 3), vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn test_slice_history_window_larger_than_len_returns_all() {
        let d = deque(&[10.0, 20.0]);
        assert_eq!(slice_history(&d, 100), vec![10.0, 20.0]);
    }

    #[test]
    fn test_slice_history_window_zero_returns_all() {
        let d = deque(&[1.0, 2.0, 3.0]);
        assert_eq!(slice_history(&d, 0), vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn test_slice_history_empty_deque() {
        let d: VecDeque<f64> = VecDeque::new();
        assert_eq!(slice_history(&d, 10), Vec::<f64>::new());
    }

    #[test]
    fn test_slice_history_window_one() {
        let d = deque(&[7.0, 8.0, 9.0]);
        assert_eq!(slice_history(&d, 1), vec![9.0]);
    }
}

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
            registry.register(GpuSensorProvider);

            let app_handle = app.handle().clone();

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

                let mut tick: u32 = 0;
                loop {
                    let raw = if tick % 4 == 0 {
                        Some(collector::poll(&mut collector_state, wmi_con.as_ref()))
                    } else {
                        None
                    };
                    let reg_raw =
                        registry.poll_all(&mut collector_state, wmi_con.as_ref());

                    let snapshot = {
                        let store = app_handle.state::<SafeHistoryStore>();
                        let mut s = store.lock().unwrap_or_else(|e| e.into_inner());
                        if let Some(ref r) = raw {
                            collector::commit_disk_network(&mut s, r);
                        }
                        registry.commit_all(&mut s, &reg_raw);
                        build_snapshot(&s)
                    };

                    app_handle.emit("metrics-update", snapshot).ok();

                    tick = tick.wrapping_add(1);
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_history])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
