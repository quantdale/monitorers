use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use sysinfo::{Disks, Networks, System};

pub use crate::pdh::PdhHandles;

use crate::hardware::HardwareProfile;

// ── RawPoll ──────────────────────────────────────────────────────────────────
// Intermediate result produced by the collector after all I/O completes.
// Passed to the history commit function without holding any lock.

#[derive(Default)]
pub struct RawPoll {
    pub cpu_usage: f64,
    pub cpu_temp_c: Option<f64>,
    pub mem_used_gb: f64,
    pub mem_total_gb: f64,
    pub mem_pct: f64,
    pub gpu_updates: Vec<(String, String, f64)>, // (history_key, display_name, util%)
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
    pub disk_active: HashMap<String, f64>,
    pub disk_read_mb_s: HashMap<String, f64>,
    pub disk_write_mb_s: HashMap<String, f64>,
    pub disk_avg_response_ms: HashMap<String, f64>,
    pub disk_display_order: Vec<String>,
    pub net_recv_kb_s: f64,
    pub net_sent_kb_s: f64,
}

// ── CollectorState ───────────────────────────────────────────────────────────
// Owns all OS handles and sysinfo instances. Lives only on the background
// thread. Never wrapped in a Mutex.

pub struct CollectorState {
    pub profile: HardwareProfile,
    pub pdh: PdhHandles,
    pub system: System,
    pub sysinfo_disks: Disks,
    pub sysinfo_networks: Networks,
    #[cfg_attr(feature = "nvml", allow(dead_code))]
    pub nvapi_initialized: bool,
    pub gpu_error_lock: OnceLock<()>,
    pub cpu_temp_error_lock: OnceLock<()>,
    #[cfg(feature = "nvml")]
    pub nvml: Option<nvml_wrapper::Nvml>,
}

impl CollectorState {
    pub fn new() -> Self {
        // PDH init
        let pdh = crate::collector::new_pdh_gpu_query().unwrap_or_else(|| crate::pdh::PdhHandles {
            query: None,
            gpu_3d_counter: None,
            disk_active_counter: None,
            disk_read_counter: None,
            disk_write_counter: None,
            disk_response_counter: None,
        });

        // sysinfo init — unchanged
        let mut system = System::new_with_specifics(
            sysinfo::RefreshKind::nothing()
                .with_cpu(sysinfo::CpuRefreshKind::everything())
                .with_memory(sysinfo::MemoryRefreshKind::everything()),
        );
        system.refresh_all();
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        system.refresh_all();

        let mut disks = Disks::new_with_refreshed_list();
        disks.refresh(false);

        let mut networks = Networks::new_with_refreshed_list();
        networks.refresh(false);

        // NVAPI must be initialized once per process. Same reason as PDH query handle — stateful C API.
        #[cfg(feature = "nvapi")]
        let nvapi_initialized = {
            let status = unsafe { nvapi_sys::nvapi::NvAPI_Initialize() };
            status == nvapi_sys::status::NVAPI_OK
        };
        #[cfg(not(feature = "nvapi"))]
        let nvapi_initialized = false;

        #[cfg(feature = "nvml")]
        let nvml = crate::collector::nvidia::init_nvml();

        CollectorState {
            profile: crate::hardware::detect(None, None, None),
            pdh,
            system,
            sysinfo_disks: disks,
            sysinfo_networks: networks,
            nvapi_initialized,
            gpu_error_lock: OnceLock::new(),
            cpu_temp_error_lock: OnceLock::new(),
            #[cfg(feature = "nvml")]
            nvml,
        }
    }
}

// ── HistoryStore ─────────────────────────────────────────────────────────────
// Holds only history buffers and latest scalar readings. This is what goes
// behind the Mutex.

const HISTORY_LEN: usize = 3600;

pub struct HistoryStore {
    pub cpu_history: VecDeque<f64>,
    pub cpu_name: String,
    pub cpu_temp_c: Option<f64>,
    pub mem_history: VecDeque<f64>,
    pub mem_used_gb: f64,
    pub mem_total_gb: f64,
    pub gpu_entries: Vec<(String, String, VecDeque<f64>)>,
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
    pub disk_active_histories: HashMap<String, VecDeque<f64>>,
    pub disk_display_order: Vec<String>,
    pub disk_read_mb_s: HashMap<String, f64>,
    pub disk_write_mb_s: HashMap<String, f64>,
    pub disk_avg_response_ms: HashMap<String, f64>,
    pub net_recv_history: VecDeque<f64>,
    pub net_sent_history: VecDeque<f64>,
    pub timestamps: VecDeque<u64>,
    /// Copy of hardware profile for IPC; set by background thread after detect().
    pub profile: Option<HardwareProfile>,
}

impl HistoryStore {
    pub fn new(cpu_name: &str) -> Self {
        let name = if cpu_name.is_empty() {
            "CPU".to_string()
        } else {
            cpu_name.to_string()
        };
        HistoryStore {
            cpu_history: VecDeque::with_capacity(HISTORY_LEN),
            cpu_name: name,
            cpu_temp_c: None,
            mem_history: VecDeque::with_capacity(HISTORY_LEN),
            mem_used_gb: 0.0,
            mem_total_gb: 0.0,
            gpu_entries: Vec::new(),
            nvidia_temp: None,
            #[cfg(feature = "nvml")]
            nvidia_power_w: None,
            #[cfg(feature = "nvml")]
            nvidia_mem_used_mb: None,
            #[cfg(feature = "nvml")]
            nvidia_mem_total_mb: None,
            #[cfg(feature = "nvml")]
            nvidia_fan_speed_pct: None,
            #[cfg(feature = "nvml")]
            nvidia_clock_mhz: None,
            disk_active_histories: HashMap::new(),
            disk_display_order: Vec::new(),
            disk_read_mb_s: HashMap::new(),
            disk_write_mb_s: HashMap::new(),
            disk_avg_response_ms: HashMap::new(),
            net_recv_history: VecDeque::with_capacity(HISTORY_LEN),
            net_sent_history: VecDeque::with_capacity(HISTORY_LEN),
            timestamps: VecDeque::with_capacity(HISTORY_LEN),
            profile: None,
        }
    }

    pub fn push_timestamp(&mut self, ts: u64) {
        if self.timestamps.len() >= HISTORY_LEN {
            self.timestamps.pop_front();
        }
        self.timestamps.push_back(ts);
    }
}

pub type SafeHistoryStore = Mutex<HistoryStore>;
pub type SafeAppState = SafeHistoryStore;

// SAFETY: HistoryStore is always accessed through SafeHistoryStore = Mutex<HistoryStore>,
// which provides mutual exclusion.
unsafe impl Send for HistoryStore {}
unsafe impl Sync for HistoryStore {}
