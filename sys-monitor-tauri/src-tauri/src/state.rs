use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use sysinfo::{Disks, Networks, System};

// ── CPU ──────────────────────────────────────────────────────────────────────

pub struct CpuState {
    pub system: System,              // sysinfo handle for CPU usage + memory
    pub name: String,                // brand string from sysinfo cpus()[0].brand()
    pub temp_c: Option<f64>,         // latest °C from WMI ThermalZoneInformation
    pub history: VecDeque<f64>,      // % utilization history, max 3600 points
    pub temp_error_logged: bool,     // one-shot stderr flag for missing CPU temp
}

// ── Memory ───────────────────────────────────────────────────────────────────

pub struct MemoryState {
    pub history: VecDeque<f64>,      // % utilization history, max 3600 points
    // Note: sysinfo System handle lives on CpuState — memory is read from the
    // same System instance via system.used_memory() / system.total_memory()
}

// ── GPU ──────────────────────────────────────────────────────────────────────

pub struct GpuState {
    // Each entry: (luid, display_name, utilization % history)
    // Populated dynamically from PDH GPU engine instances
    pub entries: Vec<(String, String, VecDeque<f64>)>,

    pub nvidia_temp: Option<f64>,          // Nvidia GPU core temp °C, None when unavailable
    pub nvapi_initialized: bool,            // NVAPI init success flag
    pub error_logged: bool,                 // one-shot stderr flag for LUID mismatch
    pub debug: bool,                        // extra PDH/GPU stderr when true (false at startup)
}

// ── Disk ─────────────────────────────────────────────────────────────────────

pub struct DiskState {
    pub sysinfo_disks: Disks,                          // mount-point metadata only
    pub active_histories: HashMap<String, VecDeque<f64>>, // active % per disk key
    pub display_order: Vec<String>,                    // stable card order
    pub read_mb_s: HashMap<String, f64>,               // latest read MB/s per disk
    pub write_mb_s: HashMap<String, f64>,             // latest write MB/s per disk
    pub avg_response_ms: HashMap<String, f64>,         // latest avg response ms per disk
}

// ── Network ──────────────────────────────────────────────────────────────────

pub struct NetworkState {
    pub sysinfo_networks: Networks,       // sysinfo network interfaces handle
    pub recv_history: VecDeque<f64>,      // download KB/s history, max 3600
    pub sent_history: VecDeque<f64>,      // upload KB/s history, max 3600
}

// ── PDH handles ──────────────────────────────────────────────────────────────
// All PDH handles live here. These are raw Win32 isize values (PDH_HQUERY /
// PDH_HCOUNTER). They must be opened once at startup and never recreated —
// PDH rate counters store their baseline inside the handle.

pub struct PdhHandles {
    pub query: Option<isize>,                  // PDH_HQUERY — container for all counters
    pub gpu_3d_counter: Option<isize>,         // \GPU Engine(*engtype_3D*)\Utilization Percentage
    #[allow(dead_code)]
    pub gpu_video_counter: Option<isize>,      // \GPU Engine(*engtype_VideoDecode*)\Utilization Percentage (dead_code)
    pub disk_active_counter: Option<isize>,    // \PhysicalDisk(*)\% Idle Time
    pub disk_read_counter: Option<isize>,      // \PhysicalDisk(*)\Disk Read Bytes/sec
    pub disk_write_counter: Option<isize>,     // \PhysicalDisk(*)\Disk Write Bytes/sec
    pub disk_response_counter: Option<isize>,  // \PhysicalDisk(*)\Avg. Disk sec/Transfer
}

// ── Root ─────────────────────────────────────────────────────────────────────

pub struct AppState {
    pub cpu: CpuState,
    pub mem: MemoryState,
    pub gpu: GpuState,
    pub disk: DiskState,
    pub network: NetworkState,
    pub pdh: PdhHandles,
}

pub type SafeAppState = Mutex<AppState>;

// SAFETY: AppState is always accessed through SafeAppState = Mutex<AppState>,
// which provides mutual exclusion. sysinfo::System and PDH handles (isize) are
// safe to send across threads under lock protection.
unsafe impl Send for AppState {}
unsafe impl Sync for AppState {}

impl AppState {
    pub fn new() -> Self {
        // PDH init — unchanged
        let pdh = match crate::collector::new_pdh_gpu_query() {
            Some((query, gpu_3d, gpu_video, disk_active, disk_read, disk_write, disk_response)) => {
                PdhHandles {
                    query: Some(query),
                    gpu_3d_counter: Some(gpu_3d),
                    gpu_video_counter: gpu_video,
                    disk_active_counter: disk_active,
                    disk_read_counter: disk_read,
                    disk_write_counter: disk_write,
                    disk_response_counter: disk_response,
                }
            }
            None => PdhHandles {
                query: None,
                gpu_3d_counter: None,
                gpu_video_counter: None,
                disk_active_counter: None,
                disk_read_counter: None,
                disk_write_counter: None,
                disk_response_counter: None,
            },
        };

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

        // sysinfo populates brand on per-core entries via CPUID; the global entry is synthetic.
        // CPU model never changes at runtime, so we read once at startup.
        let raw = system
            .cpus()
            .first()
            .map(|c| c.brand().to_string())
            .unwrap_or_default();
        let cpu_name = if raw.is_empty() {
            "CPU".to_string()
        } else {
            raw
        };

        // NVAPI must be initialized once per process. Same reason as PDH query handle — stateful C API.
        #[cfg(feature = "nvapi")]
        let nvapi_initialized = {
            let status = unsafe { nvapi_sys::nvapi::NvAPI_Initialize() };
            status == nvapi_sys::status::NVAPI_OK
        };
        #[cfg(not(feature = "nvapi"))]
        let nvapi_initialized = false;

        AppState {
            cpu: CpuState {
                system,
                name: cpu_name,
                temp_c: None,
                history: VecDeque::with_capacity(3600),
                temp_error_logged: false,
            },
            mem: MemoryState {
                history: VecDeque::with_capacity(3600),
            },
            gpu: GpuState {
                entries: Vec::new(),
                nvidia_temp: None,
                nvapi_initialized,
                error_logged: false,
                debug: false,
            },
            disk: DiskState {
                sysinfo_disks: disks,
                active_histories: HashMap::new(),
                display_order: Vec::new(),
                read_mb_s: HashMap::new(),
                write_mb_s: HashMap::new(),
                avg_response_ms: HashMap::new(),
            },
            network: NetworkState {
                sysinfo_networks: networks,
                recv_history: VecDeque::with_capacity(3600),
                sent_history: VecDeque::with_capacity(3600),
            },
            pdh,
        }
    }
}
