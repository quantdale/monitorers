use std::collections::{HashMap, VecDeque};
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCollectQueryData, PdhGetFormattedCounterArrayW, PdhOpenQueryW,
    PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE,
};

// ── PUSH HISTORY HELPER ──────────────────────────────────────────────────────

pub fn push_history(deque: &mut std::collections::VecDeque<f64>, value: f64, max_len: usize) {
    deque.push_back(value);
    if deque.len() > max_len {
        deque.pop_front();
    }
}

// ── PDH INITIALIZATION ───────────────────────────────────────────────────────

/// Open a PDH query and register GPU + disk utilization counters once at startup.
///
/// Returns `Some((query, counter_3d, counter_video_opt, counter_disk_opt))`.
/// Returns `None` if the query or 3D counter cannot be opened.
///
/// The query handle must live for the process lifetime — recreating it resets
/// the baseline and always returns 0%.
pub fn new_pdh_gpu_query() -> Option<(isize, isize, Option<isize>, Option<isize>)> {
    // SAFETY: PDH C API calls via FFI. All pointer arguments are stack variables.
    // Return codes are checked before any output values are read.
    unsafe {
        let mut query: isize = 0;
        if PdhOpenQueryW(None, 0, &mut query) != 0 {
            eprintln!("[PDH] PdhOpenQueryW failed — GPU metrics unavailable.");
            return None;
        }

        let path_3d =
            windows::core::w!(r"\GPU Engine(*engtype_3D*)\Utilization Percentage");
        let mut counter_3d: isize = 0;
        if PdhAddEnglishCounterW(query, path_3d, 0, &mut counter_3d) != 0 {
            eprintln!("[PDH] Failed to add GPU 3D counter — GPU metrics unavailable.");
            return None;
        }

        let path_video = windows::core::w!(
            r"\GPU Engine(*engtype_VideoDecode*)\Utilization Percentage"
        );
        let mut counter_video: isize = 0;
        let counter_video_opt =
            if PdhAddEnglishCounterW(query, path_video, 0, &mut counter_video) == 0 {
                Some(counter_video)
            } else {
                eprintln!("[PDH] VideoDecode counter unavailable — video GPU tracking disabled.");
                None
            };

        // Disk % Idle Time added to the same query as GPU so one
        // PdhCollectQueryData snapshots both domains atomically.
        // active% = 100 - idle%  (inverted in query_disk_active_time).
        let path_disk_active = windows::core::w!(r"\PhysicalDisk(*)\% Idle Time");
        let mut counter_disk_active: isize = 0;
        let counter_disk_opt =
            if PdhAddEnglishCounterW(query, path_disk_active, 0, &mut counter_disk_active) == 0 {
                Some(counter_disk_active)
            } else {
                eprintln!("[PDH] Failed to add disk idle time counter.");
                None
            };

        // First collect — establishes the baseline (value₁). Real readings
        // start on the second poll. The first result is always 0%, by design.
        let _ = PdhCollectQueryData(query);
        eprintln!("[PDH] GPU/disk counters initialized successfully.");
        Some((query, counter_3d, counter_video_opt, counter_disk_opt))
    }
}

// ── GPU CLASSIFICATION ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuClass {
    IGpu,
    DGpu,
    Unknown,
}

/// Extract the low 32-bit LUID hex string from a PDH/WMI GPU engine Name field.
///
/// Name formats:
///   New: `"pid_1234_luid_0x00000000_0x00017D0F_phys_0_eng_0_engtype_3D"`
///   Old: `"luid_0x00000000_0x00017D0F_phys_0_eng_0_engtype_3D"`
///
/// Returns e.g. `"0x00017D0F"` (the second hex segment — low LUID bits).
pub fn extract_luid_from_name(name: &str) -> Option<String> {
    let after_luid = if let Some(pos) = name.find("_luid_") {
        &name[pos + 6..]
    } else if name.starts_with("luid_") {
        &name[5..]
    } else {
        return None;
    };

    let parts: Vec<&str> = after_luid.splitn(3, '_').collect();
    if parts.len() >= 2 && parts[1].starts_with("0x") {
        Some(parts[1].to_string())
    } else {
        None
    }
}

