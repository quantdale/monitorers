mod cpu;
mod disk;
mod gpu;
pub mod nvidia;
pub mod run_loop;
pub mod snapshot;

pub use cpu::query_cpu_temp_c;
pub use disk::{physical_disk_list, query_disk_models_wmi};
pub use gpu::is_nvidia_gpu;
pub use gpu::query_gpu_utilization_pdh;
#[cfg(all(feature = "nvapi", not(feature = "nvml")))]
pub use nvidia::query_nvidia_gpu_temp;
pub use run_loop::{run_collector_loop, LoopLimit, TickTiming, WmiBootstrap, TICK_INTERVAL};
pub use snapshot::{
    build_history_payload, build_snapshot, clamp_window_secs, is_full_poll_tick,
    slice_aligned_history, slice_history, slice_timestamps, timestamp_window_range, DiskHistory,
    DiskSnapshot, GpuHistory, GpuSnapshot, HistoryPayload, MetricsSnapshot, SCHEMA_VERSION,
};

use std::collections::{HashMap, HashSet, VecDeque};
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCollectQueryData, PdhOpenQueryW, PDH_HCOUNTER, PDH_HQUERY,
};

// ── PUSH HISTORY HELPER ──────────────────────────────────────────────────────

// Keep in sync with `useMetrics.ts`'s `MAX_HISTORY` (no shared-constant mechanism
// crosses the IPC boundary between Rust and TypeScript).
const MAX_HISTORY: usize = crate::state::HISTORY_CAPACITY;

/// Consecutive full ticks a disk/GPU must be absent from the live poll before
/// it is pruned from the history store (~4s at the 1Hz full-tick cadence).
/// Absorbs transient PDH/WMI hiccups: hardware that reappears resets its
/// counter, so a blip can never accumulate toward a false prune (which would
/// reshuffle card order via the frontend's append-on-reappear merge).
const PRUNE_MISS_THRESHOLD: u32 = 4;

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
/// Returns `None` only if the query itself cannot be opened.
/// GPU counter failure is non-fatal: disk counters are registered independently
/// so a GPU-only failure does not drop disk metrics.
///
/// The query handle must live for the process lifetime — recreating it resets
/// the baseline and always returns 0%.
pub fn new_pdh_gpu_query() -> Option<crate::state::PdhHandles> {
    // SAFETY: PDH C API calls via FFI. All pointer arguments are stack variables.
    // Return codes are checked before any output values are read.
    unsafe {
        let mut query = PDH_HQUERY::default();
        if PdhOpenQueryW(None, 0, &mut query) != 0 {
            eprintln!("[PDH] PdhOpenQueryW failed — GPU and disk metrics unavailable.");
            return None;
        }

        // GPU 3D counter — non-fatal if it fails (disk counters are independent).
        let path_3d = windows::core::w!(r"\GPU Engine(*engtype_3D*)\Utilization Percentage");
        let mut counter_3d = PDH_HCOUNTER::default();
        let gpu_3d_counter = if PdhAddEnglishCounterW(query, path_3d, 0, &mut counter_3d) == 0 {
            Some(counter_3d)
        } else {
            eprintln!("[PDH] Failed to add GPU 3D counter — GPU metrics unavailable.");
            None
        };

        // Disk % Idle Time added to the same query as GPU so one
        // PdhCollectQueryData snapshots both domains atomically.
        // active% = 100 - idle%  (inverted in query_disk_active_time).
        let path_disk_active = windows::core::w!(r"\PhysicalDisk(*)\% Idle Time");
        let mut counter_disk_active = PDH_HCOUNTER::default();
        let counter_disk_opt =
            if PdhAddEnglishCounterW(query, path_disk_active, 0, &mut counter_disk_active) == 0 {
                Some(counter_disk_active)
            } else {
                eprintln!("[PDH] Failed to add disk idle time counter.");
                None
            };

        let path_disk_read = windows::core::w!(r"\PhysicalDisk(*)\Disk Read Bytes/sec");
        let mut counter_disk_read = PDH_HCOUNTER::default();
        let counter_disk_read_opt =
            if PdhAddEnglishCounterW(query, path_disk_read, 0, &mut counter_disk_read) == 0 {
                Some(counter_disk_read)
            } else {
                eprintln!("[PDH] Failed to add disk read bytes/sec counter.");
                None
            };

        let path_disk_write = windows::core::w!(r"\PhysicalDisk(*)\Disk Write Bytes/sec");
        let mut counter_disk_write = PDH_HCOUNTER::default();
        let counter_disk_write_opt =
            if PdhAddEnglishCounterW(query, path_disk_write, 0, &mut counter_disk_write) == 0 {
                Some(counter_disk_write)
            } else {
                eprintln!("[PDH] Failed to add disk write bytes/sec counter.");
                None
            };

        let path_disk_response = windows::core::w!(r"\PhysicalDisk(*)\Avg. Disk sec/Transfer");
        let mut counter_disk_response = PDH_HCOUNTER::default();
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
        let baseline_status = PdhCollectQueryData(query);
        if baseline_status != 0 {
            eprintln!(
                "[PDH] initial PdhCollectQueryData failed (status {baseline_status:#x}) — first readings may read 0%."
            );
        }
        if gpu_3d_counter.is_some() {
            eprintln!("[PDH] GPU and disk counters initialized successfully.");
        } else {
            eprintln!("[PDH] Disk counters initialized (GPU 3D counter unavailable).");
        }
        Some(crate::state::PdhHandles {
            query: Some(query),
            gpu_3d_counter,
            disk_active_counter: counter_disk_opt,
            disk_read_counter: counter_disk_read_opt,
            disk_write_counter: counter_disk_write_opt,
            disk_response_counter: counter_disk_response_opt,
        })
    }
}

