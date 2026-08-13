// ── SINK-AGNOSTIC COLLECTOR TICK LOOP ─────────────────────────────────────────
// Extracted from main.rs's setup() so the same real loop drives the Tauri app
// (emit sink -> app_handle.emit) and the headless cadence probe (recording
// sink). The extraction is strictly behavior-preserving: same 250ms cadence,
// same 4:1 full-poll ratio, same one-PdhCollectQueryData-per-full-tick
// invariant, same catch_unwind/panic-break semantics.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use chrono::Utc;

use crate::collector::snapshot::{build_snapshot, is_full_poll_tick, MetricsSnapshot};
use crate::collector::{commit_cpu, commit_disk_network, commit_gpu, poll};
use crate::sensor::SensorRegistry;
use crate::state::{CollectorState, SafeHistoryStore};

/// Intended live update cadence. History is still committed only on every
/// fourth emitted tick, so this is a 4 Hz live / 1 Hz history schedule.
pub const TICK_INTERVAL: Duration = Duration::from_millis(250);

/// A bounded run can be limited by ticks for deterministic unit tests or by
/// monotonic wall time for the real-hardware probe. Duration runs begin at the
/// first emitted snapshot so bootstrap/work time cannot shorten the measured
/// observation. Production uses `None`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LoopLimit {
    Ticks(u32),
    Duration(Duration),
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct TickTiming {
    pub work_duration: Duration,
    pub deadline_overrun: Duration,
    pub wmi_duration: Duration,
    pub full_poll_duration: Duration,
    pub registry_duration: Duration,
    pub history_lock_duration: Duration,
}

/// Non-blocking WMI bootstrap owned by the collector thread. Core PDH/sysinfo
/// metrics start immediately; WMI retries happen between ticks with bounded
/// exponential backoff and the connection never leaves this MTA thread.
pub struct WmiBootstrap {
    connection: Option<wmi::WMIConnection>,
    attempts: u32,
    next_attempt: Instant,
}

impl WmiBootstrap {
    const BASE_BACKOFF: Duration = Duration::from_secs(1);
    const MAX_BACKOFF: Duration = Duration::from_secs(30);
    const MAX_ATTEMPTS: u32 = 8;

    pub fn new() -> Self {
        Self {
            connection: None,
            attempts: 0,
            next_attempt: Instant::now(),
        }
    }

    pub fn poll(&mut self) -> Option<&wmi::WMIConnection> {
        if self.connection.is_none()
            && self.attempts < Self::MAX_ATTEMPTS
            && Instant::now() >= self.next_attempt
        {
            self.attempts += 1;
            match wmi::COMLibrary::new().and_then(wmi::WMIConnection::new) {
                Ok(connection) => {
                    eprintln!("[WMI] Background thread connection initialized (MTA).");
                    self.connection = Some(connection);
                }
                Err(error) => {
                    let exponent = self.attempts.saturating_sub(1).min(5);
                    let backoff = (Self::BASE_BACKOFF * 2u32.pow(exponent)).min(Self::MAX_BACKOFF);
                    self.next_attempt = Instant::now() + backoff;
                    if self.attempts == 1 || self.attempts == Self::MAX_ATTEMPTS {
                        eprintln!(
                            "[WMI] attempt {}/{} failed: {:?}; next retry in {:?}",
                            self.attempts,
                            Self::MAX_ATTEMPTS,
                            error,
                            backoff
                        );
                    }
                }
            }
        }
        self.connection.as_ref()
    }

    pub fn connection(&self) -> Option<&wmi::WMIConnection> {
        self.connection.as_ref()
    }
}

impl Default for WmiBootstrap {
    fn default() -> Self {
        Self::new()
    }
}

/// Advances a deadline without accumulating missed work. If a tick has
/// overrun its deadline, the next tick is rebased one full period from the
/// current time instead of spinning through stale deadlines.
pub fn rebase_deadline(previous_deadline: Duration, now: Duration, period: Duration) -> Duration {
    let next = previous_deadline.saturating_add(period);
    if next <= now {
        now.saturating_add(period)
    } else {
        next
    }
}

fn wait_until_deadline(deadline: Instant, stop: Option<&AtomicBool>) -> bool {
    loop {
        if stop.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            return false;
        }
        let now = Instant::now();
        if now >= deadline {
            return true;
        }
        // AtomicBool has no blocking wait on the supported Windows targets;
        // bound shutdown latency to 10ms while avoiding a busy loop.
        std::thread::sleep((deadline - now).min(Duration::from_millis(10)));
    }
}

