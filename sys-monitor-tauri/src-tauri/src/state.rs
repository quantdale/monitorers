use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use sysinfo::{Disks, Networks, System};

pub struct AppState {
    pub system: System,
    pub disks: Disks,
    pub networks: Networks,
    pub cpu_name: String,
    pub cpu_temp_c: Option<f64>,
    pub cpu_history: VecDeque<f64>,
    pub mem_history: VecDeque<f64>,
    pub disk_active_histories: HashMap<String, VecDeque<f64>>,
    pub disk_display_order: Vec<String>,
    pub net_recv_history: VecDeque<f64>,
    pub net_sent_history: VecDeque<f64>,
    /// Per-GPU: (luid, display_name, history). LUID is stable key for matching.
    pub gpu_histories: Vec<(String, String, VecDeque<f64>)>,
    pub gpu_error_logged: bool,
    pub gpu_debug: bool,
    // wmi_con is intentionally NOT stored here.
    // WMIConnection has STA COM thread affinity when created on the main thread.
    // The background poll thread creates its own MTA WMIConnection and passes
    // it to collector::refresh_all() directly, keeping COM on the right thread.
    pub pdh_query: Option<isize>,
    pub pdh_gpu_3d_counter: Option<isize>,
    #[allow(dead_code)]
    pub pdh_gpu_video_counter: Option<isize>,
    pub pdh_disk_active_counter: Option<isize>,
    pub pdh_disk_read_counter: Option<isize>,
    pub pdh_disk_write_counter: Option<isize>,
    /// Current read/write MB/s per disk key (no history).
    pub disk_read_mb_s: HashMap<String, f64>,
    pub disk_write_mb_s: HashMap<String, f64>,
}

pub type SafeAppState = Mutex<AppState>;

// SAFETY: AppState is always accessed through SafeAppState = Mutex<AppState>,
// which provides mutual exclusion. sysinfo::System and PDH handles (isize) are
// safe to send across threads under lock protection.
unsafe impl Send for AppState {}
unsafe impl Sync for AppState {}

impl AppState {
    pub fn new() -> Self {
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

        let cpu_name = system
            .cpus()
            .first()
            .map(|c| c.name().to_string())
            .unwrap_or_default();

        let (pdh_query, pdh_gpu_3d_counter, pdh_gpu_video_counter, pdh_disk_active_counter, pdh_disk_read_counter, pdh_disk_write_counter) =
            match crate::collector::new_pdh_gpu_query() {
                Some((q, c3d, cvid, cdisk, cdisk_r, cdisk_w)) => (Some(q), Some(c3d), cvid, cdisk, cdisk_r, cdisk_w),
                None => (None, None, None, None, None, None),
            };

        AppState {
            system,
            cpu_name,
            cpu_temp_c: None,
            cpu_history: VecDeque::with_capacity(3600),
            mem_history: VecDeque::with_capacity(3600),
            disks,
            disk_active_histories: HashMap::new(),
            disk_display_order: Vec::new(),
            networks,
            net_recv_history: VecDeque::with_capacity(3600),
            net_sent_history: VecDeque::with_capacity(3600),
            gpu_histories: Vec::new(),
            gpu_debug: false,
            gpu_error_logged: false,
            pdh_query,
            pdh_gpu_3d_counter,
            pdh_gpu_video_counter,
            pdh_disk_active_counter,
            pdh_disk_read_counter,
            pdh_disk_write_counter,
            disk_read_mb_s: HashMap::new(),
            disk_write_mb_s: HashMap::new(),
        }
    }
}