// ── POLL AND COMMIT ───────────────────────────────────────────────────────────

/// How long a CPU-temperature WMI reading is considered fresh. WMI queries are
/// expensive relative to the 250ms tick; temps change slowly, so 1Hz suffices.
const CPU_TEMP_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(5);

/// Convert a byte delta into kibibytes per second using the actual refresh
/// interval. `sysinfo::NetworkData::received` and `transmitted` are deltas
/// since the previous refresh, not cumulative counters.
pub fn normalize_network_rate(bytes: u64, elapsed: std::time::Duration) -> f64 {
    let seconds = elapsed.as_secs_f64();
    if !seconds.is_finite() || seconds <= 0.001 {
        return 0.0;
    }
    (bytes as f64 / 1024.0 / seconds).max(0.0)
}

/// Query the CPU temperature, serving from a 5-second cache when possible.
/// A failed query is not cached, so the next poll retries immediately.
pub fn query_cpu_temp_cached(
    cache: &mut Option<(std::time::Instant, f64)>,
    wmi_con: Option<&wmi::WMIConnection>,
) -> Option<f64> {
    if let Some((at, v)) = cache {
        if at.elapsed() < CPU_TEMP_CACHE_TTL {
            return Some(*v);
        }
    }
    let t = cpu::query_cpu_temp_c(wmi_con);
    *cache = t.map(|v| (std::time::Instant::now(), v));
    t
}