/// Strip brand prefix from GPU caption for display (e.g. "NVIDIA GeForce RTX 4050" → "GeForce RTX 4050").
fn strip_brand_prefix(caption: &str) -> String {
    let c = caption.trim();
    let lower = c.to_lowercase();
    let stripped = if lower.starts_with("nvidia ") {
        c[7..].trim_start()
    } else if lower.starts_with("intel(r) ") {
        c[9..].trim_start()
    } else if lower.starts_with("intel ") {
        c[6..].trim_start()
    } else if lower.starts_with("amd ") {
        c[4..].trim_start()
    } else {
        c
    };
    stripped.to_string()
}

/// Classify a LUID as iGPU or dGPU.
///
/// Primary: keyword match on vendor caption from Win32_VideoController.
/// Fallback: hardcoded LUIDs from the developer's machine.
pub fn classify_luid(luid: &str, vendor_map: &HashMap<String, String>) -> GpuClass {
    if let Some(vendor) = vendor_map.get(luid) {
        let v = vendor.to_lowercase();
        if v.contains("intel") {
            return GpuClass::IGpu;
        }
        if v.contains("nvidia") || v.contains("amd") || v.contains("radeon") {
            return GpuClass::DGpu;
        }
    }

    // Hardcoded fallback LUIDs — machine-specific, serve as safety net.
    match luid {
        "0x00017A19" => GpuClass::IGpu, // Intel iGPU (GDI Render, VideoProcessing)
        "0x00017C9F" => GpuClass::IGpu, // Intel Xe display adapter
        "0x00017D0F" => GpuClass::DGpu, // Nvidia dGPU
        _ => GpuClass::Unknown,
    }
}

// ── WMI GPU VENDOR MAP ───────────────────────────────────────────────────────

/// Build a LUID → vendor-name map by positionally matching:
///   Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine (has LUIDs, no names)
///   Win32_VideoController (has names, no LUIDs)
pub fn build_gpu_vendor_map(
    wmi_con: &wmi::WMIConnection,
    gpu_debug: bool,
) -> HashMap<String, String> {
    use std::collections::HashSet;

    let luid_rows = match wmi_con.raw_query::<HashMap<String, wmi::Variant>>(
        "SELECT Name FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine",
    ) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[GPU] build_gpu_vendor_map: LUID enumeration failed: {:?}", e);
            return HashMap::new();
        }
    };

    let mut luid_set: HashSet<String> = HashSet::new();
    for row in &luid_rows {
        if let Some(wmi::Variant::String(name)) = row.get("Name") {
            if let Some(luid) = extract_luid_from_name(name) {
                luid_set.insert(luid);
            }
        }
    }
    let mut luids: Vec<String> = luid_set.into_iter().collect();
    luids.sort(); // alphabetical sort mirrors PCI enumeration order

    let vc_rows = match wmi_con.raw_query::<HashMap<String, wmi::Variant>>(
        "SELECT Caption FROM Win32_VideoController",
    ) {
        Ok(r) => r,
        Err(e) => {
            eprintln!(
                "[GPU] build_gpu_vendor_map: VideoController query failed: {:?}",
                e
            );
            return HashMap::new();
        }
    };

    let mut map: HashMap<String, String> = HashMap::new();
    for (i, luid) in luids.iter().enumerate() {
        if let Some(vc) = vc_rows.get(i) {
            let caption = match vc.get("Caption") {
                Some(wmi::Variant::String(s)) => s.clone(),
                _ => String::new(),
            };
            map.insert(luid.clone(), caption);
        }
    }

    if gpu_debug {
        eprintln!("[GPU DEBUG] Vendor map: {:?}", map);
    }
    map
}

