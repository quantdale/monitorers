// ── HARDWARE PROFILE (DETECTION ONLY) ─────────────────────────────────────────
// Built from best-effort metadata and reconciled with committed hardware keys;
// the collector owns the live profile and the frontend receives change events.

use std::sync::OnceLock;

use crate::pdh::PdhHandles;

// ── Enums & structs ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum CpuVendor {
    Intel,
    Amd,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum GpuVendor {
    Nvidia,
    Amd,
    Intel,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum GpuKind {
    Discrete,
    Integrated,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct GpuInfo {
    pub key: String,
    pub name: String,
    pub vendor: GpuVendor,
    pub kind: GpuKind,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum DiskKind {
    Ssd,
    Hdd,
    #[allow(dead_code)] // Reserved for M5 (NVMe via DeviceIoControl)
    Nvme,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct DiskInfo {
    pub key: String,
    pub name: String,
    pub kind: DiskKind,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct HardwareProfile {
    pub cpu_vendor: CpuVendor,
    pub cpu_name: String,
    pub gpus: Vec<GpuInfo>,
    pub disks: Vec<DiskInfo>,
}

// ── CPU detection ─────────────────────────────────────────────────────────────

fn detect_cpu_vendor() -> CpuVendor {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
    let brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_lowercase())
        .unwrap_or_default();
    if brand.contains("intel") {
        CpuVendor::Intel
    } else if brand.contains("amd") {
        CpuVendor::Amd
    } else {
        CpuVendor::Unknown
    }
}

fn detect_cpu_name() -> String {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
    sys.cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "Unknown CPU".to_string())
}

// ── GPU classification (conservative fallback when adapter properties are unavailable) ──

pub fn classify_gpu(name: &str) -> (GpuVendor, GpuKind) {
    let lower = name.to_lowercase();
    let vendor = if lower.contains("nvidia")
        || lower.contains("geforce")
        || lower.contains("quadro")
        || lower.contains("rtx")
        || lower.contains("gtx")
    {
        GpuVendor::Nvidia
    } else if lower.contains("amd")
        || lower.contains("radeon")
        || lower.contains("rx ")
        || lower.contains("vega")
    {
        GpuVendor::Amd
    } else if lower.contains("intel")
        || lower.contains("iris")
        || lower.contains("uhd")
        || lower.contains("arc")
    {
        GpuVendor::Intel
    } else {
        GpuVendor::Unknown
    };

    let kind = match vendor {
        GpuVendor::Nvidia
            if lower.contains("geforce")
                || lower.contains("quadro")
                || lower.contains("rtx")
                || lower.contains("gtx")
                || lower.contains("tesla")
                || lower.contains("nvs")
                || lower.contains("discrete")
                || lower.contains("dedicated") =>
        {
            GpuKind::Discrete
        }
        GpuVendor::Intel if lower.contains("arc") => GpuKind::Discrete,
        GpuVendor::Intel
            if lower.contains("uhd") || lower.contains("iris") || lower.contains("integrated") =>
        {
            GpuKind::Integrated
        }
        GpuVendor::Amd
            if lower.contains("rx ")
                || lower.contains("radeon pro")
                || (lower.contains("vega")
                    && (lower.contains("vega 56")
                        || lower.contains("vega 64")
                        || lower.contains("frontier"))) =>
        {
            GpuKind::Discrete
        }
        GpuVendor::Amd
            if lower.contains("apu")
                || lower.contains("radeon graphics")
                || lower.contains("integrated") =>
        {
            GpuKind::Integrated
        }
        GpuVendor::Amd if lower.contains("vega") && lower.contains("graphics") => {
            GpuKind::Integrated
        }
        // A vendor name alone does not prove form factor. Avoid confidently
        // labeling an unknown AMD/Intel adapter when DXGI memory properties
        // are unavailable in this lightweight profile path.
        _ => GpuKind::Unknown,
    };

    (vendor, kind)
}

/// Reuses existing GPU enumeration from collector::gpu (PDH + WMI). No new PDH queries.
fn detect_gpus(pdh: Option<&PdhHandles>, wmi_con: Option<&wmi::WMIConnection>) -> Vec<GpuInfo> {
    let Some(pdh_ref) = pdh else { return vec![] };
    let lock = OnceLock::new();
    // One-time startup call — a throwaway cache avoids rebuilding the WMI
    // vendor map here while leaving the steady-state cache untouched.
    let mut vendor_map: Option<std::collections::HashMap<String, String>> = None;
    let mut last_build = std::time::Instant::now();
    let entries = crate::collector::query_gpu_utilization_pdh(
        pdh_ref,
        wmi_con,
        &lock,
        &mut vendor_map,
        &mut last_build,
    );
    entries
        .into_iter()
        .map(|(key, display_name, _util)| {
            let (vendor, kind) = classify_gpu(&display_name);
            GpuInfo {
                key,
                name: display_name,
                vendor,
                kind,
            }
        })
        .collect()
}

// ── Disk detection ─────────────────────────────────────────────────────────────

fn detect_disks() -> Vec<DiskInfo> {
    use sysinfo::DiskKind as SysDiskKind;
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();
    disks
        .iter()
        .map(|d| {
            let kind = match d.kind() {
                SysDiskKind::SSD => DiskKind::Ssd,
                SysDiskKind::HDD => DiskKind::Hdd,
                _ => DiskKind::Unknown,
            };
            DiskInfo {
                key: d.name().to_string_lossy().to_string(),
                name: d.name().to_string_lossy().to_string(),
                kind,
            }
        })
        .collect()
}

// ── Public detect ──────────────────────────────────────────────────────────────

/// Build hardware profile. Call with (None, None, None) when WMI is not yet available
/// (e.g. in CollectorState::new()); call with (Some(&pdh), wmi_con, Some(disks)) on the
/// background thread after WMI is ready to populate GPUs and physical-disk list.
/// When disks_override is Some, it is used so the sidebar matches the dashboard disk count.
pub fn detect(
    pdh: Option<&PdhHandles>,
    wmi_con: Option<&wmi::WMIConnection>,
    disks_override: Option<Vec<DiskInfo>>,
) -> HardwareProfile {
    let disks = disks_override.unwrap_or_else(detect_disks);
    HardwareProfile {
        cpu_vendor: detect_cpu_vendor(),
        cpu_name: detect_cpu_name(),
        gpus: detect_gpus(pdh, wmi_con),
        disks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- classify_gpu (name-based vendor + kind classification) ---

    #[test]
    fn test_classify_gpu_nvidia_discrete() {
        assert_eq!(
            classify_gpu("NVIDIA GeForce RTX 4070"),
            (GpuVendor::Nvidia, GpuKind::Discrete)
        );
        assert_eq!(
            classify_gpu("GeForce GTX 1660"),
            (GpuVendor::Nvidia, GpuKind::Discrete)
        );
        assert_eq!(
            classify_gpu("Quadro RTX 5000"),
            (GpuVendor::Nvidia, GpuKind::Discrete)
        );
    }

    #[test]
    fn test_classify_gpu_amd_discrete() {
        assert_eq!(
            classify_gpu("AMD Radeon RX 6700 XT"),
            (GpuVendor::Amd, GpuKind::Discrete)
        );
        assert_eq!(
            classify_gpu("Radeon Vega 56"),
            (GpuVendor::Amd, GpuKind::Discrete)
        );
    }

    #[test]
    fn test_classify_gpu_intel_integrated() {
        assert_eq!(
            classify_gpu("Intel(R) Iris Xe Graphics"),
            (GpuVendor::Intel, GpuKind::Integrated)
        );
        assert_eq!(
            classify_gpu("Intel UHD Graphics 630"),
            (GpuVendor::Intel, GpuKind::Integrated)
        );
        assert_eq!(
            classify_gpu("Iris Xe"),
            (GpuVendor::Intel, GpuKind::Integrated)
        );
    }

    #[test]
    fn test_classify_gpu_unknown() {
        assert_eq!(
            classify_gpu("Some Generic GPU"),
            (GpuVendor::Unknown, GpuKind::Unknown)
        );
        assert_eq!(classify_gpu(""), (GpuVendor::Unknown, GpuKind::Unknown));
    }

    #[test]
    fn test_classify_gpu_is_case_insensitive() {
        assert_eq!(
            classify_gpu("nvidia geforce rtx 4070"),
            (GpuVendor::Nvidia, GpuKind::Discrete)
        );
        assert_eq!(
            classify_gpu("AMD RADEON RX 6700"),
            (GpuVendor::Amd, GpuKind::Discrete)
        );
        assert_eq!(
            classify_gpu("INTEL IRIS XE"),
            (GpuVendor::Intel, GpuKind::Integrated)
        );
    }

    #[test]
    fn test_classify_gpu_distinguishes_modern_discrete_and_integrated_names() {
        assert_eq!(
            classify_gpu("Intel Arc A770"),
            (GpuVendor::Intel, GpuKind::Discrete)
        );
        assert_eq!(
            classify_gpu("AMD Radeon Graphics"),
            (GpuVendor::Amd, GpuKind::Integrated)
        );
        assert_eq!(
            classify_gpu("AMD Ryzen APU"),
            (GpuVendor::Amd, GpuKind::Integrated)
        );
        assert_eq!(
            classify_gpu("AMD Radeon Pro W7800"),
            (GpuVendor::Amd, GpuKind::Discrete)
        );
        assert_eq!(
            classify_gpu("AMD Radeon Vega 8 Graphics"),
            (GpuVendor::Amd, GpuKind::Integrated)
        );
        assert_eq!(
            classify_gpu("AMD Radeon Vega Graphics"),
            (GpuVendor::Amd, GpuKind::Integrated)
        );
    }

    #[test]
    fn test_classify_gpu_vendor_only_is_conservative() {
        assert_eq!(
            classify_gpu("Intel Graphics"),
            (GpuVendor::Intel, GpuKind::Unknown)
        );
        assert_eq!(
            classify_gpu("AMD Adapter"),
            (GpuVendor::Amd, GpuKind::Unknown)
        );
        assert_eq!(
            classify_gpu("NVIDIA Adapter"),
            (GpuVendor::Nvidia, GpuKind::Unknown)
        );
    }
}