/// Project the collector's monotonic epoch onto a wall-clock origin once.
/// The resulting IPC timestamp remains useful to the frontend/X axis while
/// subsequent samples cannot move backwards when the system clock is adjusted.
pub fn monotonic_timestamp_ms(wall_origin_ms: u64, epoch: Instant, now: Instant) -> u64 {
    wall_origin_ms.saturating_add(now.saturating_duration_since(epoch).as_millis() as u64)
}

/// Runs the real collector tick loop, delivering each built snapshot to `emit`.
///
/// Mirrors the loop previously inlined in `main.rs`'s `setup()`: a 250ms cadence
/// where every 4th tick is a full poll (fresh CPU/mem/net/disk/GPU I/O and a
/// history commit) and the other 3 are registry-only (CPU + GPU scalar refresh,
/// no history write). A caught panic delivers exactly one message to `on_error`
/// and stops the loop (no auto-restart, by design).
///
/// `limit: Some(LoopLimit::Ticks(n))` returns after `n` iterations;
/// `Some(LoopLimit::Duration(d))` uses monotonic elapsed time; `None` loops
/// forever, as production does. A slow tick rebases the next deadline rather
/// than performing a catch-up burst.
#[allow(clippy::too_many_arguments)]
pub fn run_collector_loop(
    state: &mut CollectorState,
    wmi_bootstrap: &mut WmiBootstrap,
    registry: &mut SensorRegistry,
    store: &SafeHistoryStore,
    limit: Option<LoopLimit>,
    stop: Option<&AtomicBool>,
    mut on_timing: impl FnMut(TickTiming),
    mut on_wmi_ready: impl FnMut(&mut CollectorState, &wmi::WMIConnection),
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
    state.network_last_refresh = Instant::now();

    let loop_epoch = Instant::now();
    let wall_origin_ms = Utc::now().timestamp_millis().max(0) as u64;
    let mut next_deadline = loop_epoch;
    let mut tick: u32 = 0;
    let mut wmi_ready = false;
    let mut first_emit_epoch: Option<Instant> = None;
    loop {
        if matches!(limit, Some(LoopLimit::Ticks(0)))
            || stop.is_some_and(|flag| flag.load(Ordering::Relaxed))
        {
            break;
        }
        let tick_started = Instant::now();
        let deadline_overrun = tick_started.saturating_duration_since(next_deadline);
        let tick_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            // Do not make the first core snapshot wait for COM/WMI startup.
            // A connection that is already ready is safe to use; an initial
            // attempt is deferred until after this tick has been emitted.
            let wmi_con = wmi_bootstrap.connection();
            // Every 4th tick: full poll (one PdhCollectQueryData). Otherwise: registry
            // only (CPU + GPU, one PdhCollectQueryData in GpuSensorProvider).
            let full_poll_tick = is_full_poll_tick(tick);
            let full_poll_started = Instant::now();
            let raw = if full_poll_tick {
                Some(poll(&mut *state, wmi_con))
            } else {
                None
            };
            let full_poll_duration = if full_poll_tick {
                full_poll_started.elapsed()
            } else {
                Duration::ZERO
            };
            let registry_started = Instant::now();
            let reg_raw = if !full_poll_tick {
                registry.poll_all(&mut *state, wmi_con)
            } else {
                (0..registry.len()).map(|_| None).collect()
            };
            let registry_duration = if !full_poll_tick {
                registry_started.elapsed()
            } else {
                Duration::ZERO
            };

            let history_lock_started = Instant::now();
            let snapshot = {
                let mut s = store.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(ref r) = raw {
                    commit_disk_network(&mut s, r);
                    commit_cpu(&mut s, r);
                    commit_gpu(&mut s, r);
                    let ts = monotonic_timestamp_ms(wall_origin_ms, loop_epoch, Instant::now());
                    s.push_timestamp(ts);
                }
                registry.commit_all(&mut s, &reg_raw);
                build_snapshot(&s, full_poll_tick)
            };
            let history_lock_duration = history_lock_started.elapsed();

            (
                snapshot,
                TickTiming {
                    work_duration: tick_started.elapsed(),
                    deadline_overrun,
                    wmi_duration: Duration::ZERO,
                    full_poll_duration,
                    registry_duration,
                    history_lock_duration,
                },
            )
        }));

        match tick_result {
            Ok((snapshot, mut timing)) => {
                first_emit_epoch.get_or_insert_with(Instant::now);
                emit(&snapshot);

                // WMI is optional enrichment. Starting the attempt after the
                // first snapshot makes CPU/memory/network liveness observable
                // even when COM/WMI is unavailable or slow to initialize. The
                // connection remains owned by this MTA collector thread.
                if !wmi_ready {
                    let wmi_started = Instant::now();
                    let wmi_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        if let Some(connection) = wmi_bootstrap.poll() {
                            on_wmi_ready(&mut *state, connection);
                            wmi_ready = true;
                        }
                    }));
                    timing.wmi_duration = wmi_started.elapsed();
                    timing.work_duration = tick_started.elapsed();
                    if wmi_result.is_err() {
                        eprintln!("[Collector] WMI bootstrap panicked");
                        on_error("metrics collection stopped — restart the app");
                        break;
                    }
                }
                on_timing(timing);
            }
            Err(_) => {
                eprintln!("[Collector] background thread panicked");
                on_error("metrics collection stopped — restart the app");
                break;
            }
        }

        tick = tick.wrapping_add(1);
        if let Some(LoopLimit::Ticks(max)) = limit {
            if tick >= max {
                break;
            }
        }
        if let Some(LoopLimit::Duration(duration)) = limit {
            if first_emit_epoch.is_some_and(|epoch| epoch.elapsed() >= duration) {
                break;
            }
        }

        let now = Instant::now();
        let elapsed_since_epoch = now.saturating_duration_since(loop_epoch);
        let previous_deadline = next_deadline.saturating_duration_since(loop_epoch);
        next_deadline =
            loop_epoch + rebase_deadline(previous_deadline, elapsed_since_epoch, TICK_INTERVAL);
        if !wait_until_deadline(next_deadline, stop) {
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
        let mut wmi_bootstrap = WmiBootstrap::new();

        let mut emit_count = 0u32;
        let mut on_tick_count = 0u32;
        let mut error_count = 0u32;

        run_collector_loop(
            &mut state,
            &mut wmi_bootstrap,
            &mut registry,
            &store,
            Some(LoopLimit::Ticks(8)),
            None,
            |_timing| {},
            |_state, _wmi| {},
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
                // This test is about panic containment, not provider cadence;
                // make every registry pass eligible so the second pass is
                // deterministic even when the host is under load.
                std::time::Duration::ZERO
            }
        }

        let mut state = CollectorState::new();
        let mut registry = SensorRegistry::new();
        registry.register(CpuSensorProvider);
        registry.register(PanicProvider { polls: 0 });
        let store = SafeHistoryStore::new(HistoryStore::new("test"));
        let mut wmi_bootstrap = WmiBootstrap::new();

        let mut emit_count = 0u32;
        let mut error_count = 0u32;

        run_collector_loop(
            &mut state,
            &mut wmi_bootstrap,
            &mut registry,
            &store,
            Some(LoopLimit::Ticks(10)), // the panic must stop the loop well before tick 10
            None,
            |_timing| {},
            |_state, _wmi| {},
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

    #[test]
    fn test_rebase_deadline_skips_missed_periods_without_catch_up_burst() {
        let period = Duration::from_millis(250);
        assert_eq!(
            rebase_deadline(
                Duration::from_millis(250),
                Duration::from_millis(260),
                period
            ),
            Duration::from_millis(500)
        );
        assert_eq!(
            rebase_deadline(
                Duration::from_millis(250),
                Duration::from_millis(1_250),
                period
            ),
            Duration::from_millis(1_500)
        );
    }

    #[test]
    fn test_monotonic_timestamp_projection_never_moves_backwards() {
        let epoch = Instant::now();
        let earlier = monotonic_timestamp_ms(1_000_000, epoch, epoch + Duration::from_millis(250));
        let later = monotonic_timestamp_ms(1_000_000, epoch, epoch + Duration::from_millis(500));
        assert_eq!(earlier, 1_000_250);
        assert_eq!(later, 1_000_500);
        assert!(later >= earlier);
    }

    #[test]
    fn test_run_collector_loop_honors_stop_before_startup_work() {
        let mut state = CollectorState::new();
        let mut registry = SensorRegistry::new();
        registry.register(CpuSensorProvider);
        let store = SafeHistoryStore::new(HistoryStore::new("test"));
        let mut wmi_bootstrap = WmiBootstrap::new();
        let stop = AtomicBool::new(true);
        let mut emits = 0_u32;

        run_collector_loop(
            &mut state,
            &mut wmi_bootstrap,
            &mut registry,
            &store,
            None,
            Some(&stop),
            |_| {},
            |_, _| {},
            |_| emits += 1,
            |_| {},
        );

        assert_eq!(
            emits, 0,
            "a stop requested during app shutdown must prevent a new tick"
        );
    }
}
