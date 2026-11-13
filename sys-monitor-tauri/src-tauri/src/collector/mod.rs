mod cpu;
mod disk;
mod gpu;
pub mod nvidia;
pub mod run_loop;
pub mod snapshot;
pub mod supervisor;

pub use cpu::query_cpu_temp_c;
pub use disk::{disk_display_name, physical_disk_list, query_disk_models_wmi};
pub use gpu::is_nvidia_gpu;
pub use gpu::query_gpu_utilization_pdh;
pub use gpu::{enumerate_gpu_adapters, GpuAdapterCatalog};
#[cfg(all(feature = "nvapi", not(feature = "nvml")))]
pub use nvidia::query_nvidia_gpu_temp;
pub use run_loop::{
    panic_message_of, run_collector_loop, LoopLimit, LoopOutcome, TickTiming, WmiBootstrap,
    TICK_INTERVAL,
};
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

pub fn push_history<T>(deque: &mut std::collections::VecDeque<T>, value: T, max_len: usize) {
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

/// Query the CPU temperature at most once per five seconds, including when
/// the connected WMI provider has no usable thermal class. Calls before WMI
/// connects do not populate the cache or delay the first real query.
pub fn query_cpu_temp_cached(
    cache: &mut Option<(std::time::Instant, Option<f64>)>,
    wmi_con: Option<&wmi::WMIConnection>,
) -> Option<f64> {
    let connection = wmi_con?;
    cached_cpu_temp(cache, std::time::Instant::now(), || {
        cpu::query_cpu_temp_c(Some(connection))
    })
}

fn cached_cpu_temp(
    cache: &mut Option<(std::time::Instant, Option<f64>)>,
    now: std::time::Instant,
    query: impl FnOnce() -> Option<f64>,
) -> Option<f64> {
    if let Some((at, v)) = cache {
        if now.saturating_duration_since(*at) < CPU_TEMP_CACHE_TTL {
            return *v;
        }
    }
    let t = query();
    *cache = Some((now, t));
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

pub fn prime_rate_baselines(collector: &mut crate::state::CollectorState) -> bool {
    // One immediate collection establishes the two-sample baseline PDH rate
    // counters need; combined with the first-deadline offset below, the first
    // committed post-recovery tick formats a genuine ~250ms delta instead of a
    // fabricated 0% (fresh-query artifact) or a downtime-aggregating spike.
    let ok = collect_pdh(collector);
    collector.sysinfo_networks.refresh(true);
    ok
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
    // Remove absent/disconnected adapters. With `false`, sysinfo retains the
    // last nonzero received/transmitted delta and we count it on every tick.
    // New adapters establish equal old/current counters on their first refresh.
    collector.sysinfo_networks.refresh(true);
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
    let disk = if pdh_collected_ok {
        disk::poll_disk(&mut collector.sysinfo_disks, &collector.pdh)
    } else {
        disk::PollDiskResult {
            read_failed: true,
            ..Default::default()
        }
    };

    let gpu_updates = gpu::query_gpu_utilization_pdh(
        &collector.pdh,
        &collector.gpu_error_lock,
        &mut collector.gpu_adapters,
        &mut collector.gpu_adapters_last_refresh,
    );
    let gpu_read_failed = gpu_updates.is_none();
    let gpu_updates = gpu_updates.unwrap_or_default();

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
        gpu_read_failed,
        disk_read_failed: disk.read_failed,
        gpu_inventory_confirmed: collector
            .gpu_adapters
            .as_ref()
            .is_some_and(GpuAdapterCatalog::is_confirmed),
        nvidia_telemetry,
        disk_active: disk.active,
        disk_read_mb_s: disk.read_mb_s,
        disk_write_mb_s: disk.write_mb_s,
        disk_avg_response_ms: disk.avg_response_ms,
        disk_display_order: disk.display_order,
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
    // Full ticks always advance retained device histories with the timestamp
    // ring. A failed read is a gap; only live scalars and pruning are frozen.
    if !poll.pdh_ok || poll.gpu_read_failed {
        for (_, _, history) in &mut store.gpu_entries {
            push_history(history, None, MAX_HISTORY);
        }
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

    let mut existing: HashMap<String, (String, VecDeque<Option<f64>>)> = store
        .gpu_entries
        .drain(..)
        .map(|(key, name, hist)| (key, (name, hist)))
        .collect();

    let mut next_entries = Vec::new();
    let mut next_latest: HashMap<String, f64> = HashMap::new();

    // Keys present in this poll: fresh history append, miss counter reset.
    for (key, display_name, util) in &poll.gpu_updates {
        let util = util.filter(|v| v.is_finite()).map(|v| v.clamp(0.0, 100.0));
        let mut hist = existing
            .remove(key)
            .map(|(_, h)| h)
            .unwrap_or_else(|| VecDeque::with_capacity(MAX_HISTORY));
        push_history(&mut hist, util, MAX_HISTORY);
        next_entries.push((key.clone(), display_name.clone(), hist));
        if let Some(value) = util.or_else(|| store.gpu_latest.get(key).copied()) {
            next_latest.insert(key.clone(), value);
        }
        store.gpu_miss_count.remove(key.as_str());
    }

    // Previously-known keys absent from this poll are ghosts. Keep them
    // through a PRUNE_MISS_THRESHOLD grace window (history gaps, last-known
    // util held) so a transient adapter-metadata blip cannot wipe GPU cards;
    // drop them once the threshold is crossed (a caption leaving the vendor
    // catalog for good, e.g. after hot-plug refresh). An empty successful
    // inventory can remove the final device too; unavailable metadata cannot.
    // Iterated in `prior_keys` order so the resulting gpus array stays stable.
    if !poll.gpu_updates.is_empty() || poll.gpu_inventory_confirmed {
        for key in prior_keys {
            let Some((name, mut hist)) = existing.remove(&key) else {
                continue; // already moved into next_entries as a fresh key
            };
            let miss = store.gpu_miss_count.entry(key.clone()).or_insert(0);
            *miss += 1;
            if *miss >= PRUNE_MISS_THRESHOLD {
                store.gpu_miss_count.remove(&key);
            } else {
                push_history(&mut hist, None, MAX_HISTORY);
                if let Some(v) = store.gpu_latest.get(&key) {
                    next_latest.insert(key.clone(), *v);
                }
                next_entries.push((key, name, hist));
            }
        }
    } else {
        for key in prior_keys {
            let Some((name, mut hist)) = existing.remove(&key) else {
                continue;
            };
            if let Some(v) = store.gpu_latest.get(&key) {
                next_latest.insert(key.clone(), *v);
            }
            push_history(&mut hist, None, MAX_HISTORY);
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
    if !poll.pdh_ok || poll.gpu_read_failed {
        return;
    }

    // Refresh only keys present in this poll; ghost keys inside the prune
    // grace window keep their last-known util, mirroring commit_gpu's merge
    // (otherwise their latest value vanishes on the 3 non-full ticks between
    // full polls, even though their history and entry are still live).
    let mut next: HashMap<String, f64> = store.gpu_latest.clone();
    for (key, _, util) in &poll.gpu_updates {
        if let Some(value) = util.filter(|v| v.is_finite()) {
            next.insert(key.clone(), value.clamp(0.0, 100.0));
        }
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

    // Discover new rings only on a successful poll. Every retained disk gets
    // one slot below, including missing disks during their pruning grace.
    if poll.pdh_ok && !poll.disk_read_failed {
        for disk_key in &poll.disk_display_order {
            if !store.disk_active_histories.contains_key(disk_key) {
                store.disk_display_order.push(disk_key.clone());
                store
                    .disk_active_histories
                    .insert(disk_key.clone(), VecDeque::with_capacity(MAX_HISTORY));
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
    } else {
        store.disk_read_mb_s.clear();
        store.disk_write_mb_s.clear();
        store.disk_avg_response_ms.clear();
    }
    for (key, history) in &mut store.disk_active_histories {
        let value = (poll.pdh_ok && !poll.disk_read_failed)
            .then(|| poll.disk_active.get(key).copied().flatten())
            .flatten();
        push_history(
            history,
            value.filter(|v| v.is_finite()).map(|v| v.clamp(0.0, 100.0)),
            MAX_HISTORY,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    fn device_poll(value: f64) -> crate::state::RawPoll {
        crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![("gpu0".into(), "GPU 0".into(), Some(value))],
            disk_display_order: vec!["C:".into()],
            disk_active: HashMap::from([("C:".into(), Some(value))]),
            ..Default::default()
        }
    }

    fn commit_devices_at(
        store: &mut crate::state::HistoryStore,
        raw: &crate::state::RawPoll,
        timestamp: u64,
    ) {
        commit_gpu(store, raw);
        commit_disk_network(store, raw);
        store.push_timestamp(timestamp);
    }

    #[test]
    fn device_history_keeps_original_timestamps_through_pdh_failure() {
        let mut store = crate::state::HistoryStore::new("test");
        commit_devices_at(&mut store, &device_poll(25.0), 1_000);
        commit_devices_at(&mut store, &crate::state::RawPoll::default(), 2_000);
        let missing = serde_json::to_value(build_snapshot(&store, true, 2_000)).unwrap();
        assert!(missing["gpus"][0]["util"].is_null());
        assert!(missing["disks"][0]["active"].is_null());
        assert_eq!(store.gpu_latest["gpu0"], 25.0);
        commit_devices_at(&mut store, &device_poll(75.0), 3_000);
        let history = build_history_payload(&store, 60);
        assert_eq!(history.timestamps, vec![1_000, 2_000, 3_000]);
        assert_eq!(history.gpus[0].values, vec![Some(25.0), None, Some(75.0)]);
        assert_eq!(history.disks[0].values, history.gpus[0].values);
    }

    #[test]
    fn formatted_read_failure_does_not_prune_or_stop_the_other_domain() {
        for gpu_failed in [false, true] {
            let mut store = crate::state::HistoryStore::new("test");
            let mut first = device_poll(25.0);
            first.disk_read_mb_s.insert("C:".into(), 2.5);
            commit_devices_at(&mut store, &first, 1_000);
            for tick in 1..=PRUNE_MISS_THRESHOLD + 1 {
                let mut raw = device_poll(75.0);
                if gpu_failed {
                    raw.gpu_read_failed = true;
                    raw.gpu_updates.clear();
                } else {
                    raw.disk_read_failed = true;
                    raw.disk_display_order.clear();
                    raw.disk_active.clear();
                }
                commit_devices_at(&mut store, &raw, 1_000 + tick as u64 * 1_000);
            }
            assert_eq!(store.gpu_entries.len(), 1);
            assert_eq!(store.disk_display_order, vec!["C:"]);
            let snap = build_snapshot(&store, true, 9_000);
            assert_eq!(
                snap.gpus[0].util,
                if gpu_failed { None } else { Some(75.0) }
            );
            assert_eq!(
                snap.disks[0].active,
                if gpu_failed { Some(75.0) } else { None }
            );
            if !gpu_failed {
                assert_eq!(snap.disks[0].read_mb_s, None);
            }
            assert_eq!(
                store.gpu_latest["gpu0"],
                if gpu_failed { 25.0 } else { 75.0 }
            );
        }
    }

    #[test]
    fn invalid_instances_remain_present_with_gaps_and_last_valid_gpu_scalar() {
        let mut store = crate::state::HistoryStore::new("test");
        commit_devices_at(&mut store, &device_poll(25.0), 1_000);
        let mut invalid = device_poll(0.0);
        invalid.gpu_updates[0].2 = None;
        invalid.disk_active.insert("C:".into(), None);
        for tick in 1..=PRUNE_MISS_THRESHOLD + 1 {
            commit_devices_at(&mut store, &invalid, 1_000 + tick as u64 * 1_000);
        }
        let history = build_history_payload(&store, 60);
        assert_eq!(history.gpus.len(), 1);
        assert_eq!(history.disks.len(), 1);
        let mut expected = vec![Some(25.0)];
        expected.extend(vec![None; (PRUNE_MISS_THRESHOLD + 1) as usize]);
        assert_eq!(history.gpus[0].values, expected);
        assert_eq!(history.disks[0].values, expected);
        assert_eq!(
            build_snapshot(&store, false, 9_000).gpus[0].util,
            Some(25.0)
        );
        assert_eq!(build_snapshot(&store, true, 9_000).gpus[0].util, None);
    }

    #[test]
    fn device_history_keeps_gaps_when_hardware_returns_during_grace() {
        let mut store = crate::state::HistoryStore::new("test");
        commit_devices_at(&mut store, &device_poll(25.0), 1_000);
        let absent = crate::state::RawPoll {
            pdh_ok: true,
            gpu_inventory_confirmed: true,
            ..Default::default()
        };
        commit_devices_at(&mut store, &absent, 2_000);
        commit_devices_at(&mut store, &device_poll(0.0), 3_000);
        let history = build_history_payload(&store, 60);
        assert_eq!(history.gpus[0].values, vec![Some(25.0), None, Some(0.0)]);
        assert_eq!(history.disks[0].values, history.gpus[0].values);
    }

    #[test]
    fn device_history_rollover_keeps_failed_slots_aligned() {
        let mut store = crate::state::HistoryStore::new("test");
        for tick in 0..MAX_HISTORY + 4 {
            let raw = if tick % 2 == 0 {
                device_poll((tick % 100) as f64)
            } else {
                crate::state::RawPoll::default()
            };
            commit_devices_at(&mut store, &raw, tick as u64 * 1_000);
        }
        let history = build_history_payload(&store, MAX_HISTORY as u64);
        assert_eq!(history.timestamps.len(), MAX_HISTORY);
        for (index, timestamp) in history.timestamps.iter().enumerate() {
            let tick = timestamp / 1_000;
            let expected = if tick % 2 == 0 {
                Some((tick % 100) as f64)
            } else {
                None
            };
            assert_eq!(
                history.gpus[0].values[index], expected,
                "GPU at {timestamp}"
            );
            assert_eq!(
                history.disks[0].values[index], expected,
                "disk at {timestamp}"
            );
        }
    }

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
        let now = std::time::Instant::now();
        let mut cache = Some((now, Some(45.5)));
        assert_eq!(
            cached_cpu_temp(&mut cache, now, || panic!("fresh cache must not query")),
            Some(45.5)
        );
    }

    #[test]
    fn test_cpu_temp_cache_expired_entry_re_queries() {
        let now = std::time::Instant::now();
        let mut cache = Some((now, Some(45.5)));
        let expires = now + CPU_TEMP_CACHE_TTL;
        assert_eq!(cached_cpu_temp(&mut cache, expires, || None), None);
        assert_eq!(cache, Some((expires, None)));
    }

    #[test]
    fn test_cpu_temp_cache_without_connection_does_not_delay_first_query() {
        let mut cache = None;
        assert_eq!(query_cpu_temp_cached(&mut cache, None), None);
        assert_eq!(cache, None);
        let now = std::time::Instant::now();
        assert_eq!(cached_cpu_temp(&mut cache, now, || Some(50.0)), Some(50.0));
    }

    #[test]
    fn test_cpu_temp_cache_bounds_unavailable_queries_and_recovers_at_ttl() {
        let now = std::time::Instant::now();
        let mut cache = None;
        let mut calls = 0;
        for tick in 0..20 {
            let value = cached_cpu_temp(
                &mut cache,
                now + std::time::Duration::from_millis(tick * 250),
                || {
                    calls += 1;
                    None
                },
            );
            assert_eq!(value, None);
        }
        assert_eq!(calls, 1, "unavailable WMI must not be queried at 4 Hz");
        assert_eq!(
            cached_cpu_temp(&mut cache, now + CPU_TEMP_CACHE_TTL, || Some(55.0)),
            Some(55.0)
        );
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
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), Some(150.0))],
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
            gpu_updates: vec![("gpu1".to_string(), "GPU 1".to_string(), Some(50.0))],
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
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), Some(65.0))],
            ..Default::default()
        };
        commit_gpu(&mut store, &poll);
        let (_, _, hist) = &store.gpu_entries[0];
        assert_eq!(hist.back().copied(), Some(Some(65.0)));
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
        present.disk_active.insert("C:".to_string(), Some(10.0));
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
        present.disk_active.insert("C:".to_string(), Some(10.0));
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
        present.disk_active.insert("C:".to_string(), Some(10.0));
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
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), Some(50.0))],
            ..Default::default()
        };
        commit_gpu(&mut store, &gpu0);
        assert_eq!(store.gpu_entries.len(), 1);

        // gpu0's caption dropped out (e.g. vendor-map rebuild after a
        // hot-plug); gpu1 is what the poll reports now. gpu0 misses start.
        let gpu1 = crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![("gpu1".to_string(), "GPU 1".to_string(), Some(60.0))],
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
        // An unconfirmed empty poll is not evidence every GPU vanished.
        // Cards survive unavailable PDH and missing adapter metadata.
        let mut store = crate::state::HistoryStore::new("test");
        let present = crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), Some(50.0))],
            ..Default::default()
        };
        commit_gpu(&mut store, &present);
        for _ in 0..PRUNE_MISS_THRESHOLD * 2 {
            commit_gpu(&mut store, &crate::state::RawPoll::default());
            commit_gpu(
                &mut store,
                &crate::state::RawPoll {
                    pdh_ok: true,
                    ..Default::default()
                },
            );
        }
        assert_eq!(store.gpu_entries.len(), 1);
        assert!(
            store.gpu_miss_count.is_empty(),
            "empty polls must not count as misses"
        );
    }

    #[test]
    fn confirmed_empty_inventory_prunes_the_final_gpu_after_grace() {
        let mut store = crate::state::HistoryStore::new("test");
        commit_gpu(
            &mut store,
            &crate::state::RawPoll {
                pdh_ok: true,
                gpu_updates: vec![("last-gpu".into(), "GPU".into(), Some(50.0))],
                ..Default::default()
            },
        );
        let mut absent = crate::state::RawPoll {
            pdh_ok: true,
            gpu_inventory_confirmed: true,
            ..Default::default()
        };
        // An unavailable read must still freeze the last-known channel.
        absent.pdh_ok = false;
        for _ in 0..PRUNE_MISS_THRESHOLD * 2 {
            commit_gpu(&mut store, &absent);
        }
        assert_eq!(store.gpu_entries.len(), 1);
        absent.pdh_ok = true;
        for _ in 0..PRUNE_MISS_THRESHOLD - 1 {
            commit_gpu(&mut store, &absent);
            assert_eq!(store.gpu_entries.len(), 1);
        }
        commit_gpu(&mut store, &absent);
        assert!(store.gpu_entries.is_empty());
        assert!(store.gpu_latest.is_empty());
        assert!(store.gpu_miss_count.is_empty());
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
                ("gpu-b".to_string(), "GPU B".to_string(), Some(40.0)),
                ("gpu-a".to_string(), "GPU A".to_string(), Some(30.0)),
            ],
            ..Default::default()
        };
        commit_gpu(&mut store, &poll);

        let poll2 = crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![("gpu-c".to_string(), "GPU C".to_string(), Some(55.0))],
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

    // --- PDH failure: history gaps and frozen live scalars ---

    #[test]
    fn test_commit_gpu_appends_gap_and_preserves_latest_on_pdh_failure() {
        let mut store = crate::state::HistoryStore::new("test");
        // First, a successful poll establishes baseline
        let good_poll = crate::state::RawPoll {
            pdh_ok: true,
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), Some(45.0))],
            ..Default::default()
        };
        commit_gpu(&mut store, &good_poll);
        assert_eq!(store.gpu_latest.get("gpu0"), Some(&45.0));
        let (_, _, hist) = &store.gpu_entries[0];
        assert_eq!(hist.back().copied(), Some(Some(45.0)));

        // Now a PDH-failed tick with a different value (should be ignored)
        let bad_poll = crate::state::RawPoll {
            pdh_ok: false,
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), Some(0.0))],
            ..Default::default()
        };
        commit_gpu(&mut store, &bad_poll);
        // Keep the last good scalar while recording the failed sample's gap.
        assert_eq!(store.gpu_latest.get("gpu0"), Some(&45.0));
        let (_, _, hist) = &store.gpu_entries[0];
        assert_eq!(
            hist.back().copied(),
            Some(None),
            "GPU history must mark the failed full tick as unavailable"
        );
        assert_eq!(hist.len(), 2, "one slot per full tick, including failure");
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
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), Some(0.0))],
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
    fn test_commit_disk_network_clears_unavailable_throughput_on_pdh_failure() {
        let mut store = crate::state::HistoryStore::new("test");
        // First, a successful poll establishes baseline
        let mut good_poll = crate::state::RawPoll {
            pdh_ok: true,
            disk_display_order: vec!["C:".to_string()],
            ..Default::default()
        };
        good_poll.disk_active.insert("C:".to_string(), Some(10.0));
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
        // Failed reads must not present the previous throughput as current.
        assert_eq!(
            store.disk_read_mb_s.get("C:"),
            None,
            "Disk read must become unavailable on PDH failure"
        );
        assert_eq!(
            store.disk_write_mb_s.get("C:"),
            None,
            "Disk write must become unavailable on PDH failure"
        );
        assert_eq!(
            store.disk_avg_response_ms.get("C:"),
            None,
            "Disk response must become unavailable on PDH failure"
        );
    }

    #[test]
    fn test_commit_gpu_scalar_freezes_on_pdh_failure() {
        let mut store = crate::state::HistoryStore::new("test");
        store.gpu_latest.insert("gpu0".to_string(), 45.0);

        // PDH-failed scalar poll
        let bad_poll = crate::state::RawPoll {
            pdh_ok: false,
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), Some(0.0))],
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
            gpu_updates: vec![("gpu0".to_string(), "GPU 0".to_string(), Some(60.0))],
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
