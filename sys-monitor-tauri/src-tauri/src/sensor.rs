// ── SENSOR PROVIDER TRAIT & REGISTRY ──────────────────────────────────────────
// Per-provider poll intervals; registry schedules providers by elapsed time.

use crate::collector::{self, query_cpu_temp_c, query_gpu_utilization_pdh, query_nvidia_gpu_temp};
use crate::state::{CollectorState, HistoryStore, RawPoll};
use std::time::Instant;

// ── SensorProvider trait ─────────────────────────────────────────────────────

pub trait SensorProvider: Send {
    fn poll(
        &mut self,
        state: &mut CollectorState,
        wmi_con: Option<&wmi::WMIConnection>,
    ) -> RawPoll;

    fn commit(&mut self, store: &mut HistoryStore, raw: &RawPoll);

    /// How often this provider should be polled.
    /// Default: 1000ms (matches current behavior for untagged providers).
    fn poll_interval(&self) -> std::time::Duration {
        std::time::Duration::from_millis(1000)
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
        let cpu_temp_c = query_cpu_temp_c(wmi_con);
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
        collector::commit_cpu(store, raw);
    }

    fn poll_interval(&self) -> std::time::Duration {
        std::time::Duration::from_millis(250)
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
        let _ = collector::collect_pdh(state);
        let gpu_updates =
            query_gpu_utilization_pdh(&state.pdh, wmi_con, &state.gpu_error_lock);
        let nvidia_temp =
            query_nvidia_gpu_temp(state.nvapi_initialized).map(|t| t as f64);
        RawPoll {
            gpu_updates,
            nvidia_temp,
            ..Default::default()
        }
    }

    fn commit(&mut self, store: &mut HistoryStore, raw: &RawPoll) {
        collector::commit_gpu(store, raw);
    }

    fn poll_interval(&self) -> std::time::Duration {
        std::time::Duration::from_millis(250)
    }
}

// ── ProviderEntry & SensorRegistry ─────────────────────────────────────────────

struct ProviderEntry {
    provider: Box<dyn SensorProvider>,
    last_polled: std::time::Instant,
}

pub struct SensorRegistry {
    entries: Vec<ProviderEntry>,
}

impl SensorRegistry {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    pub fn register(&mut self, provider: impl SensorProvider + 'static) {
        let interval = provider.poll_interval();
        self.entries.push(ProviderEntry {
            provider: Box::new(provider),
            last_polled: Instant::now() - interval,
        });
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
                if now.duration_since(entry.last_polled) >= entry.provider.poll_interval() {
                    entry.last_polled = now;
                    Some(entry.provider.poll(state, wmi_con))
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn commit_all(
        &mut self,
        store: &mut HistoryStore,
        raw_polls: &[Option<RawPoll>],
    ) {
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