/// Run PdhCollectQueryData so that GPU (and disk) counter reads see fresh data.
/// Call this before query_gpu_utilization_pdh when polling only GPU via sensor registry.
pub fn collect_pdh(collector: &crate::state::CollectorState) -> bool {
    match collector.pdh.query {
        // SAFETY: PDH C API call via FFI. `query` is a stack-local handle from
        // CollectorState; the return code is checked before any output is read.
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

    let cpu_temp_c = query_cpu_temp_cached(&mut collector.cpu_temp_cache, wmi_con);
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
    let refresh_started = std::time::Instant::now();
    let refresh_elapsed = refresh_started.saturating_duration_since(collector.network_last_refresh);
    collector.sysinfo_networks.refresh(false);
    collector.network_last_refresh = std::time::Instant::now();
    let mut total_recv_bytes = 0u64;
    let mut total_sent_bytes = 0u64;
    for (iface_name, data) in &collector.sysinfo_networks {
        let name_upper = iface_name.to_uppercase();
        if name_upper.contains("LOOPBACK") || name_upper == "LO" {
            continue;
        }
        // sysinfo exposes per-refresh deltas and uses saturating subtraction
        // internally for counter reset/wrap. Saturating aggregation keeps a
        // pathological adapter set from overflowing the process in debug
        // builds; the normalized rate then remains a conservative value.
        total_recv_bytes = total_recv_bytes.saturating_add(data.received());
        total_sent_bytes = total_sent_bytes.saturating_add(data.transmitted());
    }
    let net_recv_kib_s = normalize_network_rate(total_recv_bytes, refresh_elapsed);
    let net_sent_kib_s = normalize_network_rate(total_sent_bytes, refresh_elapsed);

    // Single PdhCollectQueryData call covers both GPU and disk counters.
    let pdh_collected_ok = collect_pdh(collector);
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

    let gpu_updates = gpu::query_gpu_utilization_pdh(
        &collector.pdh,
        wmi_con,
        &collector.gpu_error_lock,
        &mut collector.gpu_vendor_map,
        &mut collector.gpu_vendor_map_last_build,
    );

    #[cfg(feature = "nvml")]
    collector.retry_nvml_if_due();
    #[cfg(feature = "nvml")]
    let nvidia_telemetry = if let Some(ref nvml) = collector.nvml {
        let readings = nvidia::query_nvml(nvml);
        collector.mark_nvidia_enrichment();
        Some(nvidia::reconcile_nvml_readings(&gpu_updates, &readings))
    } else {
        Some(HashMap::new())
    };

    #[cfg(all(feature = "nvapi", not(feature = "nvml")))]
    let nvidia_telemetry = nvidia::nvapi_telemetry_for(
        &gpu_updates,
        nvidia::query_nvidia_gpu_temp(collector.nvapi_initialized),
    );

    #[cfg(not(any(feature = "nvml", feature = "nvapi")))]
    let nvidia_telemetry = None;

    crate::state::RawPoll {
        cpu_usage,
        cpu_temp_c,
        mem_used_gb,
        mem_total_gb,
        mem_pct,
        gpu_updates,
        nvidia_telemetry,
        disk_active,
        disk_read_mb_s,
        disk_write_mb_s,
        disk_avg_response_ms,
        disk_display_order,
        pdh_ok: pdh_collected_ok,
        net_recv_kib_s,
        net_sent_kib_s,
    }
}

/// Commit only CPU-related fields from a RawPoll into HistoryStore (full tick).
/// Also refreshes `cpu_latest` so it's never stale relative to the value just
/// pushed into `cpu_history` in the same tick (ARC-007).
pub fn commit_cpu(store: &mut crate::state::HistoryStore, poll: &crate::state::RawPoll) {
    push_history(&mut store.cpu_history, poll.cpu_usage, MAX_HISTORY);
    store.cpu_temp_c = poll.cpu_temp_c;
    store.cpu_latest = Some(poll.cpu_usage);
}

/// Commit only GPU-related fields from a RawPoll into HistoryStore (full tick).
/// Also refreshes `gpu_latest` so it's never stale relative to the value just
/// pushed into `gpu_entries` in the same tick (ARC-007).
pub fn commit_gpu(store: &mut crate::state::HistoryStore, poll: &crate::state::RawPoll) {
    // On PDH failure, freeze GPU history and latest at last-known values.
    // Do not commit stale/zero readings from a failed PdhCollectQueryData.
    // Nvidia enrichment is held at the same last-known snapshot so an
    // intermittent PDH failure cannot make one channel appear to jump or
    // disappear while the card's identity is being reconciled.
    if !poll.pdh_ok {
        return;
    }

    if let Some(telemetry) = &poll.nvidia_telemetry {
        store.nvidia_telemetry = telemetry.clone();
    }

    // Remember the previous entry order so grace-window ghosts below keep a
    // stable gpus array order (draining into a HashMap would scramble it).
    let prior_keys: Vec<String> = store
        .gpu_entries
        .iter()
        .map(|(k, _, _)| k.clone())
        .collect();

    let mut existing: HashMap<String, (String, VecDeque<f64>)> = store
        .gpu_entries
        .drain(..)
        .map(|(key, name, hist)| (key, (name, hist)))
        .collect();

    let mut next_entries: Vec<(String, String, VecDeque<f64>)> = Vec::new();
    let mut next_latest: HashMap<String, f64> = HashMap::new();

    // Keys present in this poll: fresh history append, miss counter reset.
    for (key, display_name, util) in &poll.gpu_updates {
        let util = util.clamp(0.0, 100.0);
        let mut hist = existing
            .remove(key)
            .map(|(_, h)| h)
            .unwrap_or_else(|| VecDeque::with_capacity(MAX_HISTORY));
        push_history(&mut hist, util, MAX_HISTORY);
        next_entries.push((key.clone(), display_name.clone(), hist));
        next_latest.insert(key.clone(), util);
        store.gpu_miss_count.remove(key.as_str());
    }

    // Previously-known keys absent from this poll are ghosts. Keep them
    // through a PRUNE_MISS_THRESHOLD grace window (history frozen, last-known
    // util held) so a transient vendor-map/WMI blip cannot wipe GPU cards;
    // drop them once the threshold is crossed (a caption leaving the vendor
    // map for good, e.g. after a hot-plug rebuild). The gate on an empty poll
    // is essential: empty gpu_updates means PDH or WMI was unavailable this
    // tick — that is not evidence every GPU vanished, so ghosts are kept.
    // Iterated in `prior_keys` order so the resulting gpus array stays stable.
    if !poll.gpu_updates.is_empty() {
        for key in prior_keys {
            let Some((name, hist)) = existing.remove(&key) else {
                continue; // already moved into next_entries as a fresh key
            };
            let miss = store.gpu_miss_count.entry(key.clone()).or_insert(0);
            *miss += 1;
            if *miss >= PRUNE_MISS_THRESHOLD {
                store.gpu_miss_count.remove(&key);
            } else {
                if let Some(v) = store.gpu_latest.get(&key) {
                    next_latest.insert(key.clone(), *v);
                }
                next_entries.push((key, name, hist));
            }
        }
    } else {
        for key in prior_keys {
            let Some((name, hist)) = existing.remove(&key) else {
                continue;
            };
            if let Some(v) = store.gpu_latest.get(&key) {
                next_latest.insert(key.clone(), *v);
            }
            next_entries.push((key, name, hist));
        }
    }

    store.gpu_entries = next_entries;
    store.gpu_latest = next_latest;
}

/// Commit only CPU scalar fields (no history push) for high-frequency snapshots.
pub fn commit_cpu_scalar(store: &mut crate::state::HistoryStore, poll: &crate::state::RawPoll) {
    store.cpu_temp_c = poll.cpu_temp_c;
    store.cpu_latest = Some(poll.cpu_usage);
}

/// Commit only GPU scalar fields (no history push) for high-frequency snapshots.
pub fn commit_gpu_scalar(store: &mut crate::state::HistoryStore, poll: &crate::state::RawPoll) {
    // On PDH failure, freeze gpu_latest at last-known values.
    // Do not commit stale/zero readings from a failed PdhCollectQueryData.
    if !poll.pdh_ok {
        return;
    }

    // Refresh only keys present in this poll; ghost keys inside the prune
    // grace window keep their last-known util, mirroring commit_gpu's merge
    // (otherwise their latest value vanishes on the 3 non-full ticks between
    // full polls, even though their history and entry are still live).
    let mut next: HashMap<String, f64> = store.gpu_latest.clone();
    for (key, _, util) in &poll.gpu_updates {
        next.insert(key.clone(), util.clamp(0.0, 100.0));
    }
    store.gpu_latest = next;
    if let Some(telemetry) = &poll.nvidia_telemetry {
        store.nvidia_telemetry = telemetry.clone();
    }
}

/// Commit only disk and network fields from a RawPoll into HistoryStore (full tick, every 4th).
pub fn commit_disk_network(store: &mut crate::state::HistoryStore, poll: &crate::state::RawPoll) {
    push_history(
        &mut store.mem_history,
        poll.mem_pct.clamp(0.0, 100.0),
        MAX_HISTORY,
    );
    store.mem_used_gb = poll.mem_used_gb;
    store.mem_total_gb = poll.mem_total_gb;
    push_history(
        &mut store.net_recv_history,
        poll.net_recv_kib_s,
        MAX_HISTORY,
    );
    push_history(
        &mut store.net_sent_history,
        poll.net_sent_kib_s,
        MAX_HISTORY,
    );

    // On PDH failure, freeze disk active histories and throughput maps at last-known values.
    // Do not commit empty maps from a failed PdhCollectQueryData.
    if poll.pdh_ok {
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

        // Ghost pruning with a grace window. `poll_disk` rebuilds the display
        // order from the live PDH instance list every full tick, so a disk absent
        // for PRUNE_MISS_THRESHOLD consecutive full polls is gone (hot-unplug) —
        // without this, an unplugged disk's snapshot entry, history and card kept
        // freezing forever at their last reading. Pruning only runs when the tick
        // itself had a successful PdhCollectQueryData (`poll.pdh_ok`): on a
        // PDH-failed tick an empty display order means "PDH unavailable", not
        // "every disk vanished", and pruning then would needlessly churn disk
        // card order via the frontend's append-on-reappear merge.
        let present: HashSet<&str> = poll
            .disk_display_order
            .iter()
            .map(|key| key.as_str())
            .collect();
        for disk_key in &store.disk_display_order {
            if present.contains(disk_key.as_str()) {
                store.disk_miss_count.remove(disk_key);
            } else {
                *store.disk_miss_count.entry(disk_key.clone()).or_insert(0) += 1;
            }
        }
        let mut pruned: Vec<String> = Vec::new();
        store.disk_miss_count.retain(|key, misses| {
            if *misses >= PRUNE_MISS_THRESHOLD {
                pruned.push(key.clone());
                false
            } else {
                true
            }
        });
        if !pruned.is_empty() {
            store.disk_display_order.retain(|key| !pruned.contains(key));
            for key in &pruned {
                store.disk_active_histories.remove(key);
                store.disk_read_mb_s.remove(key);
                store.disk_write_mb_s.remove(key);
                store.disk_avg_response_ms.remove(key);
            }
        }
    }
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

    // --- query_cpu_temp_cached ---

    #[test]
    fn test_cpu_temp_cache_serves_fresh_value_without_wmi() {
        let mut collector = crate::state::CollectorState::new();
        collector.cpu_temp_cache = Some((std::time::Instant::now(), 45.5));
        // Fresh cache entry: returned without any WMI connection.
        assert_eq!(
            query_cpu_temp_cached(&mut collector.cpu_temp_cache, None),
            Some(45.5)
        );
    }

    #[test]
    fn test_cpu_temp_cache_expired_entry_re_queries() {
        let mut collector = crate::state::CollectorState::new();
        let stale = std::time::Instant::now() - std::time::Duration::from_secs(5);
        collector.cpu_temp_cache = Some((stale, 45.5));
        // Expired entry + no WMI connection => re-query fails and the cache
        // is invalidated (so the next poll retries immediately).
        assert_eq!(
            query_cpu_temp_cached(&mut collector.cpu_temp_cache, None),
            None
        );
        assert_eq!(collector.cpu_temp_cache, None);
    }

    #[test]
    fn test_cpu_temp_cache_failure_is_not_cached() {
        let mut cache: Option<(std::time::Instant, f64)> = None;
        assert_eq!(query_cpu_temp_cached(&mut cache, None), None);
        assert_eq!(cache, None, "a failed query must not be cached");
    }

    // --- scalar commits ---

    #[test]
    fn test_commit_cpu_scalar_updates_latest_not_history() {
        let mut store = crate::state::HistoryStore::new("test");
        let poll = crate::state::RawPoll {
            cpu_usage: 42.0,
            cpu_temp_c: Some(65.0),
            ..Default::default()
        };
        commit_cpu_scalar(&mut store, &poll);
        assert_eq!(store.cpu_latest, Some(42.0));
        assert_eq!(store.cpu_temp_c, Some(65.0));
        assert!(store.cpu_history.is_empty());
    }

    #[test]
    fn test_commit_gpu_scalar_updates_latest_not_history() {
        let mut store = crate::state::HistoryStore::new("test");
        let poll = crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), 150.0)],
            nvidia_telemetry: Some(std::collections::HashMap::from([(
                "gpu0".to_string(),
                crate::state::NvidiaTelemetry {
                    temp_c: Some(70.0),
                    ..Default::default()
                },
            )])),
            ..Default::default()
        };
        commit_gpu_scalar(&mut store, &poll);
        assert_eq!(store.gpu_latest.get("gpu0"), Some(&100.0));
        assert_eq!(store.nvidia_telemetry["gpu0"].temp_c, Some(70.0));
        assert!(store.gpu_entries.is_empty());
    }

    #[test]
    fn test_commit_gpu_scalar_preserves_ghost_latest_during_grace() {
        // A ghost GPU key inside the prune grace window must keep its
        // last-known util across non-full (scalar) ticks, mirroring
        // commit_gpu's keep-ghosts merge.
        let mut store = crate::state::HistoryStore::new("test");
        store.gpu_latest.insert("gpu0".to_string(), 42.0);
        let poll = crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![("gpu1".to_string(), "GPU 1".to_string(), 50.0)],
            ..Default::default()
        };
        commit_gpu_scalar(&mut store, &poll);
        assert_eq!(store.gpu_latest.get("gpu0"), Some(&42.0));
        assert_eq!(store.gpu_latest.get("gpu1"), Some(&50.0));
    }

    #[test]
    fn test_commit_cpu_updates_latest_alongside_history() {
        let mut store = crate::state::HistoryStore::new("test");
        store.cpu_latest = Some(999.0); // stale value from a prior registry-only tick
        let poll = crate::state::RawPoll {
            cpu_usage: 55.0,
            ..Default::default()
        };
        commit_cpu(&mut store, &poll);
        assert_eq!(store.cpu_history.back().copied(), Some(55.0));
        assert_eq!(
            store.cpu_latest,
            Some(55.0),
            "cpu_latest must not be stale relative to the value just committed to history"
        );
    }

    #[test]
    fn test_commit_gpu_updates_latest_alongside_history() {
        let mut store = crate::state::HistoryStore::new("test");
        store.gpu_latest.insert("gpu0".to_string(), 999.0); // stale value
        let poll = crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), 65.0)],
            ..Default::default()
        };
        commit_gpu(&mut store, &poll);
        let (_, _, hist) = &store.gpu_entries[0];
        assert_eq!(hist.back().copied(), Some(65.0));
        assert_eq!(
            store.gpu_latest.get("gpu0"),
            Some(&65.0),
            "gpu_latest must not be stale relative to the value just committed to history"
        );
    }

    // --- ghost pruning with grace window (DISK-001) ---
    // A disk/GPU absent from the live poll is dropped only after
    // PRUNE_MISS_THRESHOLD consecutive full ticks; PDH-failed or WMI-empty
    // ticks must never be interpreted as hardware vanishing.

    #[test]
    fn test_commit_disk_network_prunes_disk_missing_for_threshold_ticks() {
        let mut store = crate::state::HistoryStore::new("test");
        let mut present = crate::state::RawPoll {
            pdh_ok: true,
            disk_display_order: vec!["C:".to_string()],
            ..Default::default()
        };
        present.disk_active.insert("C:".to_string(), 10.0);
        commit_disk_network(&mut store, &present);
        assert_eq!(store.disk_display_order, vec!["C:".to_string()]);

        // A single miss must not prune.
        commit_disk_network(
            &mut store,
            &crate::state::RawPoll {
                pdh_ok: true,
                ..Default::default()
            },
        );
        assert_eq!(store.disk_display_order, vec!["C:".to_string()]);

        // PRUNE_MISS_THRESHOLD - 1 further misses reach the threshold → pruned.
        for _ in 0..PRUNE_MISS_THRESHOLD - 1 {
            commit_disk_network(
                &mut store,
                &crate::state::RawPoll {
                    pdh_ok: true,
                    ..Default::default()
                },
            );
        }
        assert!(
            store.disk_display_order.is_empty(),
            "disk must be pruned at the threshold"
        );
        assert!(store.disk_active_histories.is_empty());
        assert!(
            store.disk_miss_count.is_empty(),
            "miss counters are cleaned after pruning"
        );
    }

    #[test]
    fn test_commit_disk_network_skips_pruning_when_pdh_unavailable() {
        // pdh_ok = false (a PDH-failed tick): an empty display order is PDH
        // being down, not every disk disappearing. Repeated empty polls must
        // leave the stored disk untouched.
        let mut store = crate::state::HistoryStore::new("test");
        let mut present = crate::state::RawPoll {
            pdh_ok: true,
            disk_display_order: vec!["C:".to_string()],
            ..Default::default()
        };
        present.disk_active.insert("C:".to_string(), 10.0);
        commit_disk_network(&mut store, &present);

        for _ in 0..PRUNE_MISS_THRESHOLD * 2 {
            commit_disk_network(&mut store, &crate::state::RawPoll::default());
        }
        assert_eq!(store.disk_display_order, vec!["C:".to_string()]);
        assert!(
            store.disk_miss_count.is_empty(),
            "PDH-failed ticks must not count as misses"
        );
    }

    #[test]
    fn test_commit_disk_network_miss_counter_resets_when_disk_reappears() {
        // A disk missing for a few ticks then reappearing must reset its
        // counter — a short hiccup can never accumulate toward a false prune.
        let mut store = crate::state::HistoryStore::new("test");
        let mut present = crate::state::RawPoll {
            pdh_ok: true,
            disk_display_order: vec!["C:".to_string()],
            ..Default::default()
        };
        present.disk_active.insert("C:".to_string(), 10.0);
        commit_disk_network(&mut store, &present);
        for _ in 0..PRUNE_MISS_THRESHOLD - 1 {
            commit_disk_network(
                &mut store,
                &crate::state::RawPoll {
                    pdh_ok: true,
                    ..Default::default()
                },
            );
        }
        assert_eq!(
            store.disk_display_order.len(),
            1,
            "grace window must still hold"
        );

        commit_disk_network(&mut store, &present); // reappears → counter reset
        for _ in 0..PRUNE_MISS_THRESHOLD - 1 {
            commit_disk_network(
                &mut store,
                &crate::state::RawPoll {
                    pdh_ok: true,
                    ..Default::default()
                },
            );
        }
        assert_eq!(
            store.disk_display_order.len(),
            1,
            "resets must prevent compounding misses across appearances"
        );
        commit_disk_network(
            &mut store,
            &crate::state::RawPoll {
                pdh_ok: true,
                ..Default::default()
            },
        );
        assert!(
            store.disk_display_order.is_empty(),
            "pruned only after a full fresh grace window"
        );
    }

    #[test]
    fn test_commit_gpu_prunes_gpu_missing_for_threshold_ticks() {
        let mut store = crate::state::HistoryStore::new("test");
        let gpu0 = crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), 50.0)],
            ..Default::default()
        };
        commit_gpu(&mut store, &gpu0);
        assert_eq!(store.gpu_entries.len(), 1);

        // gpu0's caption dropped out (e.g. vendor-map rebuild after a
        // hot-plug); gpu1 is what the poll reports now. gpu0 misses start.
        let gpu1 = crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![("gpu1".to_string(), "GPU 1".to_string(), 60.0)],
            ..Default::default()
        };
        for _ in 0..PRUNE_MISS_THRESHOLD - 1 {
            commit_gpu(&mut store, &gpu1);
            assert_eq!(
                store.gpu_entries.len(),
                2,
                "grace window holds before the threshold"
            );
        }
        commit_gpu(&mut store, &gpu1);
        assert_eq!(
            store.gpu_entries.len(),
            1,
            "gpu0 must be pruned at the threshold"
        );
        assert_eq!(store.gpu_entries[0].0, "gpu1");
        assert!(
            store.gpu_miss_count.is_empty(),
            "miss counters are cleaned after pruning"
        );
    }

    #[test]
    fn test_commit_gpu_skips_pruning_when_poll_empty() {
        // An empty gpu_updates poll means PDH or WMI was unavailable this
        // tick — it must never be read as "every GPU vanished". gpu_entries
        // (and thus the UI's GPU cards) survive repeated empty polls.
        let mut store = crate::state::HistoryStore::new("test");
        let present = crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), 50.0)],
            ..Default::default()
        };
        commit_gpu(&mut store, &present);
        for _ in 0..PRUNE_MISS_THRESHOLD * 2 {
            commit_gpu(&mut store, &crate::state::RawPoll::default());
        }
        assert_eq!(store.gpu_entries.len(), 1);
        assert!(
            store.gpu_miss_count.is_empty(),
            "empty polls must not count as misses"
        );
    }

    #[test]
    fn test_commit_gpu_preserves_ghost_order() {
        // Two GPUs go absent from the poll; grace-window ghosts must keep their
        // previous gpu_entries order (not HashMap iteration order), so the gpus
        // array order is stable across ticks.
        let mut store = crate::state::HistoryStore::new("test");
        let poll = crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![
                ("gpu-b".to_string(), "GPU B".to_string(), 40.0),
                ("gpu-a".to_string(), "GPU A".to_string(), 30.0),
            ],
            ..Default::default()
        };
        commit_gpu(&mut store, &poll);

        let poll2 = crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![("gpu-c".to_string(), "GPU C".to_string(), 55.0)],
            ..Default::default()
        };
        commit_gpu(&mut store, &poll2);

        // Fresh key first (poll order), then ghosts in their prior entry order.
        let order: Vec<&str> = store
            .gpu_entries
            .iter()
            .map(|(k, _, _)| k.as_str())
            .collect();
        assert_eq!(order, vec!["gpu-c", "gpu-b", "gpu-a"]);
    }

    #[test]
    fn test_history_length_invariant_after_simulated_ticks() {
        let mut store = crate::state::HistoryStore::new("test");
        let full_poll = crate::state::RawPoll {
            cpu_usage: 10.0,
            ..Default::default()
        };
        commit_cpu(&mut store, &full_poll);
        store.push_timestamp(1);

        for v in [20.0, 30.0, 40.0] {
            let scalar_poll = crate::state::RawPoll {
                cpu_usage: v,
                ..Default::default()
            };
            commit_cpu_scalar(&mut store, &scalar_poll);
        }

        assert_eq!(store.cpu_history.len(), 1);
        assert_eq!(store.timestamps.len(), 1);
        assert_eq!(store.cpu_latest, Some(40.0));
        assert_eq!(store.cpu_history.back().copied(), Some(10.0));
    }

    // --- everyday longitudinal usage: capacity + length-sync (6.1, 6.2) ---

    #[test]
    fn test_push_history_past_max_history_capacity_drops_oldest_and_caps_length() {
        let mut d: VecDeque<f64> = VecDeque::new();
        for i in 0..(MAX_HISTORY + 100) {
            push_history(&mut d, i as f64, MAX_HISTORY);
        }
        assert_eq!(d.len(), MAX_HISTORY);
        // Oldest 100 values (0..100) were dropped; the deque now starts at 100.
        assert_eq!(d.front().copied(), Some(100.0));
        assert_eq!(d.back().copied(), Some((MAX_HISTORY + 99) as f64));
    }

    // WMI unavailable (5.7): poll() must still return a valid RawPoll — only
    // GPU vendor classification and CPU thermal readings degrade to empty/None,
    // rather than the whole poll failing. Mirrors the real startup path where
    // the WMI connection can still be None after WMI_MAX_ATTEMPTS retries
    // (see main.rs), and the precedent in collector/nvidia.rs of constructing
    // a real CollectorState in a test.
    #[test]
    fn test_poll_produces_valid_snapshot_when_wmi_unavailable() {
        let mut collector = crate::state::CollectorState::new();
        let raw = poll(&mut collector, None);

        assert!((0.0..=100.0).contains(&raw.cpu_usage));
        assert!(raw.mem_total_gb >= 0.0);
        assert!(raw.mem_pct >= 0.0);
        // No WMI connection => no thermal-zone query possible.
        assert_eq!(raw.cpu_temp_c, None);
    }

    #[test]
    fn test_timestamps_and_cpu_history_stay_length_synchronized_past_capacity() {
        let mut store = crate::state::HistoryStore::new("test");
        for tick in 0..(MAX_HISTORY as u64 + 50) {
            let poll = crate::state::RawPoll {
                cpu_usage: tick as f64,
                ..Default::default()
            };
            commit_cpu(&mut store, &poll);
            store.push_timestamp(tick);
        }

        assert_eq!(store.cpu_history.len(), MAX_HISTORY);
        assert_eq!(store.timestamps.len(), MAX_HISTORY);
        // Both ring buffers dropped the same oldest 50 entries in lockstep.
        assert_eq!(store.timestamps.front().copied(), Some(50));
        assert_eq!(store.cpu_history.front().copied(), Some(50.0));
    }

    // --- PDH failure gating (GPU/disk freeze on pdh_ok == false) ---

    #[test]
    fn test_commit_gpu_freezes_on_pdh_failure() {
        let mut store = crate::state::HistoryStore::new("test");
        // First, a successful poll establishes baseline
        let good_poll = crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), 45.0)],
            ..Default::default()
        };
        commit_gpu(&mut store, &good_poll);
        assert_eq!(store.gpu_latest.get("gpu0"), Some(&45.0));
        let (_, _, hist) = &store.gpu_entries[0];
        assert_eq!(hist.back().copied(), Some(45.0));

        // Now a PDH-failed tick with a different value (should be ignored)
        let bad_poll = crate::state::RawPoll {
            pdh_ok: false,
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), 0.0)],
            ..Default::default()
        };
        commit_gpu(&mut store, &bad_poll);
        // History and latest must remain at the last good value (45.0)
        assert_eq!(store.gpu_latest.get("gpu0"), Some(&45.0));
        let (_, _, hist) = &store.gpu_entries[0];
        assert_eq!(
            hist.back().copied(),
            Some(45.0),
            "GPU history must freeze on PDH failure"
        );
        assert_eq!(hist.len(), 1, "No new history entry on PDH failure");
    }

    #[test]
    fn test_commit_gpu_updates_nvidia_scalars_on_pdh_failure() {
        // Nvidia enrichment is held with the GPU scalar when PDH fails. This
        // keeps a failed collection from clearing or replacing last-known
        // telemetry while the identity path recovers.
        let mut store = crate::state::HistoryStore::new("test");
        store.gpu_latest.insert("gpu0".to_string(), 45.0);
        store.nvidia_telemetry.insert(
            "gpu0".to_string(),
            crate::state::NvidiaTelemetry {
                temp_c: Some(50.0),
                ..Default::default()
            },
        );
        let bad_poll = crate::state::RawPoll {
            pdh_ok: false,
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), 0.0)],
            nvidia_telemetry: Some(std::collections::HashMap::from([(
                "gpu0".to_string(),
                crate::state::NvidiaTelemetry {
                    temp_c: Some(71.0),
                    power_w: Some(188.0),
                    mem_used_mb: Some(4096),
                    mem_total_mb: Some(8192),
                    fan_speed_pct: Some(50),
                    clock_mhz: Some(1800),
                },
            )])),
            ..Default::default()
        };

        commit_gpu(&mut store, &bad_poll);

        // GPU history and latest freeze at last-good values...
        assert_eq!(store.gpu_latest.get("gpu0"), Some(&45.0));
        assert!(
            store.gpu_entries.is_empty(),
            "no new GPU history entry on PDH failure"
        );
        // ...and last-known per-device Nvidia telemetry is preserved.
        let telemetry = &store.nvidia_telemetry["gpu0"];
        assert_eq!(telemetry.temp_c, Some(50.0));
        assert_eq!(telemetry.power_w, None);
        assert_eq!(telemetry.mem_used_mb, None);
    }

    #[test]
    fn test_commit_disk_network_freezes_throughput_on_pdh_failure() {
        let mut store = crate::state::HistoryStore::new("test");
        // First, a successful poll establishes baseline
        let mut good_poll = crate::state::RawPoll {
            pdh_ok: true,
            disk_display_order: vec!["C:".to_string()],
            ..Default::default()
        };
        good_poll.disk_active.insert("C:".to_string(), 10.0);
        good_poll.disk_read_mb_s.insert("C:".to_string(), 12.5);
        good_poll.disk_write_mb_s.insert("C:".to_string(), 8.2);
        good_poll.disk_avg_response_ms.insert("C:".to_string(), 3.2);
        commit_disk_network(&mut store, &good_poll);
        assert_eq!(store.disk_read_mb_s.get("C:"), Some(&12.5));
        assert_eq!(store.disk_write_mb_s.get("C:"), Some(&8.2));
        assert_eq!(store.disk_avg_response_ms.get("C:"), Some(&3.2));

        // Now a PDH-failed tick with empty maps (should be ignored)
        let bad_poll = crate::state::RawPoll {
            pdh_ok: false,
            ..Default::default()
        };
        commit_disk_network(&mut store, &bad_poll);
        // Throughput maps must remain at last good values
        assert_eq!(
            store.disk_read_mb_s.get("C:"),
            Some(&12.5),
            "Disk read must freeze on PDH failure"
        );
        assert_eq!(
            store.disk_write_mb_s.get("C:"),
            Some(&8.2),
            "Disk write must freeze on PDH failure"
        );
        assert_eq!(
            store.disk_avg_response_ms.get("C:"),
            Some(&3.2),
            "Disk avg response must freeze on PDH failure"
        );
    }

    #[test]
    fn test_commit_gpu_scalar_freezes_on_pdh_failure() {
        let mut store = crate::state::HistoryStore::new("test");
        store.gpu_latest.insert("gpu0".to_string(), 45.0);

        // PDH-failed scalar poll
        let bad_poll = crate::state::RawPoll {
            pdh_ok: false,
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), 0.0)],
            ..Default::default()
        };
        commit_gpu_scalar(&mut store, &bad_poll);
        // gpu_latest must remain at last good value
        assert_eq!(
            store.gpu_latest.get("gpu0"),
            Some(&45.0),
            "GPU scalar must freeze on PDH failure"
        );
    }

    #[test]
    fn test_commit_gpu_scalar_updates_on_pdh_success() {
        let mut store = crate::state::HistoryStore::new("test");
        store.gpu_latest.insert("gpu0".to_string(), 45.0);

        // PDH-successful scalar poll with new value
        let good_poll = crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), 60.0)],
            ..Default::default()
        };
        commit_gpu_scalar(&mut store, &good_poll);
        // gpu_latest must update to new value
        assert_eq!(store.gpu_latest.get("gpu0"), Some(&60.0));
    }

    #[test]
    fn test_normalize_network_rate_is_time_based() {
        let expected = 400.0;
        for (bytes, elapsed_ms) in [(102_400, 250), (409_600, 1_000), (819_200, 2_000)] {
            let rate = normalize_network_rate(bytes, std::time::Duration::from_millis(elapsed_ms));
            assert!((rate - expected).abs() < f64::EPSILON);
        }
    }

    #[test]
    fn test_normalize_network_rate_handles_empty_or_tiny_intervals() {
        assert_eq!(normalize_network_rate(1024, std::time::Duration::ZERO), 0.0);
        assert_eq!(
            normalize_network_rate(1024, std::time::Duration::from_micros(500)),
            0.0
        );
        assert_eq!(
            normalize_network_rate(0, std::time::Duration::from_secs(2)),
            0.0
        );
    }
}
