// ── SENSOR PROVIDER TRAIT & REGISTRY ──────────────────────────────────────────
// Per-provider poll intervals; registry schedules providers by elapsed time.

#[cfg(all(feature = "nvapi", not(feature = "nvml")))]
use crate::collector::query_nvidia_gpu_temp;
use crate::collector::{self, query_cpu_temp_cached, query_gpu_utilization_pdh};
use crate::state::{CollectorState, HistoryStore, RawPoll};
use std::sync::OnceLock;
use std::time::Instant;

// ── SensorProvider trait ─────────────────────────────────────────────────────

pub trait SensorProvider: Send {
    fn poll(&mut self, state: &mut CollectorState, wmi_con: Option<&wmi::WMIConnection>)
        -> RawPoll;

    fn commit(&mut self, store: &mut HistoryStore, raw: &RawPoll);

    /// How often this provider should be polled.
    /// Default: 1000ms (matches current behavior for untagged providers).
    fn poll_interval(&self) -> std::time::Duration {
        std::time::Duration::from_millis(1000)
    }

    fn name(&self) -> &'static str {
        "sensor"
    }
}

// ── CpuSensorProvider ─────────────────────────────────────────────────────────

pub struct CpuSensorProvider;

impl SensorProvider for CpuSensorProvider {
    fn poll(
        &mut self,
        state: &mut CollectorState,
        wmi_con: Option<&wmi::WMIConnection>,
    ) -> RawPoll {
        state.system.refresh_cpu_usage();
        let cpu_usage = state.system.global_cpu_usage().clamp(0.0, 100.0_f32) as f64;
        let cpu_temp_c = query_cpu_temp_cached(&mut state.cpu_temp_cache, wmi_con);
        if cpu_temp_c.is_none() {
            state.cpu_temp_error_lock.get_or_init(|| {
                eprintln!("[Thermal] CPU temperature unavailable (Win32_PerfFormattedData_Counters_ThermalZoneInformation not present or empty).");
            });
        }
        RawPoll {
            cpu_usage,
            cpu_temp_c,
            ..Default::default()
        }
    }

    fn commit(&mut self, store: &mut HistoryStore, raw: &RawPoll) {
        collector::commit_cpu_scalar(store, raw);
    }

    fn poll_interval(&self) -> std::time::Duration {
        std::time::Duration::from_millis(250)
    }

    fn name(&self) -> &'static str {
        "cpu"
    }
}

// ── GpuSensorProvider ─────────────────────────────────────────────────────────

pub struct GpuSensorProvider;

impl SensorProvider for GpuSensorProvider {
    fn poll(
        &mut self,
        state: &mut CollectorState,
        wmi_con: Option<&wmi::WMIConnection>,
    ) -> RawPoll {
        let pdh_ok = collector::collect_pdh(state);
        let gpu_updates = query_gpu_utilization_pdh(
            &state.pdh,
            wmi_con,
            &state.gpu_error_lock,
            &mut state.gpu_vendor_map,
            &mut state.gpu_vendor_map_last_build,
        );

        #[cfg(feature = "nvml")]
        let nvidia_telemetry = if state.nvidia_enrichment_due() {
            let readings = state
                .nvml
                .as_ref()
                .map(collector::nvidia::query_nvml)
                .unwrap_or_default();
            state.mark_nvidia_enrichment();
            Some(collector::nvidia::reconcile_nvml_readings(
                &gpu_updates,
                &readings,
            ))
        } else {
            None
        };

        #[cfg(all(feature = "nvapi", not(feature = "nvml")))]
        let nvidia_telemetry = collector::nvidia::nvapi_telemetry_for(
            &gpu_updates,
            query_nvidia_gpu_temp(state.nvapi_initialized),
        );

        #[cfg(not(any(feature = "nvml", feature = "nvapi")))]
        let nvidia_telemetry = None;

        RawPoll {
            gpu_updates,
            nvidia_telemetry,
            pdh_ok,
            ..Default::default()
        }
    }

