// ── SINK-AGNOSTIC COLLECTOR TICK LOOP ─────────────────────────────────────────
// Extracted from main.rs's setup() so the same real loop drives the Tauri app
// (emit sink -> app_handle.emit) and the headless cadence probe (recording
// sink). The extraction is strictly behavior-preserving: same 250ms cadence,
// same 4:1 full-poll ratio, same one-PdhCollectQueryData-per-full-tick
// invariant, same catch_unwind/panic-break semantics.

use std::sync::atomic::{AtomicBool, Ordering};

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
#[allow(clippy::too_many_arguments)]
pub fn run_collector_loop(
    state: &mut CollectorState,
    wmi_con: Option<&wmi::WMIConnection>,
    registry: &mut SensorRegistry,
    store: &SafeHistoryStore,
    ticks: Option<u32>,
    stop: Option<&AtomicBool>,
    mut emit: impl FnMut(&MetricsSnapshot),
    mut on_error: impl FnMut(&str),
) {
    // Re-baseline the sysinfo network counters before the first tick: the last
    // refresh happened in CollectorState::new(), and the startup gap (WMI retry,
    // profile detect) can be seconds long. Without this, the first poll() would
    // aggregate that whole gap into a single network delta — a large spike in
    // the first chart point. This refresh is a no-op for metrics but resets the
    // delta baseline so the first real reading is ~250ms worth.
    state.sysinfo_networks.refresh(false);

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
        if stop.is_some_and(|f| f.load(Ordering::Relaxed)) {
            break;
        }
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
            None,
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

    // Drives the REAL run_collector_loop with a provider that panics on its 2nd
    // poll. Assertions: exactly one on_error delivery, and no further emits
    // after the panicking tick — the loop stops permanently (no auto-restart).
    #[test]
    fn test_run_collector_loop_panicking_provider_emits_one_error_and_stops() {
        use crate::sensor::SensorProvider;
        use crate::state::{HistoryStore, RawPoll};

        struct PanicProvider {
            polls: u32,
        }

        impl SensorProvider for PanicProvider {
            fn poll(
                &mut self,
                _state: &mut CollectorState,
                _wmi_con: Option<&wmi::WMIConnection>,
            ) -> RawPoll {
                self.polls += 1;
                if self.polls == 2 {
                    panic!("synthetic provider panic");
                }
                RawPoll::default()
            }

            fn commit(&mut self, _store: &mut HistoryStore, _raw: &RawPoll) {}

            fn poll_interval(&self) -> std::time::Duration {
                std::time::Duration::from_millis(250)
            }
        }

        let mut state = CollectorState::new();
        let mut registry = SensorRegistry::new();
        registry.register(CpuSensorProvider);
        registry.register(PanicProvider { polls: 0 });
        let store = SafeHistoryStore::new(HistoryStore::new("test"));

        let mut emit_count = 0u32;
        let mut error_count = 0u32;

        run_collector_loop(
            &mut state,
            None,
            &mut registry,
            &store,
            Some(10), // the panic must stop the loop well before tick 10
            None,
            |_snap| emit_count += 1,
            |_msg| error_count += 1,
        );

        // Cadence: tick 0 is a full poll (emit, provider untouched), tick 1 is
        // the provider's 1st poll (emit), tick 2 is its 2nd poll → panics.
        assert_eq!(
            emit_count, 2,
            "no emits may happen after the panicking tick"
        );
        assert_eq!(
            error_count, 1,
            "exactly one on_error and the loop must stop"
        );
    }
}
