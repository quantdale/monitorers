// ── SNAPSHOT & PAYLOAD TYPES ──────────────────────────────────────────────────
// Moved out of main.rs (see lib.rs) so the headless cadence probe can build real
// snapshots. SCHEMA_VERSION must stay in sync with EXPECTED_SCHEMA_VERSION in the
// frontend (src/hooks/useMetrics.ts) whenever the payload shape changes.

use std::collections::{HashMap, VecDeque};

use crate::hardware::{classify_gpu, GpuVendor};
use crate::state::HistoryStore;

/// Bump in lockstep with `EXPECTED_SCHEMA_VERSION` in the frontend
/// (`src/hooks/useMetrics.ts`) when `MetricsSnapshot`'s shape changes.
pub const SCHEMA_VERSION: u32 = 3;

/// Every 4th tick is a full poll (fresh CPU/mem/net/disk/GPU I/O, history committed).
/// The other 3 ticks are registry-only (CPU + GPU scalar refresh, no history write).
/// Extracted as a pure function so the 1Hz history-commit cadence is unit-testable
/// in isolation from the I/O it gates (TEST-001).
pub fn is_full_poll_tick(tick: u32) -> bool {
    tick.is_multiple_of(4)
}

#[derive(serde::Serialize, Clone)]
pub struct MetricsSnapshot {
    pub schema_version: u32,
    /// True when this snapshot was emitted on a full (history-committing) tick.
    /// The frontend only appends to its charting history arrays when this is true;
    /// it still updates live scalar readouts (e.g. CPU/GPU %) on every event.
    pub on_tick: bool,
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
    pub vendor: String,
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
    pub timestamps: Vec<u64>,
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
pub fn slice_history(deque: &VecDeque<f64>, window_secs: u64) -> Vec<f64> {
    let n = window_secs.min(usize::MAX as u64) as usize;
    let len = deque.len();
    if n == 0 || n >= len {
        deque.iter().copied().collect()
    } else {
        deque.iter().skip(len - n).copied().collect()
    }
}

pub fn slice_timestamps(deque: &VecDeque<u64>, window_secs: u64) -> Vec<u64> {
    let n = window_secs.min(usize::MAX as u64) as usize;
    let len = deque.len();
    if n == 0 || n >= len {
        deque.iter().copied().collect()
    } else {
        deque.iter().skip(len - n).copied().collect()
    }
}

/// Clamp an IPC-supplied history window (seconds) to the valid range `[1, MAX_HISTORY]`.
///
/// `window_secs` crosses the IPC boundary as an unvalidated u64. Values below 1
/// (notably 0, `slice_history`'s "everything" sentinel) are clamped up to 1 (the
/// most recent point), and values above `MAX_HISTORY` are clamped down to the
/// history capacity. The frontend always passes an explicit window, so these
/// bounds only matter for malformed/abusive calls — this keeps the request
/// explicit and bounded instead of letting an arbitrary u64 mean
/// "entire history" or worse.
pub fn clamp_window_secs(window_secs: u64) -> u64 {
    window_secs.clamp(1, crate::state::HISTORY_CAPACITY as u64)
}

// ── SNAPSHOT BUILDER ─────────────────────────────────────────────────────────

pub fn build_snapshot(s: &HistoryStore, on_tick: bool) -> MetricsSnapshot {
    let cpu = s
        .cpu_latest
        .unwrap_or_else(|| s.cpu_history.back().copied().unwrap_or(0.0));
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
    // Cache per-name vendor classification so repeated GPU names are classified
    // once per snapshot instead of re-running classify_gpu for every entry.
    let mut vendor_cache: HashMap<String, String> = HashMap::new();
    for (_, name, _) in &s.gpu_entries {
        vendor_cache.entry(name.clone()).or_insert_with(|| {
            let (vendor_enum, _kind) = classify_gpu(name);
            match vendor_enum {
                GpuVendor::Nvidia => "nvidia",
                GpuVendor::Intel => "intel",
                GpuVendor::Amd => "amd",
                GpuVendor::Unknown => "unknown",
            }
            .to_string()
        });
    }
    let gpus = s
        .gpu_entries
        .iter()
        .map(|(key, name, hist)| {
            let vendor = vendor_cache
                .get(name)
                .cloned()
                .unwrap_or_else(|| "unknown".to_string());
            let temp_c = if super::is_nvidia_gpu(name) && nvidia_temp.is_some() {
                nvidia_temp
            } else {
                None
            };
            GpuSnapshot {
                name: name.clone(),
                vendor,
                util: s
                    .gpu_latest
                    .get(key)
                    .copied()
                    .unwrap_or_else(|| hist.back().copied().unwrap_or(0.0)),
                temp_c,
            }
        })
        .collect();

    MetricsSnapshot {
        schema_version: SCHEMA_VERSION,
        on_tick,
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

pub fn build_history_payload(s: &HistoryStore, window_secs: u64) -> HistoryPayload {
    HistoryPayload {
        schema_version: SCHEMA_VERSION,
        timestamps: slice_timestamps(&s.timestamps, window_secs),
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
                let temp_c = if super::is_nvidia_gpu(name) && s.nvidia_temp.is_some() {
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

    // --- is_full_poll_tick cadence gate (TEST-001) ---

    #[test]
    fn test_is_full_poll_tick_true_on_multiples_of_four() {
        for tick in [0u32, 4, 8, 12, 100] {
            assert!(is_full_poll_tick(tick), "tick {tick} should be a full poll");
        }
    }

    #[test]
    fn test_is_full_poll_tick_false_on_non_multiples_of_four() {
        for tick in [1u32, 2, 3, 5, 6, 7, 101] {
            assert!(
                !is_full_poll_tick(tick),
                "tick {tick} should not be a full poll"
            );
        }
    }

    #[test]
    fn test_is_full_poll_tick_pattern_over_range() {
        let results: Vec<bool> = (0..9).map(is_full_poll_tick).collect();
        assert_eq!(
            results,
            vec![true, false, false, false, true, false, false, false, true]
        );
    }

    #[test]
    fn test_is_full_poll_tick_cadence_holds_over_sustained_range() {
        let full_poll_count = (0u32..400).filter(|&t| is_full_poll_tick(t)).count();
        assert_eq!(
            full_poll_count, 100,
            "exactly 1/4 of 400 ticks must be full polls"
        );

        for tick in 0u32..400 {
            assert_eq!(
                is_full_poll_tick(tick),
                tick.is_multiple_of(4),
                "tick {tick} cadence mismatch"
            );
        }
    }

    // --- build_snapshot on_tick pass-through ---

    #[test]
    fn test_build_snapshot_on_tick_true() {
        let s = HistoryStore::new("test");
        let snap = build_snapshot(&s, true);
        assert!(snap.on_tick);
    }

    #[test]
    fn test_build_snapshot_on_tick_false() {
        let s = HistoryStore::new("test");
        let snap = build_snapshot(&s, false);
        assert!(!snap.on_tick);
    }

    // --- build_snapshot latest-value preference ---

    #[test]
    fn test_build_snapshot_prefers_cpu_latest() {
        let mut s = HistoryStore::new("test");
        s.cpu_latest = Some(42.0);
        s.cpu_history = deque(&[10.0, 20.0, 30.0]);
        let snap = build_snapshot(&s, true);
        assert_eq!(snap.cpu, 42.0);
    }

    #[test]
    fn test_build_snapshot_prefers_gpu_latest() {
        let mut s = HistoryStore::new("test");
        s.gpu_entries = vec![(
            "gpu0".to_string(),
            "NVIDIA GeForce".to_string(),
            deque(&[10.0, 20.0]),
        )];
        s.gpu_latest.insert("gpu0".to_string(), 75.0);
        let snap = build_snapshot(&s, true);
        assert_eq!(snap.gpus.len(), 1);
        assert_eq!(snap.gpus[0].util, 75.0);
    }

    #[test]
    fn test_build_snapshot_cpu_fallback_without_latest() {
        let mut s = HistoryStore::new("test");
        s.cpu_history = deque(&[10.0, 20.0, 30.0]);
        let snap = build_snapshot(&s, true);
        assert_eq!(snap.cpu, 30.0);
    }

    #[test]
    fn test_build_snapshot_gpu_fallback_without_latest() {
        let mut s = HistoryStore::new("test");
        s.gpu_entries = vec![(
            "gpu0".to_string(),
            "NVIDIA GeForce".to_string(),
            deque(&[10.0, 25.0]),
        )];
        let snap = build_snapshot(&s, true);
        assert_eq!(snap.gpus[0].util, 25.0);
    }

    // --- build_history_payload ---

    #[test]
    fn test_build_history_payload_slices_all_metric_arrays() {
        let mut s = HistoryStore::new("AMD Ryzen");
        // 5 points per ring buffer; window 3 must slice the last 3 of each.
        for tick in 0..5u64 {
            s.cpu_history.push_back(tick as f64 * 10.0);
            s.mem_history.push_back(tick as f64);
            s.net_recv_history.push_back(tick as f64 * 2.0);
            s.net_sent_history.push_back(tick as f64 * 3.0);
            s.push_timestamp(1000 + tick);
        }
        for key in ["C:", "D:"] {
            s.disk_display_order.push(key.to_string());
            let hist = s.disk_active_histories.entry(key.to_string()).or_default();
            for tick in 0..5u64 {
                hist.push_back(100.0 + tick as f64);
            }
        }
        s.disk_read_mb_s.insert("C:".to_string(), 12.5);
        s.gpu_entries.push((
            "gpu0".to_string(),
            "GeForce RTX 4070".to_string(),
            VecDeque::from([10.0, 20.0, 30.0, 40.0, 50.0]),
        ));

        let payload = build_history_payload(&s, 3);

        assert_eq!(payload.schema_version, SCHEMA_VERSION);
        assert_eq!(payload.timestamps, vec![1002, 1003, 1004]);
        assert_eq!(payload.cpu, vec![20.0, 30.0, 40.0]);
        assert_eq!(payload.cpu_name, "AMD Ryzen");
        assert_eq!(payload.mem, vec![2.0, 3.0, 4.0]);
        assert_eq!(payload.net_recv, vec![4.0, 6.0, 8.0]);
        assert_eq!(payload.net_sent, vec![6.0, 9.0, 12.0]);
        assert_eq!(payload.disks.len(), 2, "disk order follows display order");
        assert_eq!(payload.disks[0].key, "C:");
        assert_eq!(payload.disks[0].values, vec![102.0, 103.0, 104.0]);
        assert_eq!(payload.disks[0].read_mb_s, 12.5);
        assert_eq!(payload.disks[0].temp_c, None);
        assert_eq!(payload.disks[1].key, "D:");
        assert_eq!(payload.gpus.len(), 1);
        assert_eq!(payload.gpus[0].name, "GeForce RTX 4070");
        assert_eq!(payload.gpus[0].values, vec![30.0, 40.0, 50.0]);
    }

    #[test]
    fn test_build_history_payload_window_beyond_capacity_returns_all() {
        let mut s = HistoryStore::new("test");
        for tick in 0..3u64 {
            s.cpu_history.push_back(tick as f64);
            s.push_timestamp(2000 + tick);
        }
        let payload = build_history_payload(&s, 10_000);
        assert_eq!(payload.cpu, vec![0.0, 1.0, 2.0]);
        assert_eq!(payload.timestamps, vec![2000, 2001, 2002]);
    }

    #[test]
    fn test_build_history_payload_nvidia_temp_gating() {
        // temp_c is attached only to Nvidia GPUs and only when a reading exists.
        let mut s = HistoryStore::new("test");
        s.nvidia_temp = Some(70.0);
        s.gpu_entries.push((
            "gpu0".to_string(),
            "GeForce RTX 4070".to_string(),
            VecDeque::from([33.0]),
        ));
        s.gpu_entries.push((
            "gpu1".to_string(),
            "Radeon RX 6700".to_string(),
            VecDeque::from([44.0]),
        ));

        let payload = build_history_payload(&s, 10);
        assert_eq!(payload.gpus.len(), 2);
        assert_eq!(payload.gpus[0].temp_c, Some(70.0));
        assert_eq!(payload.gpus[1].temp_c, None, "non-Nvidia GPUs get no temp");
    }

    #[test]
    fn test_build_history_payload_nvidia_temp_none_when_unavailable() {
        let mut s = HistoryStore::new("test");
        s.nvidia_temp = None;
        s.gpu_entries.push((
            "gpu0".to_string(),
            "GeForce RTX 4070".to_string(),
            VecDeque::from([33.0]),
        ));

        let payload = build_history_payload(&s, 10);
        assert_eq!(payload.gpus[0].temp_c, None);
    }

    // --- clamp_window_secs (IPC boundary, F-9) ---

    #[test]
    fn test_clamp_window_secs_mid_range_passthrough() {
        assert_eq!(clamp_window_secs(60), 60);
        assert_eq!(
            clamp_window_secs(crate::state::HISTORY_CAPACITY as u64),
            crate::state::HISTORY_CAPACITY as u64
        );
    }

    #[test]
    fn test_clamp_window_secs_zero_clamped_up_to_one() {
        // 0 would mean "everything" in slice_history; at the IPC boundary it is
        // clamped to the most recent point so a malformed call is well-defined.
        assert_eq!(clamp_window_secs(0), 1);
    }

    #[test]
    fn test_clamp_window_secs_caps_at_history_capacity() {
        assert_eq!(
            clamp_window_secs(10_000),
            crate::state::HISTORY_CAPACITY as u64
        );
        assert_eq!(
            clamp_window_secs(u64::MAX),
            crate::state::HISTORY_CAPACITY as u64
        );
    }
}
