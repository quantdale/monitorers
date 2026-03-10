mod cpu;
mod disk;
mod gpu;
pub mod nvidia;

pub use cpu::query_cpu_temp_c;
pub use gpu::is_nvidia_gpu;
pub use gpu::query_gpu_utilization_pdh;
#[cfg(all(feature = "nvapi", not(feature = "nvml")))]
pub use nvidia::query_nvidia_gpu_temp;

use std::collections::{HashMap, VecDeque};
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCollectQueryData, PdhOpenQueryW,
};

// ── PUSH HISTORY HELPER ──────────────────────────────────────────────────────

const MAX_HISTORY: usize = 3600;

pub fn push_history(deque: &mut std::collections::VecDeque<f64>, value: f64, max_len: usize) {
    deque.push_back(value);
    if deque.len() > max_len {
        deque.pop_front();
    }
}

// ── PDH INITIALIZATION ───────────────────────────────────────────────────────

/// Open a PDH query and register GPU + disk utilization counters once at startup.
///
/// Returns `Some(PdhHandles)` with all counters that could be opened.
/// Returns `None` if the query or 3D counter cannot be opened.
///
/// The query handle must live for the process lifetime — recreating it resets
/// the baseline and always returns 0%.
pub fn new_pdh_gpu_query() -> Option<crate::state::PdhHandles> {
    // SAFETY: PDH C API calls via FFI. All pointer arguments are stack variables.
    // Return codes are checked before any output values are read.
    unsafe {
        let mut query: isize = 0;
        if PdhOpenQueryW(None, 0, &mut query) != 0 {
            eprintln!("[PDH] PdhOpenQueryW failed — GPU metrics unavailable.");
            return None;
        }

        let path_3d = windows::core::w!(r"\GPU Engine(*engtype_3D*)\Utilization Percentage");
        let mut counter_3d: isize = 0;
        if PdhAddEnglishCounterW(query, path_3d, 0, &mut counter_3d) != 0 {
            eprintln!("[PDH] Failed to add GPU 3D counter — GPU metrics unavailable.");
            return None;
        }

        // Disk % Idle Time added to the same query as GPU so one
        // PdhCollectQueryData snapshots both domains atomically.
        // active% = 100 - idle%  (inverted in query_disk_active_time).
        let path_disk_active = windows::core::w!(r"\PhysicalDisk(*)\% Idle Time");
        let mut counter_disk_active: isize = 0;
        let counter_disk_opt =
            if PdhAddEnglishCounterW(query, path_disk_active, 0, &mut counter_disk_active) == 0 {
                Some(counter_disk_active)
            } else {
                eprintln!("[PDH] Failed to add disk idle time counter.");
                None
            };

        let path_disk_read = windows::core::w!(r"\PhysicalDisk(*)\Disk Read Bytes/sec");
        let mut counter_disk_read: isize = 0;
        let counter_disk_read_opt =
            if PdhAddEnglishCounterW(query, path_disk_read, 0, &mut counter_disk_read) == 0 {
                Some(counter_disk_read)
            } else {
                eprintln!("[PDH] Failed to add disk read bytes/sec counter.");
                None
            };

        let path_disk_write = windows::core::w!(r"\PhysicalDisk(*)\Disk Write Bytes/sec");
        let mut counter_disk_write: isize = 0;
        let counter_disk_write_opt =
            if PdhAddEnglishCounterW(query, path_disk_write, 0, &mut counter_disk_write) == 0 {
                Some(counter_disk_write)
            } else {
                eprintln!("[PDH] Failed to add disk write bytes/sec counter.");
                None
            };

        let path_disk_response = windows::core::w!(r"\PhysicalDisk(*)\Avg. Disk sec/Transfer");
        let mut counter_disk_response: isize = 0;
        let counter_disk_response_opt =
            if PdhAddEnglishCounterW(query, path_disk_response, 0, &mut counter_disk_response) == 0
            {
                Some(counter_disk_response)
            } else {
                eprintln!("[PDH] Failed to add disk avg response time counter.");
                None
            };

        // First collect — establishes the baseline (value₁). Real readings
        // start on the second poll. The first result is always 0%, by design.
        let _ = PdhCollectQueryData(query);
        eprintln!("[PDH] GPU/disk counters initialized successfully.");
        Some(crate::state::PdhHandles {
            query: Some(query),
            gpu_3d_counter: Some(counter_3d),
            disk_active_counter: counter_disk_opt,
            disk_read_counter: counter_disk_read_opt,
            disk_write_counter: counter_disk_write_opt,
            disk_response_counter: counter_disk_response_opt,
        })
    }
}