    fn commit(&mut self, store: &mut HistoryStore, raw: &RawPoll) {
        collector::commit_gpu_scalar(store, raw);
    }

    fn poll_interval(&self) -> std::time::Duration {
        std::time::Duration::from_millis(250)
    }

    fn name(&self) -> &'static str {
        "gpu"
    }
}

// ── ProviderEntry & SensorRegistry ─────────────────────────────────────────────

struct ProviderEntry {
    provider: Box<dyn SensorProvider>,
    /// None until the provider's first poll; `None` means due immediately.
    /// Avoids an unchecked `Instant - interval` subtraction (which would panic
    /// on a host with sub-interval uptime) while preserving first-poll-now
    /// semantics.
    last_polled: Option<std::time::Instant>,
}

pub struct SensorRegistry {
    entries: Vec<ProviderEntry>,
}

fn perf_logging_enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var_os("SYSMON_PERF_LOG").is_some())
}

impl SensorRegistry {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    pub fn register(&mut self, provider: impl SensorProvider + 'static) {
        self.entries.push(ProviderEntry {
            provider: Box::new(provider),
            last_polled: None,
        });
    }

    /// Number of registered providers (used to build placeholder reg_raw on full ticks).
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True when no providers are registered.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn poll_all(
        &mut self,
        state: &mut CollectorState,
        wmi_con: Option<&wmi::WMIConnection>,
    ) -> Vec<Option<RawPoll>> {
        let now = Instant::now();
        self.entries
            .iter_mut()
            .map(|entry| {
                let interval = entry.provider.poll_interval();
                let due = entry
                    .last_polled
                    .is_none_or(|last| now.duration_since(last) >= interval);
                if due {
                    entry.last_polled = Some(now);
                    let started = Instant::now();
                    let raw = entry.provider.poll(state, wmi_con);
                    if perf_logging_enabled() {
                        eprintln!(
                            "[Perf] provider={} duration_us={}",
                            entry.provider.name(),
                            started.elapsed().as_micros()
                        );
                    }
                    Some(raw)
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn commit_all(&mut self, store: &mut HistoryStore, raw_polls: &[Option<RawPoll>]) {
        for (entry, raw_opt) in self.entries.iter_mut().zip(raw_polls.iter()) {
            if let Some(raw) = raw_opt {
                entry.provider.commit(store, raw);
            }
        }
    }
}

impl Default for SensorRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A provider that just counts polls and commits nothing.
    struct IntervalProvider {
        poll_count: u32,
    }

    impl SensorProvider for IntervalProvider {
        fn poll(
            &mut self,
            _state: &mut CollectorState,
            _wmi_con: Option<&wmi::WMIConnection>,
        ) -> RawPoll {
            self.poll_count += 1;
            RawPoll::default()
        }

        fn commit(&mut self, _store: &mut HistoryStore, _raw: &RawPoll) {}

        fn poll_interval(&self) -> std::time::Duration {
            std::time::Duration::from_millis(1000)
        }
    }

    // Exercises the interval-gating branch of poll_all: a provider with a 1000ms
    // interval is polled on the first call (due immediately) and again on the
    // 5th call (~1000ms later), but not on calls 2-4 (still within the window).
    // This maps to the 250ms tick cadence, where such a provider fires on ticks
    // 0 and 4 of the registry schedule, not ticks 1-3.
    #[test]
    fn test_interval_gated_provider_polls_on_time_not_every_call() {
        let mut registry = SensorRegistry::new();
        registry.register(IntervalProvider { poll_count: 0 });
        let mut state = CollectorState::new();

        let mut due = Vec::new();
        for i in 0..5 {
            let raw = registry.poll_all(&mut state, None);
            due.push(raw[0].is_some());
            if i < 4 {
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        }

        assert_eq!(due, vec![true, false, false, false, true]);
    }
}