/// Query live GPU engine utilization from WMI GPUPerformanceCounters.
/// Preserved as dead_code — PDH is the primary GPU source.
#[allow(dead_code)]
pub fn query_gpu_perf_counters(
    wmi_con: &wmi::WMIConnection,
    gpu_debug: bool,
    gpu_error_logged: &mut bool,
) -> (Vec<(String, f64)>, Vec<(String, f64)>) {
    let query = "SELECT Name, UtilizationPercentage \
                 FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine";

    let rows = match wmi_con.raw_query::<HashMap<String, wmi::Variant>>(query) {
        Ok(r) => r,
        Err(e) => {
            if !*gpu_error_logged {
                eprintln!("[GPU] WMI query failed: {:?}", e);
                eprintln!(
                    "[GPU] GPUPerformanceCounters class not found. \
                     GPU drivers may not expose WMI performance counters \
                     (virtual machine, old driver, or WDDM < 2.0)."
                );
                *gpu_error_logged = true;
            }
            return (vec![], vec![]);
        }
    };

    if rows.is_empty() {
        if !*gpu_error_logged {
            eprintln!("[GPU] WMI query returned no results.");
            *gpu_error_logged = true;
        }
        return (vec![], vec![]);
    }

    let mut luid_3d_totals: HashMap<String, f64> = HashMap::new();
    let mut luid_video_totals: HashMap<String, f64> = HashMap::new();

    for row in &rows {
        if gpu_debug {
            eprintln!("[GPU DEBUG] Row: {:?}", row);
        }

        let name = match row.get("Name") {
            Some(wmi::Variant::String(s)) => s.clone(),
            _ => continue,
        };

        let is_3d = name.contains("engtype_3D");
        let is_video = name.contains("engtype_VideoDecode");
        if !is_3d && !is_video {
            continue;
        }

        let luid = match extract_luid_from_name(&name) {
            Some(l) => l,
            None => continue,
        };

        let util: f64 = match row.get("UtilizationPercentage") {
            Some(wmi::Variant::UI4(n)) => *n as f64,
            Some(wmi::Variant::UI8(n)) => *n as f64,
            Some(wmi::Variant::I4(n)) => *n as f64,
            Some(wmi::Variant::I8(n)) => *n as f64,
            Some(wmi::Variant::R8(n)) => *n,
            Some(wmi::Variant::R4(n)) => *n as f64,
            Some(wmi::Variant::String(s)) => s.parse::<f64>().unwrap_or(0.0),
            _ => 0.0,
        };

        if is_3d {
            *luid_3d_totals.entry(luid).or_insert(0.0) += util;
        } else {
            *luid_video_totals.entry(luid).or_insert(0.0) += util;
        }
    }

    let capped_3d: Vec<(String, f64)> = luid_3d_totals
        .into_iter()
        .map(|(luid, total)| (luid, total.min(100.0)))
        .collect();

    let capped_video: Vec<(String, f64)> = luid_video_totals
        .into_iter()
        .map(|(luid, total)| (luid, total.min(100.0)))
        .collect();

    if gpu_debug {
        eprintln!("[GPU DEBUG] 3D totals (summed, capped): {:?}", capped_3d);
        eprintln!("[GPU DEBUG] Video totals (summed, capped): {:?}", capped_video);
    }

    (capped_3d, capped_video)
}

// ── GPU PDH UTILIZATION ──────────────────────────────────────────────────────

/// Per-GPU result: (luid, display_name, utilization%).
pub type GpuUtilEntry = (String, String, f64);

