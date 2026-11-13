use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE, DXGI_ERROR_NOT_FOUND,
};

// ── GPU CLASSIFICATION ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuClass {
    IGpu,
    DGpu,
    Unknown,
}

/// Preserve both LUID halves, keeping existing zero-high-part keys compatible.
///
/// Name formats:
///   New: `"pid_1234_luid_0x00000000_0x00017D0F_phys_0_eng_0_engtype_3D"`
///   Old: `"luid_0x00000000_0x00017D0F_phys_0_eng_0_engtype_3D"`
///
/// Returns `"0x00017D0F"` when high is zero, otherwise `"0xHIGH_0xLOW"`.
pub fn extract_luid_from_name(name: &str) -> Option<String> {
    let after_luid = if let Some(pos) = name.find("_luid_") {
        &name[pos + 6..]
    } else {
        // `strip_prefix` yields None for names without the legacy prefix.
        name.strip_prefix("luid_")?
    };

    let mut parts = after_luid.split('_');
    let high = u32::from_str_radix(parts.next()?.strip_prefix("0x")?, 16).ok()?;
    let low = u32::from_str_radix(parts.next()?.strip_prefix("0x")?, 16).ok()?;
    Some(gpu_luid_key(high, low))
}

fn gpu_luid_key(high: u32, low: u32) -> String {
    if high == 0 {
        format!("0x{low:08X}")
    } else {
        format!("0x{high:08X}_0x{low:08X}")
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
    crate::hardware::classify_gpu(display_name).0 == crate::hardware::GpuVendor::Nvidia
}

/// Classify a LUID as iGPU or dGPU.
///
/// Primary: keyword match on the exact DXGI adapter caption.
/// LUIDs not in the vendor map fall through to Unknown — no hardcoded fallbacks,
/// since LUIDs are machine-specific and change across reboots.
pub fn classify_luid(luid: &str, vendor_map: &HashMap<String, String>) -> GpuClass {
    match vendor_map
        .get(luid)
        .map(|caption| crate::hardware::classify_gpu(caption).1)
    {
        Some(crate::hardware::GpuKind::Integrated) => GpuClass::IGpu,
        Some(crate::hardware::GpuKind::Discrete) => GpuClass::DGpu,
        _ => GpuClass::Unknown,
    }
}

// ── EXACT OS ADAPTER CATALOG ─────────────────────────────────────────────────

/// Metadata only: COM objects never leave the collector's enumeration call.
#[derive(Clone, Debug, Default)]
pub struct GpuAdapterCatalog {
    pub captions: HashMap<String, String>,
    pub software_keys: HashSet<String>,
    confirmed: bool,
}

impl GpuAdapterCatalog {
    pub fn is_confirmed(&self) -> bool {
        self.confirmed
    }
}

fn catalog_from_adapters(
    adapters: impl IntoIterator<Item = (String, String, bool)>,
) -> GpuAdapterCatalog {
    let mut catalog = GpuAdapterCatalog {
        confirmed: true,
        ..Default::default()
    };
    for (key, caption, software) in adapters {
        if software {
            catalog.software_keys.insert(key);
        } else {
            catalog.captions.insert(key, caption);
        }
    }
    catalog
}

/// Enumerate labels and software classification from the same adapter LUID.
pub fn enumerate_gpu_adapters() -> windows::core::Result<GpuAdapterCatalog> {
    // SAFETY: DXGI creates an owned factory for the requested interface; it
    // and every returned adapter remain on this thread and are RAII-released.
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
    let mut adapters = Vec::new();
    for index in 0.. {
        // SAFETY: factory is a valid owned COM interface; DXGI bounds-checks
        // the index and returns DXGI_ERROR_NOT_FOUND at the end of the list.
        let adapter = match unsafe { factory.EnumAdapters1(index) } {
            Ok(adapter) => adapter,
            Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
            Err(error) => return Err(error),
        };
        // SAFETY: adapter is a live owned interface; GetDesc1 returns its
        // descriptor by value and the binding owns the output storage.
        let descriptor = unsafe { adapter.GetDesc1()? };
        let length = descriptor
            .Description
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(descriptor.Description.len());
        adapters.push((
            gpu_luid_key(
                descriptor.AdapterLuid.HighPart as u32,
                descriptor.AdapterLuid.LowPart,
            ),
            String::from_utf16_lossy(&descriptor.Description[..length]),
            descriptor.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0,
        ));
    }
    Ok(catalog_from_adapters(adapters))
}

// ── GPU PDH UTILIZATION ──────────────────────────────────────────────────────

/// Per-GPU result: (luid, display_name, utilization%).
pub type GpuUtilEntry = (String, String, Option<f64>);

const ADAPTER_REFRESH_INTERVAL: std::time::Duration = std::time::Duration::from_secs(10);

fn should_refresh_adapters(
    cache: &Option<GpuAdapterCatalog>,
    last_refresh: std::time::Instant,
    now: std::time::Instant,
) -> bool {
    cache.is_none() || now.saturating_duration_since(last_refresh) >= ADAPTER_REFRESH_INTERVAL
}

fn refresh_adapter_cache(
    cache: &mut Option<GpuAdapterCatalog>,
    result: windows::core::Result<GpuAdapterCatalog>,
) {
    match result {
        Ok(catalog) => *cache = Some(catalog),
        Err(_) if cache.is_none() => *cache = Some(GpuAdapterCatalog::default()),
        Err(_) => {} // A transient metadata failure must not relabel known devices.
    }
}

/// Merge per-LUID utilization totals into per-LUID entries.
///
/// Each LUID gets its own entry with its own display name, so two physically
/// distinct same-model GPUs (same brand-stripped display name, different LUIDs)
/// are distinguishable in the UI. When two or more LUIDs share the same
/// display name, a numeric suffix is appended (e.g. "GeForce RTX 3060 1",
/// "GeForce RTX 3060 2") so card IDs remain unique.
///
/// Returns `(luid, display_name, GpuClass, util%)` per LUID.
fn merge_gpu_utilization_by_caption(
    vendor_map: Option<&HashMap<String, String>>,
    luid_3d_totals: &HashMap<String, f64>,
    gpu_error_lock: &OnceLock<()>,
) -> Vec<(String, String, GpuClass, f64)> {
    // Build list from vendor_map so we include GPUs with 0% util.
    let Some(vendor_map) = vendor_map else {
        return Vec::new();
    };
    let mut entries: Vec<(String, String, GpuClass, f64)> = Vec::new();
    for (luid, caption) in vendor_map {
        let class = classify_luid(luid, vendor_map);
        if matches!(class, GpuClass::Unknown) {
            gpu_error_lock.get_or_init(|| {
                eprintln!(
                    "[GPU] LUID {} not matched by vendor keyword — GpuClass::Unknown",
                    luid
                );
            });
        }
        let util = luid_3d_totals.get(luid).copied().unwrap_or(0.0).min(100.0);
        let display_name = strip_brand_prefix(caption);
        let display_name = if display_name.is_empty() {
            format!("GPU {luid}")
        } else {
            display_name
        };
        entries.push((luid.clone(), display_name, class, util));
    }

    // Suffixes must follow identity, never randomized HashMap iteration order.
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    // Disambiguate same-display-name GPUs: count occurrences, append " 1", " 2" etc.
    let mut name_counts: HashMap<String, usize> = HashMap::new();
    for (_, name, _, _) in &entries {
        *name_counts.entry(name.clone()).or_insert(0) += 1;
    }
    let mut name_indices: HashMap<String, usize> = HashMap::new();
    for (_, name, _, _) in &mut entries {
        if *name_counts.get(name).unwrap_or(&0) > 1 {
            let idx = *name_indices.entry(name.clone()).or_insert(0);
            name_indices.insert(name.clone(), idx + 1);
            name.push_str(&format!(" {}", idx + 1));
        }
    }

    entries
}

/// PDH still exposes stable LUIDs even when adapter metadata is unavailable. Keep those
/// entries visible with conservative metadata instead of hiding every GPU;
/// enrichment can be retried later and the stable key remains unchanged.
fn merge_gpu_utilization_without_vendor_map(
    luid_3d_totals: &HashMap<String, f64>,
) -> Vec<(String, String, GpuClass, f64)> {
    luid_3d_totals
        .iter()
        .map(|(luid, util)| {
            (
                luid.clone(),
                format!("GPU {luid}"),
                GpuClass::Unknown,
                (*util).clamp(0.0, 100.0),
            )
        })
        .collect()
}

fn merge_gpu_utilization(
    catalog: Option<&GpuAdapterCatalog>,
    totals: &HashMap<String, f64>,
    error_log: &OnceLock<()>,
) -> Vec<(String, String, GpuClass, f64)> {
    let Some(catalog) = catalog else {
        return merge_gpu_utilization_without_vendor_map(totals);
    };
    let mut entries = merge_gpu_utilization_by_caption(Some(&catalog.captions), totals, error_log);
    for (key, util) in totals {
        if !catalog.captions.contains_key(key) && !catalog.software_keys.contains(key) {
            entries.push((
                key.clone(),
                format!("GPU {key}"),
                GpuClass::Unknown,
                (*util).clamp(0.0, 100.0),
            ));
        }
    }
    entries
}

/// Read GPU 3D-engine utilization from PDH. Returns list of (history_key, display_name, util%) per GPU.
///
/// PdhCollectQueryData is called once per poll in poll() before this function runs.
/// This function only reads the already-collected data.
///
/// DXGI metadata is cached across polls and refreshed at a bounded cadence.
/// Enumeration runs on this collector thread, outside the history lock.
pub fn query_gpu_utilization_pdh(
    pdh: &crate::state::PdhHandles,
    gpu_error_lock: &OnceLock<()>,
    gpu_adapters: &mut Option<GpuAdapterCatalog>,
    adapters_last_refresh: &mut std::time::Instant,
) -> Option<Vec<GpuUtilEntry>> {
    let mut result = Vec::new();
    pdh.query?;
    let counter_3d = pdh.gpu_3d_counter?;

    let mut luid_3d_totals: HashMap<String, f64> = HashMap::new();
    let mut unavailable = HashSet::new();

    for (name, util) in crate::pdh::read_pdh_counter_array(counter_3d)? {
        let luid = match extract_luid_from_name(&name) {
            Some(l) => l,
            None => continue,
        };
        if let Some(util) = util {
            *luid_3d_totals.entry(luid).or_insert(0.0) += util.clamp(0.0_f64, 100.0);
        } else {
            unavailable.insert(luid.clone());
            luid_3d_totals.entry(luid).or_insert(0.0);
        }
    }

    let now = std::time::Instant::now();
    if should_refresh_adapters(gpu_adapters, *adapters_last_refresh, now) {
        let result = enumerate_gpu_adapters();
        if let Err(error) = &result {
            gpu_error_lock.get_or_init(|| eprintln!("[GPU] DXGI enumeration failed: {error}"));
        }
        refresh_adapter_cache(gpu_adapters, result);
        *adapters_last_refresh = std::time::Instant::now();
    }

    let mut entries = merge_gpu_utilization(gpu_adapters.as_ref(), &luid_3d_totals, gpu_error_lock);

    // A total order keeps unknown vendors from making comparisons cyclic.
    let class_rank = |class| match class {
        GpuClass::IGpu => 0,
        GpuClass::DGpu => 1,
        GpuClass::Unknown => 2,
    };
    entries.sort_by(|a, b| {
        class_rank(a.2)
            .cmp(&class_rank(b.2))
            .then_with(|| a.1.cmp(&b.1))
            .then_with(|| a.0.cmp(&b.0))
    });

    // Use LUID as history key so two identical GPUs get separate history
    // arrays and separate cards. The display_name (with disambiguation
    // suffix) is used for the UI label.
    for (luid, display_name, _class, util) in entries {
        let value = (!unavailable.contains(&luid)).then_some(util);
        result.push((luid, display_name, value));
    }

    if cfg!(debug_assertions) {
        eprintln!("[PDH DEBUG] GPUs: {:?}", result);
    }

    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn ordering_uses_the_same_form_factor_policy_as_profiles() {
        let map = HashMap::from([
            ("intel-discrete".into(), "Intel Arc A770".into()),
            ("amd-integrated".into(), "AMD Radeon Graphics".into()),
            ("unknown".into(), "Intel Adapter".into()),
        ]);
        assert_eq!(classify_luid("intel-discrete", &map), GpuClass::DGpu);
        assert_eq!(classify_luid("amd-integrated", &map), GpuClass::IGpu);
        assert_eq!(classify_luid("unknown", &map), GpuClass::Unknown);
    }

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

    // --- exact adapter identity and bounded metadata refresh ---

    fn observed_catalog() -> GpuAdapterCatalog {
        catalog_from_adapters([
            ("0x000183B8".into(), "Intel(R) UHD Graphics".into(), false),
            (
                "0x0001865D".into(),
                "Microsoft Basic Render Driver".into(),
                true,
            ),
            (
                "0x000186D3".into(),
                "NVIDIA GeForce RTX 4050 Laptop GPU".into(),
                false,
            ),
        ])
    }

    #[test]
    fn software_renderer_must_not_inherit_the_nvidia_caption() {
        let catalog = observed_catalog();
        let totals = HashMap::from([
            ("0x000183B8".into(), 8.0),
            ("0x0001865D".into(), 95.0),
            ("0x000186D3".into(), 30.0),
        ]);
        let entries = merge_gpu_utilization(Some(&catalog), &totals, &OnceLock::new());
        assert_eq!(entries.len(), 2);
        assert!(entries
            .iter()
            .any(|(key, name, _, util)| key == "0x000186D3"
                && name == "GeForce RTX 4050 Laptop GPU"
                && *util == 30.0));
        assert!(!entries.iter().any(|(key, _, _, _)| key == "0x0001865D"));
    }

    #[test]
    fn luid_high_halves_do_not_collapse_and_common_keys_are_compatible() {
        let a = extract_luid_from_name("pid_1_luid_0x00000001_0x00000002_phys_0_eng_0_engtype_3D");
        let b = extract_luid_from_name("luid_0x00000002_0x00000002_phys_0_eng_0_engtype_3D");
        assert_eq!(a.as_deref(), Some("0x00000001_0x00000002"));
        assert_eq!(b.as_deref(), Some("0x00000002_0x00000002"));
        assert_ne!(a, b);
        assert_eq!(
            extract_luid_from_name("luid_0x00000000_0x000183b8_phys_0").as_deref(),
            Some("0x000183B8")
        );
        assert_eq!(gpu_luid_key(u32::MAX, 2), "0xFFFFFFFF_0x00000002");
        assert_eq!(
            extract_luid_from_name("luid_0xINVALID_0x00000002_phys_0"),
            None
        );
        assert_eq!(
            extract_luid_from_name("luid_0x00000000_0xNOTHEX_phys_0"),
            None
        );
    }

    #[test]
    fn metadata_refresh_is_bounded_for_success_and_failure_and_detects_removal() {
        let now = std::time::Instant::now();
        assert!(should_refresh_adapters(&None, now, now));
        for cache in [GpuAdapterCatalog::default(), observed_catalog()] {
            assert!(!should_refresh_adapters(
                &Some(cache.clone()),
                now,
                now + std::time::Duration::from_millis(9_999)
            ));
            assert!(should_refresh_adapters(
                &Some(cache),
                now,
                now + ADAPTER_REFRESH_INTERVAL
            ));
        }
        assert!(!should_refresh_adapters(
            &Some(observed_catalog()),
            now + ADAPTER_REFRESH_INTERVAL,
            now
        ));
    }

    #[test]
    fn transient_enumeration_failure_retains_last_good_catalog() {
        let error = || windows::core::Error::from_hresult(windows::core::HRESULT(-2147467259));
        let mut cache = Some(observed_catalog());
        refresh_adapter_cache(&mut cache, Err(error()));
        assert_eq!(cache.as_ref().unwrap().captions.len(), 2);
        assert!(cache.as_ref().unwrap().software_keys.contains("0x0001865D"));
        refresh_adapter_cache(&mut cache, Ok(GpuAdapterCatalog::default()));
        assert!(cache.unwrap().captions.is_empty()); // successful removal replaces stale data
        let mut failed = None;
        refresh_adapter_cache(&mut failed, Err(error()));
        assert!(failed.is_some()); // failed first enumeration is also rate-limited
        assert!(!failed.as_ref().unwrap().is_confirmed());
        refresh_adapter_cache(&mut failed, Ok(catalog_from_adapters([])));
        assert!(failed.as_ref().unwrap().is_confirmed()); // even an empty successful inventory
    }

    #[test]
    fn unknown_counter_channels_remain_visible_without_borrowed_vendor_data() {
        let totals = HashMap::from([("0x00019999".into(), 23.0)]);
        let entries = merge_gpu_utilization(Some(&observed_catalog()), &totals, &OnceLock::new());
        assert!(entries
            .iter()
            .any(|(key, name, class, util)| key == "0x00019999"
                && name == "GPU 0x00019999"
                && *class == GpuClass::Unknown
                && *util == 23.0));
        let catalog =
            catalog_from_adapters([("0x00000001".into(), "Qualcomm Adreno".into(), false)]);
        let entries = merge_gpu_utilization(Some(&catalog), &HashMap::new(), &OnceLock::new());
        assert_eq!(entries[0].1, "Qualcomm Adreno");
        assert_eq!(entries[0].2, GpuClass::Unknown);
    }

    #[test]
    fn duplicate_model_suffixes_follow_keys_regardless_of_enumeration_order() {
        let adapters = vec![
            ("b".into(), "NVIDIA Same Model".into(), false),
            ("a".into(), "NVIDIA Same Model".into(), false),
        ];
        let a = catalog_from_adapters(adapters.clone());
        let b = catalog_from_adapters(adapters.into_iter().rev());
        let totals = HashMap::from([("a".into(), 10.0), ("b".into(), 40.0)]);
        let first = merge_gpu_utilization(Some(&a), &totals, &OnceLock::new());
        assert_eq!(
            first,
            merge_gpu_utilization(Some(&b), &totals, &OnceLock::new())
        );
        assert_eq!(
            first[0],
            ("a".into(), "Same Model 1".into(), GpuClass::Unknown, 10.0)
        );
        assert_eq!(
            first[1],
            ("b".into(), "Same Model 2".into(), GpuClass::Unknown, 40.0)
        );
    }

    // --- merge_gpu_utilization_by_caption (per-LUID entries, AUDIT-004 fix) ---

    #[test]
    fn test_merge_same_model_gpus_emit_separate_entries() {
        // Two distinct physical GPUs, same model, different LUIDs.
        // Each gets its own entry with a disambiguation suffix.
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

        // Two separate entries — the physical GPUs are distinguishable.
        assert_eq!(entries.len(), 2);
        // Both are dGPUs.
        for (_, _, class, _) in &entries {
            assert_eq!(*class, GpuClass::DGpu);
        }
        // Each LUID used as history key (order-independent check).
        let luids: Vec<&str> = entries.iter().map(|(l, _, _, _)| l.as_str()).collect();
        assert!(luids.contains(&"0x00017A00"));
        assert!(luids.contains(&"0x00017B00"));
        // Display names disambiguated with suffixes (order-independent).
        let names: Vec<&str> = entries.iter().map(|(_, n, _, _)| n.as_str()).collect();
        assert!(names.iter().all(|n| n.contains("3060")));
        assert_ne!(
            names[0], names[1],
            "same-model GPUs must have distinct display names"
        );
        // Utilization kept separate (not summed).
        let utils: Vec<f64> = entries.iter().map(|(_, _, _, u)| *u).collect();
        assert!(utils.contains(&30.0));
        assert!(utils.contains(&45.0));
    }

    #[test]
    fn test_merge_same_model_gpus_utilization_not_summed() {
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

        assert_eq!(entries.len(), 2);
        let utils: Vec<f64> = entries.iter().map(|(_, _, _, u)| *u).collect();
        assert!(utils.contains(&80.0), "each GPU keeps its own util%");
        assert!(utils.contains(&70.0), "each GPU keeps its own util%");
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

    // --- merge_gpu_utilization_without_vendor_map (metadata-unavailable fallback) ---

    #[test]
    fn test_merge_without_vendor_map_emits_one_unknown_class_entry_per_luid() {
        let mut totals = HashMap::new();
        totals.insert("0x00017A00".to_string(), 30.0);
        totals.insert("0x00017B00".to_string(), 45.0);
        let entries = merge_gpu_utilization_without_vendor_map(&totals);
        assert_eq!(entries.len(), 2);
        assert!(
            entries
                .iter()
                .all(|(_, _, class, _)| *class == GpuClass::Unknown),
            "without a vendor map no card may claim a vendor"
        );
        let utils: Vec<f64> = entries.iter().map(|(_, _, _, u)| *u).collect();
        assert!(utils.contains(&30.0) && utils.contains(&45.0));
    }

    #[test]
    fn test_merge_without_vendor_map_names_by_luid_and_clamps_util() {
        // Engine utilizations are summed per LUID before this function runs;
        // an over-100 sum must clamp rather than render a >100% chart point.
        let mut totals = HashMap::new();
        totals.insert("0x00017D0F".to_string(), 250.0);
        let entries = merge_gpu_utilization_without_vendor_map(&totals);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].1, "GPU 0x00017D0F");
        assert_eq!(entries[0].3, 100.0);
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