// ── POLL AND COMMIT ───────────────────────────────────────────────────────────

/// Run PdhCollectQueryData so that GPU (and disk) counter reads see fresh data.
/// Call this before query_gpu_utilization_pdh when polling only GPU via sensor registry.
pub fn collect_pdh(collector: &crate::state::CollectorState) -> bool {
    match collector.pdh.query {
        Some(query) => unsafe { PdhCollectQueryData(query) == 0 },
        None => false,
    }
}

/// Run all slow I/O using CollectorState — no lock held. Returns RawPoll with
/// fresh values. PdhCollectQueryData is called exactly once per poll.
pub fn poll(
    collector: &mut crate::state::CollectorState,
    wmi_con: Option<&wmi::WMIConnection>,
) -> crate::state::RawPoll {
    // CPU
    collector.system.refresh_cpu_usage();
    let cpu_usage = collector.system.global_cpu_usage().clamp(0.0, 100.0_f32) as f64;

    let cpu_temp_c = cpu::query_cpu_temp_c(wmi_con);
    if cpu_temp_c.is_none() {
        collector.cpu_temp_error_lock.get_or_init(|| {
            eprintln!("[Thermal] CPU temperature unavailable (Win32_PerfFormattedData_Counters_ThermalZoneInformation not present or empty).");
        });
    }

    // Memory
    collector.system.refresh_memory();
    let used_mem = collector.system.used_memory();
    let total_mem = collector.system.total_memory();
    let mem_pct = if total_mem > 0 {
        (used_mem as f64 / total_mem as f64) * 100.0
    } else {
        0.0
    };
    let mem_used_gb = used_mem as f64 / (1024.0 * 1024.0 * 1024.0);
    let mem_total_gb = total_mem as f64 / (1024.0 * 1024.0 * 1024.0);

    // Network
    collector.sysinfo_networks.refresh(false);
    let mut total_recv_bytes = 0u64;
    let mut total_sent_bytes = 0u64;
    for (iface_name, data) in &collector.sysinfo_networks {
        let name_upper = iface_name.to_uppercase();
        if name_upper.contains("LOOPBACK") || name_upper == "LO" {
            continue;
        }
        total_recv_bytes += data.received();
        total_sent_bytes += data.transmitted();
    }
    let net_recv_kb_s = (total_recv_bytes as f64 / 1024.0).max(0.0);
    let net_sent_kb_s = (total_sent_bytes as f64 / 1024.0).max(0.0);

    // Single PdhCollectQueryData call covers both GPU and disk counters.
    let pdh_collected_ok = match collector.pdh.query {
        Some(query) => unsafe { PdhCollectQueryData(query) == 0 },
        None => false,
    };

    let (disk_active, disk_read_mb_s, disk_write_mb_s, disk_avg_response_ms, disk_display_order) =
        if pdh_collected_ok {
            disk::poll_disk(&mut collector.sysinfo_disks, &collector.pdh)
        } else {
            (
                HashMap::new(),
                HashMap::new(),
                HashMap::new(),
                HashMap::new(),
                Vec::new(),
            )
        };

    let gpu_updates =
        gpu::query_gpu_utilization_pdh(&collector.pdh, wmi_con, &collector.gpu_error_lock);

    #[cfg(feature = "nvml")]
    let (nvidia_temp, nvidia_power_w, nvidia_mem_used_mb, nvidia_mem_total_mb, nvidia_fan_speed_pct, nvidia_clock_mhz) =
        if let Some(ref nvml) = collector.nvml {
            let r = nvidia::query_nvml(nvml);
            (
                r.temp_c,
                r.power_w,
                r.mem_used_mb,
                r.mem_total_mb,
                r.fan_speed_pct,
                r.clock_mhz,
            )
        } else {
            (None, None, None, None, None, None)
        };

    #[cfg(all(feature = "nvapi", not(feature = "nvml")))]
    let nvidia_temp = nvidia::query_nvidia_gpu_temp(collector.nvapi_initialized).map(|t| t as f64);

    #[cfg(not(any(feature = "nvml", feature = "nvapi")))]
    let nvidia_temp: Option<f64> = None;

    crate::state::RawPoll {
        cpu_usage,
        cpu_temp_c,
        mem_used_gb,
        mem_total_gb,
        mem_pct,
        gpu_updates,
        nvidia_temp,
        #[cfg(feature = "nvml")]
        nvidia_power_w,
        #[cfg(feature = "nvml")]
        nvidia_mem_used_mb,
        #[cfg(feature = "nvml")]
        nvidia_mem_total_mb,
        #[cfg(feature = "nvml")]
        nvidia_fan_speed_pct,
        #[cfg(feature = "nvml")]
        nvidia_clock_mhz,
        disk_active,
        disk_read_mb_s,
        disk_write_mb_s,
        disk_avg_response_ms,
        disk_display_order,
        net_recv_kb_s,
        net_sent_kb_s,
    }
}