/// Read GPU 3D-engine utilization from PDH. Returns list of (luid, display_name, util%) per GPU.
///
/// PdhCollectQueryData is called once per poll in refresh_all() before this
/// function runs. This function only reads the already-collected data.
///
/// `wmi_con` is the caller's MTA-thread WMI connection used for vendor-name
/// classification. It lives in the background thread's stack frame, not in AppState,
/// to avoid STA/MTA COM thread-affinity violations.
pub fn query_gpu_utilization_pdh(
    app: &mut crate::state::AppState,
    wmi_con: Option<&wmi::WMIConnection>,
) -> Vec<GpuUtilEntry> {
    let mut result = Vec::new();
    if app.pdh_query.is_none() {
        return result;
    }
    let counter_3d = match app.pdh_gpu_3d_counter {
        Some(c) => c,
        None => return result,
    };

    let vendor_map = match wmi_con {
        Some(con) => build_gpu_vendor_map(con, app.gpu_debug),
        None => HashMap::new(),
    };

    let mut luid_3d_totals: HashMap<String, f64> = HashMap::new();

    // SAFETY: PDH API calls. All mutable pointers point to stack variables or
    // heap allocations with sufficient lifetime. Return codes checked before reads.
    // szName pointers inside PDH_FMT_COUNTERVALUE_ITEM_W point into `backing`,
    // which is alive for the duration of this unsafe block.
    unsafe {
        let mut buf_size: u32 = 0;
        let mut item_count: u32 = 0;

        let _ = PdhGetFormattedCounterArrayW(
            counter_3d,
            PDH_FMT_DOUBLE,
            &mut buf_size,
            &mut item_count,
            None,
        );

        if item_count == 0 {
            return result;
        }

        let u64_count = (buf_size as usize * 3 + 7) / 8;
        let mut backing: Vec<u64> = vec![0u64; u64_count];
        let mut actual_buf_size: u32 = (u64_count * 8) as u32;
        let buf_ptr = backing.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;

        let status = PdhGetFormattedCounterArrayW(
            counter_3d,
            PDH_FMT_DOUBLE,
            &mut actual_buf_size,
            &mut item_count,
            Some(buf_ptr),
        );

        if status != 0 {
            return result;
        }

        for i in 0..item_count as usize {
            let item: &PDH_FMT_COUNTERVALUE_ITEM_W = &*buf_ptr.add(i);
            if item.FmtValue.CStatus > 1 {
                continue;
            }
            let name = match item.szName.to_string() {
                Ok(s) => s,
                Err(_) => continue,
            };
            if app.gpu_debug {
                eprintln!("[PDH DEBUG] instance: {}", name);
            }
            let luid = match extract_luid_from_name(&name) {
                Some(l) => l,
                None => continue,
            };
            let util = item.FmtValue.Anonymous.doubleValue.clamp(0.0, 100.0);
            *luid_3d_totals.entry(luid).or_insert(0.0) += util;
        }
    }

    // Build list from vendor_map so we include GPUs with 0% util.
    let mut entries: Vec<(String, String, f64)> = Vec::new();
    for (luid, caption) in &vendor_map {
        let class = classify_luid(luid, &vendor_map);
        if matches!(class, GpuClass::Unknown) {
            if !app.gpu_error_logged {
                eprintln!("[PDH] Unclassified LUID: {}", luid);
            }
            continue;
        }
        let util = luid_3d_totals.get(luid).copied().unwrap_or(0.0).min(100.0);
        let display_name = strip_brand_prefix(caption);
        if display_name.is_empty() {
            continue;
        }
        entries.push((luid.clone(), display_name, util));
    }

    // Sort: iGPU first, then dGPU; within each class by LUID.
    entries.sort_by(|a, b| {
        let class_a = classify_luid(&a.0, &vendor_map);
        let class_b = classify_luid(&b.0, &vendor_map);
        let ord = match (class_a, class_b) {
            (GpuClass::IGpu, GpuClass::DGpu) => std::cmp::Ordering::Less,
            (GpuClass::DGpu, GpuClass::IGpu) => std::cmp::Ordering::Greater,
            _ => std::cmp::Ordering::Equal,
        };
        ord.then_with(|| a.0.cmp(&b.0))
    });

    // For duplicate display names (same model), add " 1", " 2" suffix.
    let mut name_counts: HashMap<String, usize> = HashMap::new();
    for (_, name, _) in &entries {
        *name_counts.entry(name.clone()).or_insert(0) += 1;
    }
    let mut name_indices: HashMap<String, usize> = HashMap::new();
    for (luid, display_name, util) in entries {
        let suffix = if *name_counts.get(&display_name).unwrap_or(&0) > 1 {
            let idx = *name_indices.entry(display_name.clone()).or_insert(0);
            name_indices.insert(display_name.clone(), idx + 1);
            format!(" {}", idx + 1)
        } else {
            String::new()
        };
        result.push((luid, format!("{}{}", display_name, suffix), util));
    }

    if app.gpu_debug {
        eprintln!("[PDH DEBUG] GPUs: {:?}", result);
    }

    result
}

