use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use sysinfo::{Disks, Networks, System};
use windows::Win32::System::Performance::PdhCloseQuery;

// ── PDH handles ──────────────────────────────────────────────────────────────
// All PDH handles live here. These are raw Win32 isize values (PDH_HQUERY /
// PDH_HCOUNTER). They must be opened once at startup and never recreated —
// PDH rate counters store their baseline inside the handle.

pub struct PdhHandles {
    pub query: Option<isize>,          // PDH_HQUERY — container for all counters
    pub gpu_3d_counter: Option<isize>, // \GPU Engine(*engtype_3D*)\Utilization Percentage
    pub disk_active_counter: Option<isize>, // \PhysicalDisk(*)\% Idle Time
    pub disk_read_counter: Option<isize>, // \PhysicalDisk(*)\Disk Read Bytes/sec
    pub disk_write_counter: Option<isize>, // \PhysicalDisk(*)\Disk Write Bytes/sec
    pub disk_response_counter: Option<isize>, // \PhysicalDisk(*)\Avg. Disk sec/Transfer
}

impl Drop for PdhHandles {
    fn drop(&mut self) {
        if let Some(query) = self.query.take() {
            unsafe {
                PdhCloseQuery(query);
            }
        }
    }
}

// ── RawPoll ──────────────────────────────────────────────────────────────────
// Intermediate result produced by the collector after all I/O completes.
// Passed to the history commit function without holding any lock.

pub struct RawPoll {
    pub cpu_usage: f64,
    pub cpu_temp_c: Option<f64>,
    pub mem_used_gb: f64,
    pub mem_total_gb: f64,
    pub mem_pct: f64,
    pub gpu_updates: Vec<(String, String, f64)>, // (history_key, display_name, util%)
    pub nvidia_temp: Option<f64>,
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
    pub pdh: PdhHandles,
    pub system: System,
    pub sysinfo_disks: Disks,
    pub sysinfo_networks: Networks,
    pub nvapi_initialized: bool,
    pub gpu_error_lock: OnceLock<()>,
    pub cpu_temp_error_lock: OnceLock<()>,
}

impl CollectorState {
    pub fn new() -> Self {
        // PDH init
        let pdh = crate::collector::new_pdh_gpu_query().unwrap_or_else(|| PdhHandles {
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

        CollectorState {
            pdh,
            system,
            sysinfo_disks: disks,
            sysinfo_networks: networks,
            nvapi_initialized,
            gpu_error_lock: OnceLock::new(),
            cpu_temp_error_lock: OnceLock::new(),
        }
    }
}

// ── HistoryStore ─────────────────────────────────────────────────────────────
// Holds only history buffers and latest scalar readings. This is what goes
// behind the Mutex.

pub struct HistoryStore {
    pub cpu_history: VecDeque<f64>,
    pub cpu_name: String,
    pub cpu_temp_c: Option<f64>,
    pub mem_history: VecDeque<f64>,
    pub mem_used_gb: f64,
    pub mem_total_gb: f64,
    pub gpu_entries: Vec<(String, String, VecDeque<f64>)>,
    pub nvidia_temp: Option<f64>,
    pub disk_active_histories: HashMap<String, VecDeque<f64>>,
    pub disk_display_order: Vec<String>,
    pub disk_read_mb_s: HashMap<String, f64>,
    pub disk_write_mb_s: HashMap<String, f64>,
    pub disk_avg_response_ms: HashMap<String, f64>,
    pub net_recv_history: VecDeque<f64>,
    pub net_sent_history: VecDeque<f64>,
}

impl HistoryStore {
    pub fn new(cpu_name: &str) -> Self {
        let name = if cpu_name.is_empty() {
            "CPU".to_string()
        } else {
            cpu_name.to_string()
        };
        HistoryStore {
            cpu_history: VecDeque::with_capacity(3600),
            cpu_name: name,
            cpu_temp_c: None,
            mem_history: VecDeque::with_capacity(3600),
            mem_used_gb: 0.0,
            mem_total_gb: 0.0,
            gpu_entries: Vec::new(),
            nvidia_temp: None,
            disk_active_histories: HashMap::new(),
            disk_display_order: Vec::new(),
            disk_read_mb_s: HashMap::new(),
            disk_write_mb_s: HashMap::new(),
            disk_avg_response_ms: HashMap::new(),
            net_recv_history: VecDeque::with_capacity(3600),
            net_sent_history: VecDeque::with_capacity(3600),
        }
    }
}

pub type SafeHistoryStore = Mutex<HistoryStore>;
pub type SafeAppState = SafeHistoryStore;

// SAFETY: HistoryStore is always accessed through SafeHistoryStore = Mutex<HistoryStore>,
// which provides mutual exclusion.
unsafe impl Send for HistoryStore {}
unsafe impl Sync for HistoryStore {}