/// Append RawPoll values into HistoryStore. Fast — no I/O, pure memory writes.
/// Full commit (CPU, GPU, disk, network). Unused in favour of granular commit_* when raw.is_some().
#[allow(dead_code)]
pub fn commit(store: &mut crate::state::HistoryStore, poll: &crate::state::RawPoll) {
    push_history(&mut store.cpu_history, poll.cpu_usage, MAX_HISTORY);
    store.cpu_temp_c = poll.cpu_temp_c;

    push_history(
        &mut store.mem_history,
        poll.mem_pct.clamp(0.0, 100.0),
        MAX_HISTORY,
    );
    store.mem_used_gb = poll.mem_used_gb;
    store.mem_total_gb = poll.mem_total_gb;

    push_history(&mut store.net_recv_history, poll.net_recv_kb_s, MAX_HISTORY);
    push_history(&mut store.net_sent_history, poll.net_sent_kb_s, MAX_HISTORY);

    let mut existing: HashMap<String, VecDeque<f64>> = store
        .gpu_entries
        .drain(..)
        .map(|(key, _, hist)| (key, hist))
        .collect();
    store.gpu_entries = poll
        .gpu_updates
        .iter()
        .map(|(key, display_name, util)| {
            let mut hist = existing
                .remove(key)
                .unwrap_or_else(|| VecDeque::with_capacity(MAX_HISTORY));
            push_history(&mut hist, util.clamp(0.0, 100.0), MAX_HISTORY);
            (key.clone(), display_name.clone(), hist)
        })
        .collect();

    store.nvidia_temp = poll.nvidia_temp;

    for disk_key in &poll.disk_display_order {
        if !store.disk_active_histories.contains_key(disk_key) {
            store.disk_display_order.push(disk_key.clone());
            store
                .disk_active_histories
                .insert(disk_key.clone(), VecDeque::with_capacity(MAX_HISTORY));
        }
        if let (Some(history), Some(&pct)) = (
            store.disk_active_histories.get_mut(disk_key),
            poll.disk_active.get(disk_key),
        ) {
            push_history(history, pct, MAX_HISTORY);
        }
    }
    store.disk_read_mb_s = poll.disk_read_mb_s.clone();
    store.disk_write_mb_s = poll.disk_write_mb_s.clone();
    store.disk_avg_response_ms = poll.disk_avg_response_ms.clone();
}

/// Commit only CPU-related fields from a RawPoll into HistoryStore (for sensor registry).
pub fn commit_cpu(store: &mut crate::state::HistoryStore, poll: &crate::state::RawPoll) {
    push_history(&mut store.cpu_history, poll.cpu_usage, MAX_HISTORY);
    store.cpu_temp_c = poll.cpu_temp_c;
}