// ── DISK HELPERS ─────────────────────────────────────────────────────────────

/// Parse a PDH PhysicalDisk instance name like "0 C: D:" into drive letters ["C:", "D:"].
pub fn pdh_instance_to_drive_letters(instance: &str) -> Vec<String> {
    instance
        .split_whitespace()
        .skip(1) // skip the leading disk index token (e.g. "0")
        .filter(|token| token.ends_with(':'))
        .map(|token| token.to_uppercase())
        .collect()
}

/// Read \PhysicalDisk(*)\% Idle Time values and invert to active-time %.
/// active% = 100 - idle%  — same value Task Manager's disk graph displays.
pub fn query_disk_active_time(
    app: &mut crate::state::AppState,
) -> HashMap<String, f64> {
    let counter = match app.pdh_disk_active_counter {
        Some(c) => c,
        None => return HashMap::new(),
    };

    // SAFETY: PDH API calls with valid handles and stack-owned output pointers.
    unsafe {
        let mut buffer_size: u32 = 0;
        let mut item_count: u32 = 0;

        let _ = PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE,
            &mut buffer_size,
            &mut item_count,
            None,
        );

        if buffer_size == 0 || item_count == 0 {
            return HashMap::new();
        }

        let u64_count = (buffer_size as usize * 3 + 7) / 8;
        let mut backing: Vec<u64> = vec![0u64; u64_count];
        let mut actual_buf_size: u32 = (u64_count * 8) as u32;
        let buf_ptr = backing.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;

        let status = PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE,
            &mut actual_buf_size,
            &mut item_count,
            Some(buf_ptr),
        );

        if status != 0 {
            return HashMap::new();
        }

        let mut result = HashMap::new();
        for i in 0..item_count as usize {
            let item: &PDH_FMT_COUNTERVALUE_ITEM_W = &*buf_ptr.add(i);

            if item.FmtValue.CStatus > 1 {
                continue;
            }

            let name = item.szName.to_string().unwrap_or_default();

            // _Total is the aggregate — skip it, we render per-disk cards.
            if name == "_Total" {
                continue;
            }

            // Invert idle% → active%. Clamp handles out-of-range values near startup.
            let value = (100.0 - item.FmtValue.Anonymous.doubleValue).clamp(0.0, 100.0);
            result.insert(name, value);
        }

        result
    }
}

pub fn refresh_disk(app: &mut crate::state::AppState) {
    app.disks.refresh(false);

    let mut known_drive_letters: HashMap<String, String> = HashMap::new();
    for disk in app.disks.list() {
        let mount = disk.mount_point().to_string_lossy().to_string();
        let mount_upper = mount.to_uppercase();
        if mount_upper.len() >= 2 && mount_upper.as_bytes()[1] == b':' {
            known_drive_letters.insert(mount_upper[..2].to_string(), mount);
        }
    }

    for (instance_name, pct_active) in query_disk_active_time(app) {
        let mapped_letters: Vec<String> = pdh_instance_to_drive_letters(&instance_name)
            .into_iter()
            .filter(|letter| known_drive_letters.contains_key(letter))
            .collect();

        if mapped_letters.is_empty() {
            continue;
        }

        let disk_key = mapped_letters.join(" ");
        if !app.disk_active_histories.contains_key(&disk_key) {
            app.disk_display_order.push(disk_key.clone());
            app.disk_active_histories
                .insert(disk_key.clone(), std::collections::VecDeque::with_capacity(3600));
        }

        if let Some(history) = app.disk_active_histories.get_mut(&disk_key) {
            push_history(history, pct_active, 3600);
        }
    }
}

// ── CPU / MEMORY / NETWORK REFRESH ──────────────────────────────────────────

