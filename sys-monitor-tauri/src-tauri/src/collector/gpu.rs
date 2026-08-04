use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

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
    } else if let Some(stripped) = name.strip_prefix("luid_") {
        stripped
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
///
/// Called on the post-strip_brand_prefix display name, so the "nvidia" keyword
/// rarely appears — this must also recognize professional-line model names
/// (Quadro, Tesla, NVS) that lack a consumer keyword like GeForce/RTX/GTX.
pub fn is_nvidia_gpu(display_name: &str) -> bool {
    let lower = display_name.to_lowercase();
    lower.contains("geforce")
        || lower.contains("rtx")
        || lower.contains("gtx")
        || lower.contains("nvidia")
        || lower.contains("quadro")
        || lower.contains("tesla")
        || lower.contains("nvs")
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

/// Deterministically assign a VideoController caption to every known LUID.
///
/// Win32_VideoController exposes no LUID, so there is no true foreign key to
/// pair adapters with engine LUIDs; the correspondence must be inferred. LUIDs
/// are sorted in a stable order and matched positionally against the caption
/// list (which WMI returns in PCI-enumeration order). Unlike fragile index
/// tricks, this function derives a caption for *every* known LUID in a single
/// pass: LUIDs beyond the caption count (e.g. dGPU engines that only surface
/// via PDH) inherit the last caption, so the same inputs always yield the same
/// map and an extra LUID can never leave a known engine without a caption or
/// silently shift captions between engines. The match is deterministic per
/// input; it is not a true foreign-key join, which Windows does not expose.
fn assign_captions_to_luids(luids: &mut [String], captions: &[String]) -> HashMap<String, String> {
    luids.sort();
    let last_caption = captions.last().cloned().unwrap_or_default();
    luids
        .iter()
        .enumerate()
        .map(|(i, luid)| {
            let caption = captions
                .get(i)
                .cloned()
                .unwrap_or_else(|| last_caption.clone());
            (luid.clone(), caption)
        })
        .collect()
}

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
    let captions: Vec<String> = vc_rows
        .iter()
        .filter_map(|vc| match vc.get("Caption") {
            Some(wmi::Variant::String(s)) => Some(s.clone()),
            _ => None,
        })
        .collect();

    let map = assign_captions_to_luids(&mut luids, &captions);

    if cfg!(debug_assertions) {
        eprintln!("[GPU DEBUG] Vendor map: {:?}", map);
    }
    map
}

// ── GPU PDH UTILIZATION ──────────────────────────────────────────────────────

/// Per-GPU result: (luid, display_name, utilization%).
pub type GpuUtilEntry = (String, String, f64);

/// How often a stale/outdated vendor map may be rebuilt via WMI. The map is
/// built once per session; this rate limit only applies to self-healing
/// rebuilds (new LUIDs appearing, or a failed first enumeration), so a WMI
/// outage can't turn the collector into a per-tick WMI query loop.
const VENDOR_MAP_REBUILD_INTERVAL: std::time::Duration = std::time::Duration::from_secs(10);

/// Whether the cached LUID→caption map needs rebuilding from WMI.
///
/// - `None` (never built) → rebuild immediately.
/// - Empty map (a prior enumeration failed) → rebuild, but at most once per
///   `VENDOR_MAP_REBUILD_INTERVAL` so a persistent WMI failure can't hot-loop.
/// - Non-empty map → rebuild only when a PDH-reported LUID is missing
///   (hot-plug / late-appearing dGPU engine), also rate-limited.
pub fn should_rebuild_vendor_map(
    cache: &Option<HashMap<String, String>>,
    last_build: std::time::Instant,
    pdh_luids: &[String],
) -> bool {
    let Some(map) = cache else {
        return true;
    };
    if map.is_empty() {
        return last_build.elapsed() >= VENDOR_MAP_REBUILD_INTERVAL;
    }
    if last_build.elapsed() < VENDOR_MAP_REBUILD_INTERVAL {
        return false;
    }
    pdh_luids.iter().any(|l| !map.contains_key(l))
}

/// Merge per-LUID utilization totals into per-caption entries.
///
/// Known characterization gap: multiple LUIDs that classify to the same
/// brand-stripped display name (e.g. two identical dGPUs) are folded into a
/// single entry with summed utilization, capped at 100%. This means two
/// physically distinct same-model GPUs are indistinguishable in the UI today
/// — see design.md Known Gaps in
/// openspec/changes/add-realistic-usage-test-suite for the recommended fix
/// (disambiguate by LUID instead of display name alone). This function pins
/// today's actual behavior; it is not a requirement.
fn merge_gpu_utilization_by_caption(
    vendor_map: Option<&HashMap<String, String>>,
    luid_3d_totals: &HashMap<String, f64>,
    gpu_error_lock: &OnceLock<()>,
) -> Vec<(String, GpuClass, f64)> {
    // Build list from vendor_map so we include GPUs with 0% util.
    // Merge util by caption — multiple LUIDs (e.g. 0x00017C9F and 0x00017D0F) can
    // map to the same physical GPU; sum their utilization.
    let Some(vendor_map) = vendor_map else {
        return Vec::new();
    };
    let mut caption_util: HashMap<String, (GpuClass, f64)> = HashMap::new();
    for (luid, caption) in vendor_map {
        let class = classify_luid(luid, vendor_map);
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

    caption_util
        .into_iter()
        .map(|(display_name, (class, util))| (display_name, class, util))
        .collect()
}

/// Read GPU 3D-engine utilization from PDH. Returns list of (history_key, display_name, util%) per GPU.
///
/// PdhCollectQueryData is called once per poll in poll() before this function runs.
/// This function only reads the already-collected data.
///
/// `wmi_con` is the caller's MTA-thread WMI connection used for vendor-name
/// classification. It lives in the background thread's stack frame.
///
/// `gpu_vendor_map` / `vendor_map_last_build` cache the LUID→caption map across
/// polls. Building it runs two WMI queries, so it must happen once, not on
/// every ~250ms GPU poll (the pre-cache behavior made the collector spend most
/// of each tick inside WMI — see should_rebuild_vendor_map).
pub fn query_gpu_utilization_pdh(
    pdh: &crate::state::PdhHandles,
    wmi_con: Option<&wmi::WMIConnection>,
    gpu_error_lock: &OnceLock<()>,
    gpu_vendor_map: &mut Option<HashMap<String, String>>,
    vendor_map_last_build: &mut std::time::Instant,
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

    for (name, util) in crate::pdh::read_pdh_counter_array(counter_3d) {
        let luid = match extract_luid_from_name(&name) {
            Some(l) => l,
            None => continue,
        };
        let util = util.clamp(0.0_f64, 100.0);
        *luid_3d_totals.entry(luid).or_insert(0.0) += util;
    }

    // Build (or refresh) the vendor map with PDH LUIDs included so dGPU
    // engines that only appear in PDH (not in GPUEngine WMI) get a caption.
    // Cached across polls: WMI enumeration is expensive (~2 queries per call)
    // and the hardware only changes on hot-plug.
    if let Some(con) = wmi_con {
        let pdh_luids: Vec<String> = luid_3d_totals.keys().cloned().collect();
        if should_rebuild_vendor_map(gpu_vendor_map, *vendor_map_last_build, &pdh_luids) {
            let rebuilt = build_gpu_vendor_map(con, pdh_luids.into_iter());
            *gpu_vendor_map = Some(rebuilt);
            *vendor_map_last_build = std::time::Instant::now();
        }
    } else {
        // WMI is gone — drop the stale map so it is rebuilt on recovery.
        *gpu_vendor_map = None;
    }

    // Borrow through the Option instead of cloning the whole map every poll;
    // the rebuild above has already finished, so this borrow is safe.
    let vendor_map = gpu_vendor_map.as_ref();

    let mut entries: Vec<(String, GpuClass, f64)> =
        merge_gpu_utilization_by_caption(vendor_map, &luid_3d_totals, gpu_error_lock);

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

    // --- should_rebuild_vendor_map ---

    fn fresh_instant() -> std::time::Instant {
        std::time::Instant::now()
    }

    #[test]
    fn test_should_rebuild_never_built() {
        assert!(should_rebuild_vendor_map(
            &None,
            fresh_instant(),
            &["0x00017D0F".to_string()]
        ));
        assert!(should_rebuild_vendor_map(&None, fresh_instant(), &[]));
    }

    #[test]
    fn test_should_not_rebuild_while_cached_map_covers_all_luids() {
        let mut cache = HashMap::new();
        cache.insert(
            "0x00017D0F".to_string(),
            "NVIDIA GeForce RTX 3060".to_string(),
        );
        // A map that was just built: rate limit prevents churn.
        assert!(!should_rebuild_vendor_map(
            &Some(cache.clone()),
            fresh_instant(),
            &["0x00017D0F".to_string()]
        ));
        // A map that is old but still covers all PDH LUIDs: no rebuild either.
        let long_ago = std::time::Instant::now() - std::time::Duration::from_secs(60);
        assert!(!should_rebuild_vendor_map(
            &Some(cache),
            long_ago,
            &["0x00017D0F".to_string()]
        ));
    }

    #[test]
    fn test_should_rebuild_when_new_luid_appears_after_interval() {
        let mut cache = HashMap::new();
        cache.insert(
            "0x00017D0F".to_string(),
            "NVIDIA GeForce RTX 3060".to_string(),
        );
        let long_ago = std::time::Instant::now() - std::time::Duration::from_secs(60);
        // A brand-new PDH LUID (hot-plug / late-appearing engine) triggers a
        // rebuild, but only once the rate-limit window has elapsed.
        assert!(should_rebuild_vendor_map(
            &Some(cache.clone()),
            long_ago,
            &["0x00017D0F".to_string(), "0x00017E00".to_string()]
        ));
        assert!(!should_rebuild_vendor_map(
            &Some(cache),
            fresh_instant(),
            &["0x00017D0F".to_string(), "0x00017E00".to_string()]
        ));
    }

    #[test]
    fn test_should_rebuild_failed_enumeration_is_rate_limited() {
        // Empty map = a prior WMI enumeration failed. Retried periodically,
        // never on every poll.
        let empty: HashMap<String, String> = HashMap::new();
        assert!(!should_rebuild_vendor_map(
            &Some(empty.clone()),
            fresh_instant(),
            &[]
        ));
        let long_ago = std::time::Instant::now() - std::time::Duration::from_secs(60);
        assert!(should_rebuild_vendor_map(
            &Some(empty),
            long_ago,
            &["0x00017D0F".to_string()]
        ));
    }

    // --- assign_captions_to_luids (F-2) ---

    fn captions(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn test_assign_captions_equal_counts_positional() {
        let mut luids = vec!["0x00017B00".to_string(), "0x00017A00".to_string()];
        let map = assign_captions_to_luids(&mut luids, &captions(&["NVIDIA RTX", "Intel Iris"]));
        // Sorted deterministically: "0x00017A00" < "0x00017B00".
        assert_eq!(
            map.get("0x00017A00").map(String::as_str),
            Some("NVIDIA RTX")
        );
        assert_eq!(
            map.get("0x00017B00").map(String::as_str),
            Some("Intel Iris")
        );
    }

    #[test]
    fn test_assign_captions_extra_luids_inherit_last_caption() {
        // Three LUIDs (e.g. one extra PDH dGPU engine) but two captions: every
        // LUID still gets a caption, and overflow inherits the last one.
        let mut luids = vec![
            "0x00017A00".to_string(),
            "0x00017B00".to_string(),
            "0x00017C00".to_string(),
        ];
        let map = assign_captions_to_luids(&mut luids, &captions(&["Intel Iris", "NVIDIA RTX"]));
        assert_eq!(map.len(), 3, "every known LUID must get a caption");
        assert_eq!(
            map.get("0x00017C00").map(String::as_str),
            Some("NVIDIA RTX")
        );
    }

    #[test]
    fn test_assign_captions_fewer_luids_than_captions() {
        // One LUID, two captions: only the first caption is consumed.
        let mut luids = vec!["0x00017A00".to_string()];
        let map = assign_captions_to_luids(&mut luids, &captions(&["Intel Iris", "NVIDIA RTX"]));
        assert_eq!(map.len(), 1);
        assert_eq!(
            map.get("0x00017A00").map(String::as_str),
            Some("Intel Iris")
        );
    }

    #[test]
    fn test_assign_captions_empty_captions_yield_empty_values() {
        let mut luids = vec!["0x00017A00".to_string()];
        let map = assign_captions_to_luids(&mut luids, &[]);
        assert_eq!(map.len(), 1);
        assert_eq!(map.get("0x00017A00").map(String::as_str), Some(""));
    }

    #[test]
    fn test_assign_captions_deterministic_for_same_input() {
        let mut a = vec!["0x00017B00".to_string(), "0x00017A00".to_string()];
        let mut b = a.clone();
        let caps = captions(&["Intel Iris", "NVIDIA RTX"]);
        let m1 = assign_captions_to_luids(&mut a, &caps);
        let m2 = assign_captions_to_luids(&mut b, &caps);
        assert_eq!(m1, m2);
    }

    #[test]
    fn test_assign_captions_extra_luid_does_not_shift_existing_caption() {
        // The caption for an already-known LUID must not move when a new LUID
        // is added to the set (the fragility the old positional-index code had).
        let mut base = vec!["0x00017A00".to_string(), "0x00017B00".to_string()];
        let caps = captions(&["Intel Iris", "NVIDIA RTX"]);
        let base_map = assign_captions_to_luids(&mut base, &caps);

        let mut grown = vec![
            "0x00017A00".to_string(),
            "0x00017B00".to_string(),
            "0x00017C00".to_string(),
        ];
        let grown_map = assign_captions_to_luids(&mut grown, &caps);

        // "0x00017A00" stays on the first caption in both cases.
        assert_eq!(
            base_map.get("0x00017A00").map(String::as_str),
            grown_map.get("0x00017A00").map(String::as_str)
        );
        assert_eq!(
            grown_map.get("0x00017A00").map(String::as_str),
            Some("Intel Iris")
        );
    }

    // --- merge_gpu_utilization_by_caption (known defect characterization, 3.2/3.3) ---
    // See the doc comment on merge_gpu_utilization_by_caption and design.md's
    // Known Gaps register in openspec/changes/add-realistic-usage-test-suite:
    // these tests pin the CURRENT (defective) behavior, not a requirement.

    #[test]
    fn test_merge_same_model_gpus_sums_utilization_into_one_entry() {
        // Two distinct physical GPUs, same model, different LUIDs.
        let mut vendor_map = HashMap::new();
        vendor_map.insert(
            "0x00017A00".to_string(),
            "NVIDIA GeForce RTX 3060".to_string(),
        );
        vendor_map.insert(
            "0x00017B00".to_string(),
            "NVIDIA GeForce RTX 3060".to_string(),
        );
        let mut luid_totals = HashMap::new();
        luid_totals.insert("0x00017A00".to_string(), 30.0);
        luid_totals.insert("0x00017B00".to_string(), 45.0);
        let gpu_error_lock = OnceLock::new();

        let entries =
            merge_gpu_utilization_by_caption(Some(&vendor_map), &luid_totals, &gpu_error_lock);

        // Defect: one merged entry, not two — the two physical GPUs are
        // indistinguishable in the result.
        assert_eq!(entries.len(), 1);
        let (name, class, util) = &entries[0];
        assert_eq!(name, "GeForce RTX 3060");
        assert_eq!(*class, GpuClass::DGpu);
        assert_eq!(*util, 75.0); // summed, not averaged or kept separate
    }

    #[test]
    fn test_merge_same_model_gpus_summed_utilization_capped_at_100() {
        let mut vendor_map = HashMap::new();
        vendor_map.insert(
            "0x00017A00".to_string(),
            "NVIDIA GeForce RTX 3060".to_string(),
        );
        vendor_map.insert(
            "0x00017B00".to_string(),
            "NVIDIA GeForce RTX 3060".to_string(),
        );
        let mut luid_totals = HashMap::new();
        luid_totals.insert("0x00017A00".to_string(), 80.0);
        luid_totals.insert("0x00017B00".to_string(), 70.0);
        let gpu_error_lock = OnceLock::new();

        let entries =
            merge_gpu_utilization_by_caption(Some(&vendor_map), &luid_totals, &gpu_error_lock);

        assert_eq!(entries.len(), 1);
        let (_, _, util) = &entries[0];
        assert_eq!(*util, 100.0); // 150.0 clamped to 100.0
    }

    #[test]
    fn test_merge_distinct_models_stay_separate_entries() {
        let mut vendor_map = HashMap::new();
        vendor_map.insert(
            "0x00017A00".to_string(),
            "NVIDIA GeForce RTX 3060".to_string(),
        );
        vendor_map.insert(
            "0x00017B00".to_string(),
            "Intel(R) Iris Xe Graphics".to_string(),
        );
        let mut luid_totals = HashMap::new();
        luid_totals.insert("0x00017A00".to_string(), 30.0);
        luid_totals.insert("0x00017B00".to_string(), 10.0);
        let gpu_error_lock = OnceLock::new();

        let entries =
            merge_gpu_utilization_by_caption(Some(&vendor_map), &luid_totals, &gpu_error_lock);

        assert_eq!(entries.len(), 2);
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

    // --- is_nvidia_gpu ---
    // is_nvidia_gpu is always called on the post-strip_brand_prefix display name
    // (see main.rs build_snapshot/build_history_payload), so these cases use the
    // same stripped form the function actually receives at runtime.

    #[test]
    fn test_is_nvidia_gpu_geforce() {
        assert!(is_nvidia_gpu("GeForce RTX 4070"));
    }

    #[test]
    fn test_is_nvidia_gpu_gtx() {
        assert!(is_nvidia_gpu("GeForce GTX 1660"));
    }

    #[test]
    fn test_is_nvidia_gpu_quadro_rtx() {
        assert!(is_nvidia_gpu("Quadro RTX 5000"));
    }

    #[test]
    fn test_is_nvidia_gpu_quadro_non_rtx() {
        assert!(is_nvidia_gpu("Quadro P620"));
        assert!(is_nvidia_gpu("Quadro M2000"));
        assert!(is_nvidia_gpu("Quadro K420"));
    }

    #[test]
    fn test_is_nvidia_gpu_tesla() {
        assert!(is_nvidia_gpu("Tesla V100"));
        assert!(is_nvidia_gpu("Tesla T4"));
    }

    #[test]
    fn test_is_nvidia_gpu_nvs() {
        assert!(is_nvidia_gpu("NVS 810"));
    }

    #[test]
    fn test_is_nvidia_gpu_bare_nvidia_form() {
        assert!(is_nvidia_gpu("NVIDIA A100"));
    }

    #[test]
    fn test_is_nvidia_gpu_amd_rejected() {
        assert!(!is_nvidia_gpu("Radeon RX 6700 XT"));
    }

    #[test]
    fn test_is_nvidia_gpu_intel_rejected() {
        assert!(!is_nvidia_gpu("Iris Xe Graphics"));
    }

    // --- strip_brand_prefix ---

    #[test]
    fn test_strip_brand_prefix_nvidia() {
        assert_eq!(
            strip_brand_prefix("NVIDIA GeForce RTX 4050"),
            "GeForce RTX 4050"
        );
    }

    #[test]
    fn test_strip_brand_prefix_intel_r() {
        assert_eq!(
            strip_brand_prefix("Intel(R) Iris Xe Graphics"),
            "Iris Xe Graphics"
        );
    }

    #[test]
    fn test_strip_brand_prefix_intel_no_r() {
        assert_eq!(
            strip_brand_prefix("Intel Iris Xe Graphics"),
            "Iris Xe Graphics"
        );
    }

    #[test]
    fn test_strip_brand_prefix_amd() {
        assert_eq!(
            strip_brand_prefix("AMD Radeon RX 6700 XT"),
            "Radeon RX 6700 XT"
        );
    }

    #[test]
    fn test_strip_brand_prefix_no_prefix_present() {
        assert_eq!(strip_brand_prefix("Some Other GPU"), "Some Other GPU");
    }

    #[test]
    fn test_strip_brand_prefix_already_stripped() {
        assert_eq!(strip_brand_prefix("GeForce RTX 4070"), "GeForce RTX 4070");
    }

    #[test]
    fn test_strip_brand_prefix_case_insensitive_match() {
        assert_eq!(
            strip_brand_prefix("nvidia geforce rtx 4070"),
            "geforce rtx 4070"
        );
        assert_eq!(
            strip_brand_prefix("NVIDIA GEFORCE RTX 4070"),
            "GEFORCE RTX 4070"
        );
    }
}
