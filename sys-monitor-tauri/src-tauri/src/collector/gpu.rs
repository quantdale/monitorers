use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use windows::Win32::System::Performance::{
    PdhGetFormattedCounterArrayW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE,
};

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

/// Returns true if the GPU display name belongs to an Nvidia GPU
/// that should receive the Nvidia temperature reading.
pub fn is_nvidia_gpu(display_name: &str) -> bool {
    let lower = display_name.to_lowercase();
    lower.contains("geforce")
        || lower.contains("rtx")
        || lower.contains("gtx")
        || lower.contains("nvidia")
}

/// Classify a LUID as iGPU or dGPU.
///
/// Primary: keyword match on vendor caption from Win32_VideoController.
/// LUIDs not in the vendor map fall through to Unknown — no hardcoded fallbacks,
/// since LUIDs are machine-specific and change across reboots.
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
    GpuClass::Unknown
}

// ── WMI GPU VENDOR MAP ───────────────────────────────────────────────────────

/// Build a LUID → vendor-name map by positionally matching:
///   Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine (has LUIDs, no names)
///   Win32_VideoController (has names, no LUIDs)
///
/// `extra_luids`: LUIDs from PDH that may not appear in GPUEngine (e.g. dGPU engines
/// that only show up when a process uses them). These get the last VideoController
/// caption when we have more LUIDs than adapters.
pub fn build_gpu_vendor_map(
    wmi_con: &wmi::WMIConnection,
    extra_luids: impl Iterator<Item = String>,
) -> HashMap<String, String> {
    let luid_rows = match wmi_con.raw_query::<HashMap<String, wmi::Variant>>(
        "SELECT Name FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine",
    ) {
        Ok(r) => r,
        Err(e) => {
            eprintln!(
                "[GPU] build_gpu_vendor_map: LUID enumeration failed: {:?}",
                e
            );
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
    for luid in extra_luids {
        luid_set.insert(luid);
    }
    let mut luids: Vec<String> = luid_set.into_iter().collect();
    luids.sort(); // alphabetical sort mirrors PCI enumeration order

    let vc_rows = match wmi_con
        .raw_query::<HashMap<String, wmi::Variant>>("SELECT Caption FROM Win32_VideoController")
    {
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
    let last_caption = vc_rows
        .last()
        .and_then(|vc| vc.get("Caption"))
        .and_then(|c| match c {
            wmi::Variant::String(s) => Some(s.clone()),
            _ => None,
        })
        .unwrap_or_default();
    for (i, luid) in luids.iter().enumerate() {
        let caption = vc_rows
            .get(i)
            .and_then(|vc| vc.get("Caption"))
            .and_then(|c| match c {
                wmi::Variant::String(s) => Some(s.clone()),
                _ => None,
            })
            .unwrap_or_else(|| last_caption.clone());
        map.insert(luid.clone(), caption);
    }

    if cfg!(debug_assertions) {
        eprintln!("[GPU DEBUG] Vendor map: {:?}", map);
    }
    map
}

// ── GPU PDH UTILIZATION ──────────────────────────────────────────────────────

/// Per-GPU result: (luid, display_name, utilization%).
pub type GpuUtilEntry = (String, String, f64);

/// Read GPU 3D-engine utilization from PDH. Returns list of (history_key, display_name, util%) per GPU.
///
/// PdhCollectQueryData is called once per poll in poll() before this function runs.
/// This function only reads the already-collected data.
///
/// `wmi_con` is the caller's MTA-thread WMI connection used for vendor-name
/// classification. It lives in the background thread's stack frame.
pub fn query_gpu_utilization_pdh(
    pdh: &crate::state::PdhHandles,
    wmi_con: Option<&wmi::WMIConnection>,
    gpu_error_lock: &OnceLock<()>,
) -> Vec<GpuUtilEntry> {
    let mut result = Vec::new();
    if pdh.query.is_none() {
        return result;
    }
    let counter_3d = match pdh.gpu_3d_counter {
        Some(c) => c,
        None => return result,
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
            let luid = match extract_luid_from_name(&name) {
                Some(l) => l,
                None => continue,
            };
            let util = item.FmtValue.Anonymous.doubleValue.clamp(0.0, 100.0);
            *luid_3d_totals.entry(luid.clone()).or_insert(0.0) += util;
        }
    }

    // Build vendor map with PDH LUIDs included so dGPU engines that only appear
    // in PDH (not in GPUEngine WMI) get a caption.
    let vendor_map = match wmi_con {
        Some(con) => build_gpu_vendor_map(con, luid_3d_totals.keys().cloned()),
        None => HashMap::new(),
    };

    // Build list from vendor_map so we include GPUs with 0% util.
    // Merge util by caption — multiple LUIDs (e.g. 0x00017C9F and 0x00017D0F) can
    // map to the same physical GPU; sum their utilization.
    let mut caption_util: HashMap<String, (GpuClass, f64)> = HashMap::new();
    for (luid, caption) in &vendor_map {
        let class = classify_luid(luid, &vendor_map);
        if matches!(class, GpuClass::Unknown) {
            gpu_error_lock.get_or_init(|| {
                eprintln!(
                    "[GPU] LUID {} not matched by vendor keyword — GpuClass::Unknown",
                    luid
                );
            });
            continue;
        }
        let util = luid_3d_totals.get(luid).copied().unwrap_or(0.0).min(100.0);
        let display_name = strip_brand_prefix(caption);
        if display_name.is_empty() {
            continue;
        }
        caption_util
            .entry(display_name)
            .and_modify(|(_, u)| {
                *u = (*u + util).min(100.0);
            })
            .or_insert((class, util));
    }

    let mut entries: Vec<(String, GpuClass, f64)> = caption_util
        .into_iter()
        .map(|(display_name, (class, util))| (display_name, class, util))
        .collect();

    // Sort: iGPU first, then dGPU; within each class by display name.
    entries.sort_by(|a, b| {
        let ord = match (a.1, b.1) {
            (GpuClass::IGpu, GpuClass::DGpu) => std::cmp::Ordering::Less,
            (GpuClass::DGpu, GpuClass::IGpu) => std::cmp::Ordering::Greater,
            _ => std::cmp::Ordering::Equal,
        };
        ord.then_with(|| a.0.cmp(&b.0))
    });

    // For duplicate display names (same model), add " 1", " 2" suffix.
    // Use display_name as stable key for history (merged LUIDs share one history).
    let mut name_counts: HashMap<String, usize> = HashMap::new();
    for (name, _, _) in &entries {
        *name_counts.entry(name.clone()).or_insert(0) += 1;
    }
    let mut name_indices: HashMap<String, usize> = HashMap::new();
    for (display_name, _class, util) in entries {
        let suffix = if *name_counts.get(&display_name).unwrap_or(&0) > 1 {
            let idx = *name_indices.entry(display_name.clone()).or_insert(0);
            name_indices.insert(display_name.clone(), idx + 1);
            format!(" {}", idx + 1)
        } else {
            String::new()
        };
        result.push((
            display_name.clone(),
            format!("{}{}", display_name, suffix),
            util,
        ));
    }

    if cfg!(debug_assertions) {
        eprintln!("[PDH DEBUG] GPUs: {:?}", result);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

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
    fn test_classify_luid_nvidia_by_keyword() {
        let mut map = HashMap::new();
        map.insert(
            "0xABCD1234".to_string(),
            "NVIDIA GeForce RTX 3060".to_string(),
        );
        assert!(matches!(classify_luid("0xABCD1234", &map), GpuClass::DGpu));
    }

    #[test]
    fn test_classify_luid_intel_by_keyword() {
        let mut map = HashMap::new();
        map.insert(
            "0xABCD5678".to_string(),
            "Intel(R) Iris Xe Graphics".to_string(),
        );
        assert!(matches!(classify_luid("0xABCD5678", &map), GpuClass::IGpu));
    }

    #[test]
    fn test_classify_luid_amd_by_keyword() {
        let mut map = HashMap::new();
        map.insert(
            "0xABCDEF00".to_string(),
            "AMD Radeon RX 6700 XT".to_string(),
        );
        assert!(matches!(classify_luid("0xABCDEF00", &map), GpuClass::DGpu));
    }

    #[test]
    fn test_classify_luid_unknown_returns_unknown() {
        let map: HashMap<String, String> = HashMap::new();
        assert!(matches!(
            classify_luid("0xDEADBEEF", &map),
            GpuClass::Unknown
        ));
    }
}