pub fn refresh_cpu(app: &mut crate::state::AppState) {
    app.system.refresh_cpu_usage();
    let cpu_pct = app.system.global_cpu_usage() as f64;
    app.cpu_history.push_back(cpu_pct);
    if app.cpu_history.len() > 3600 {
        app.cpu_history.pop_front();
    }
}

pub fn refresh_memory(app: &mut crate::state::AppState) {
    app.system.refresh_memory();
    let used_mem = app.system.used_memory();
    let total_mem = app.system.total_memory();
    let mem_pct = if total_mem > 0 {
        (used_mem as f64 / total_mem as f64) * 100.0
    } else {
        0.0
    };
    app.mem_history.push_back(mem_pct);
    if app.mem_history.len() > 3600 {
        app.mem_history.pop_front();
    }
}

pub fn refresh_network(app: &mut crate::state::AppState) {
    app.networks.refresh(false);

    let mut total_recv_bytes = 0u64;
    let mut total_sent_bytes = 0u64;
    for (iface_name, data) in &app.networks {
        let name_upper = iface_name.to_uppercase();
        if name_upper.contains("LOOPBACK") || name_upper == "LO" {
            continue;
        }
        total_recv_bytes += data.received();
        total_sent_bytes += data.transmitted();
    }

    let recv_kbs = total_recv_bytes as f64 / 1024.0;
    let sent_kbs = total_sent_bytes as f64 / 1024.0;
    push_history(&mut app.net_recv_history, recv_kbs, 3600);
    push_history(&mut app.net_sent_history, sent_kbs, 3600);
}

// ── MAIN POLL FUNCTION ───────────────────────────────────────────────────────