/// Commit only GPU-related fields from a RawPoll into HistoryStore (for sensor registry).
pub fn commit_gpu(store: &mut crate::state::HistoryStore, poll: &crate::state::RawPoll) {
    let mut existing: HashMap<String, VecDeque<f64>> = store
        .gpu_entries
        .drain(..)
        .map(|(key, _, hist)| (key, hist))
        .collect();
    store.gpu_entries = poll
        .gpu_updates
        .iter()
        .map(|(key, display_name, util)| {
            let mut hist = existing
                .remove(key)
                .unwrap_or_else(|| VecDeque::with_capacity(MAX_HISTORY));
            push_history(&mut hist, util.clamp(0.0, 100.0), MAX_HISTORY);
            (key.clone(), display_name.clone(), hist)
        })
        .collect();
    store.nvidia_temp = poll.nvidia_temp;
    #[cfg(feature = "nvml")]
    {
        store.nvidia_power_w = poll.nvidia_power_w;
        store.nvidia_mem_used_mb = poll.nvidia_mem_used_mb;
        store.nvidia_mem_total_mb = poll.nvidia_mem_total_mb;
        store.nvidia_fan_speed_pct = poll.nvidia_fan_speed_pct;
        store.nvidia_clock_mhz = poll.nvidia_clock_mhz;
    }
}

/// Commit only disk and network fields from a RawPoll into HistoryStore (full tick, every 4th).
pub fn commit_disk_network(store: &mut crate::state::HistoryStore, poll: &crate::state::RawPoll) {
    push_history(&mut store.mem_history, poll.mem_pct.clamp(0.0, 100.0), MAX_HISTORY);
    store.mem_used_gb = poll.mem_used_gb;
    store.mem_total_gb = poll.mem_total_gb;
    push_history(&mut store.net_recv_history, poll.net_recv_kb_s, MAX_HISTORY);
    push_history(&mut store.net_sent_history, poll.net_sent_kb_s, MAX_HISTORY);
    for disk_key in &poll.disk_display_order {
        if !store.disk_active_histories.contains_key(disk_key) {
            store.disk_display_order.push(disk_key.clone());
            store
                .disk_active_histories
                .insert(disk_key.clone(), VecDeque::with_capacity(MAX_HISTORY));
        }
        if let (Some(history), Some(&pct)) = (
            store.disk_active_histories.get_mut(disk_key),
            poll.disk_active.get(disk_key),
        ) {
            push_history(history, pct, MAX_HISTORY);
        }
    }
    store.disk_read_mb_s = poll.disk_read_mb_s.clone();
    store.disk_write_mb_s = poll.disk_write_mb_s.clone();
    store.disk_avg_response_ms = poll.disk_avg_response_ms.clone();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    // --- push_history ---

    #[test]
    fn test_push_history_under_capacity() {
        let mut d: VecDeque<f64> = [1.0, 2.0].into();
        push_history(&mut d, 3.0, 5);
        assert_eq!(d.into_iter().collect::<Vec<_>>(), vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn test_push_history_at_capacity_drops_oldest() {
        let mut d: VecDeque<f64> = [1.0, 2.0, 3.0].into();
        push_history(&mut d, 4.0, 3);
        assert_eq!(d.into_iter().collect::<Vec<_>>(), vec![2.0, 3.0, 4.0]);
    }

    #[test]
    fn test_push_history_empty() {
        let mut d: VecDeque<f64> = VecDeque::new();
        push_history(&mut d, 42.0, 3);
        assert_eq!(d.into_iter().collect::<Vec<_>>(), vec![42.0]);
    }

    #[test]
    fn test_push_history_max_len_one() {
        let mut d: VecDeque<f64> = [99.0].into();
        push_history(&mut d, 7.0, 1);
        assert_eq!(d.into_iter().collect::<Vec<_>>(), vec![7.0]);
    }

    #[test]
    fn test_push_history_multiple_pushes_at_capacity() {
        let mut d: VecDeque<f64> = [1.0, 2.0, 3.0].into();
        push_history(&mut d, 4.0, 3);
        push_history(&mut d, 5.0, 3);
        push_history(&mut d, 6.0, 3);
        push_history(&mut d, 7.0, 3);
        assert_eq!(d.len(), 3);
        assert_eq!(d.into_iter().collect::<Vec<_>>(), vec![5.0, 6.0, 7.0]);
    }

    // --- cpu_name_fallback ---

    #[test]
    fn test_cpu_name_fallback() {
        let brand = "";
        let name = if brand.is_empty() {
            "CPU".to_string()
        } else {
            brand.to_string()
        };
        assert_eq!(name, "CPU");
    }
}
