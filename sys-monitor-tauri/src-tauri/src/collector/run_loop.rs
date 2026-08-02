// ── SINK-AGNOSTIC COLLECTOR TICK LOOP ─────────────────────────────────────────
// Extracted from main.rs's setup() so the same real loop drives the Tauri app
// (emit sink -> app_handle.emit) and the headless cadence probe (recording
// sink). The extraction is strictly behavior-preserving: same 250ms cadence,
// same 4:1 full-poll ratio, same one-PdhCollectQueryData-per-full-tick
// invariant, same catch_unwind/panic-break semantics.

use chrono::Utc;

use crate::collector::snapshot::{build_snapshot, is_full_poll_tick, MetricsSnapshot};
use crate::collector::{commit_cpu, commit_disk_network, commit_gpu, poll};
use crate::sensor::SensorRegistry;
use crate::state::{CollectorState, SafeHistoryStore};

/// Runs the real collector tick loop, delivering each built snapshot to `emit`.
///
/// Mirrors the loop previously inlined in `main.rs`'s `setup()`: a 250ms cadence
/// where every 4th tick is a full poll (fresh CPU/mem/net/disk/GPU I/O and a
/// history commit) and the other 3 are registry-only (CPU + GPU scalar refresh,
/// no history write). A caught panic delivers exactly one message to `on_error`
/// and stops the loop (no auto-restart, by design).
///
/// `ticks: Some(n)` returns after `n` iterations (or after a panic-break);
/// `None` loops forever, as production does.
pub fn run_collector_loop(
    state: &mut CollectorState,
    wmi_con: Option<&wmi::WMIConnection>,
    registry: &mut SensorRegistry,
    store: &SafeHistoryStore,
    ticks: Option<u32>,
    mut emit: impl FnMut(&MetricsSnapshot),
    mut on_error: impl FnMut(&str),
) {
    let mut tick: u32 = 0;
    loop {
        let tick_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            // Every 4th tick: full poll (one PdhCollectQueryData). Otherwise: registry
            // only (CPU + GPU, one PdhCollectQueryData in GpuSensorProvider).
            let full_poll_tick = is_full_poll_tick(tick);
            let raw = if full_poll_tick {
                Some(poll(&mut *state, wmi_con))
            } else {
                None
            };
            let reg_raw = if !full_poll_tick {
                registry.poll_all(&mut *state, wmi_con)
            } else {
                (0..registry.len()).map(|_| None).collect()
            };

            let snapshot = {
                let mut s = store.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(ref r) = raw {
                    commit_disk_network(&mut s, r);
                    commit_cpu(&mut s, r);
                    commit_gpu(&mut s, r);
                    let ts = Utc::now().timestamp_millis() as u64;
                    s.push_timestamp(ts);
                }
                registry.commit_all(&mut s, &reg_raw);
                build_snapshot(&s, full_poll_tick)
            };

            snapshot
        }));

        match tick_result {
            Ok(snapshot) => {
                emit(&snapshot);
            }
            Err(_) => {
                eprintln!("[Collector] background thread panicked");
                on_error("metrics collection stopped — restart the app");
                break;
            }
        }

        tick = tick.wrapping_add(1);
        if let Some(max) = ticks {
            if tick >= max {
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sensor::CpuSensorProvider;
    use crate::state::HistoryStore;

    // Drives run_collector_loop with a bounded tick count (2.3). A real
    // CollectorState is used (precedent: collector/nvidia.rs and collector/mod.rs
    // 5.7) so the test exercises the actual poll/commit/build path; WMI is None
    // and tolerated. Pins that the extraction preserved the 4:1 cadence gate.
    #[test]
    fn test_run_collector_loop_bounded_ticks_preserve_cadence_gate() {
        let mut state = CollectorState::new();
        let mut registry = SensorRegistry::new();
        registry.register(CpuSensorProvider);
        // Production registers GpuSensorProvider only after the profile shows
        // GPUs; keep this headless run CPU-only (matches the 5.7 precedent).
        let store = SafeHistoryStore::new(HistoryStore::new("test"));

        let mut emit_count = 0u32;
        let mut on_tick_count = 0u32;
        let mut error_count = 0u32;

        run_collector_loop(
            &mut state,
            None, // WMI unavailable — the collector tolerates this (5.7)
            &mut registry,
            &store,
            Some(8),
            |snap| {
                emit_count += 1;
                if snap.on_tick {
                    on_tick_count += 1;
                }
            },
            |_msg| {
                error_count += 1;
            },
        );

        assert_eq!(emit_count, 8, "exactly 8 ticks must emit");
        assert_eq!(error_count, 0, "a bounded clean run must not error");
        assert_eq!(
            on_tick_count, 2,
            "ticks 0 and 4 are the full-poll ticks of 8 (4:1 gate preserved)"
        );
    }
}