/// Run one full 1-second poll: refresh all metrics and push to history deques.
///
/// `wmi_con` is the background thread's MTA WMI connection (lives in the thread's
/// stack frame). Passing it explicitly avoids storing a COM object in AppState,
/// which would cause RPC_E_WRONG_THREAD if called across thread apartments.
///
/// PdhCollectQueryData is called exactly once here per poll cycle, atomically
/// snapshotting both GPU and disk PDH counters from the same baseline.
pub fn refresh_all(
    app: &mut crate::state::AppState,
    wmi_con: Option<&wmi::WMIConnection>,
) {
    refresh_cpu(app);
    refresh_memory(app);
    refresh_network(app);

    // Single PdhCollectQueryData call covers both GPU and disk counters.
    let pdh_collected_ok = match app.pdh_query {
        Some(query) => unsafe { PdhCollectQueryData(query) == 0 },
        None => false,
    };

    if pdh_collected_ok {
        refresh_disk(app);
    }

    let gpu_list = query_gpu_utilization_pdh(app, wmi_con);
    let mut existing: HashMap<String, VecDeque<f64>> = app
        .gpu_histories
        .drain(..)
        .map(|(luid, _, hist)| (luid, hist))
        .collect();
    app.gpu_histories = gpu_list
        .into_iter()
        .map(|(luid, display_name, util)| {
            let mut hist = existing.remove(&luid).unwrap_or_else(|| VecDeque::with_capacity(3600));
            push_history(&mut hist, util, 3600);
            (luid, display_name, hist)
        })
        .collect();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, VecDeque};

    // --- extract_luid_from_name ---

    #[test]
    fn test_extract_luid_pid_prefix() {
        let input = "pid_1234_luid_0x00000000_0x00017D0F_phys_0_eng_0_engtype_3D";
        assert_eq!(
            extract_luid_from_name(input),
            Some("0x00017D0F".to_string())
        );
    }

    #[test]
    fn test_extract_luid_legacy_prefix() {
        let input = "luid_0x00000000_0x00017A19_phys_0_eng_0_engtype_3D";
        assert_eq!(
            extract_luid_from_name(input),
            Some("0x00017A19".to_string())
        );
    }

    #[test]
    fn test_extract_luid_total_returns_none() {
        assert_eq!(extract_luid_from_name("_Total"), None);
    }

    #[test]
    fn test_extract_luid_empty_returns_none() {
        assert_eq!(extract_luid_from_name(""), None);
    }

    #[test]
    fn test_extract_luid_malformed_returns_none() {
        assert_eq!(extract_luid_from_name("pid_99_luid_notahex"), None);
    }

    // --- pdh_instance_to_drive_letters ---

    #[test]
    fn test_pdh_instance_single_drive() {
        assert_eq!(pdh_instance_to_drive_letters("0 C:"), vec!["C:"]);
    }

    #[test]
    fn test_pdh_instance_two_drives() {
        assert_eq!(
            pdh_instance_to_drive_letters("0 C: D:"),
            vec!["C:", "D:"]
        );
    }

    #[test]
    fn test_pdh_instance_disk_only_no_letters() {
        assert_eq!(pdh_instance_to_drive_letters("1"), vec![] as Vec<String>);
    }

    #[test]
    fn test_pdh_instance_total_empty() {
        assert_eq!(pdh_instance_to_drive_letters("_Total"), vec![] as Vec<String>);
    }

    #[test]
    fn test_pdh_instance_whitespace_resilience() {
        assert_eq!(pdh_instance_to_drive_letters("  0 C:  "), vec!["C:"]);
    }

    // --- classify_luid ---

    #[test]
    fn test_classify_luid_intel_igpu() {
        let mut map = HashMap::new();
        map.insert(
            "0x00017A19".to_string(),
            "Intel(R) Iris Xe Graphics".to_string(),
        );
        assert_eq!(classify_luid("0x00017A19", &map), GpuClass::IGpu);
    }

    #[test]
    fn test_classify_luid_nvidia_dgpu() {
        let mut map = HashMap::new();
        map.insert(
            "0x00017D0F".to_string(),
            "NVIDIA GeForce RTX 3060".to_string(),
        );
        assert_eq!(classify_luid("0x00017D0F", &map), GpuClass::DGpu);
    }

    #[test]
    fn test_classify_luid_amd_dgpu() {
        let mut map = HashMap::new();
        map.insert("0x00017E00".to_string(), "AMD Radeon RX 6700".to_string());
        assert_eq!(classify_luid("0x00017E00", &map), GpuClass::DGpu);
    }

    #[test]
    fn test_classify_luid_fallback_igpu() {
        let map: HashMap<String, String> = HashMap::new();
        assert_eq!(classify_luid("0x00017A19", &map), GpuClass::IGpu);
    }

    #[test]
    fn test_classify_luid_fallback_dgpu() {
        let map: HashMap<String, String> = HashMap::new();
        assert_eq!(classify_luid("0x00017D0F", &map), GpuClass::DGpu);
    }

    #[test]
    fn test_classify_luid_unknown() {
        let map: HashMap<String, String> = HashMap::new();
        assert_eq!(classify_luid("0xDEADBEEF", &map), GpuClass::Unknown);
    }

    // --- push_history ---

    #[test]
    fn test_push_history_under_capacity() {
        let mut d: VecDeque<f64> = [1.0, 2.0].into();
        push_history(&mut d, 3.0, 5);
        assert_eq!(d.into_iter().collect::<Vec<_>>(), vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn test_push_history_at_capacity_drops_oldest() {
        let mut d: VecDeque<f64> = [1.0, 2.0, 3.0].into();
        push_history(&mut d, 4.0, 3);
        assert_eq!(d.into_iter().collect::<Vec<_>>(), vec![2.0, 3.0, 4.0]);
    }

    #[test]
    fn test_push_history_empty() {
        let mut d: VecDeque<f64> = VecDeque::new();
        push_history(&mut d, 42.0, 3);
        assert_eq!(d.into_iter().collect::<Vec<_>>(), vec![42.0]);
    }

    #[test]
    fn test_push_history_max_len_one() {
        let mut d: VecDeque<f64> = [99.0].into();
        push_history(&mut d, 7.0, 1);
        assert_eq!(d.into_iter().collect::<Vec<_>>(), vec![7.0]);
    }
}
