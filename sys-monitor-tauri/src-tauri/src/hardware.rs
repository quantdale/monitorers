// ── HARDWARE PROFILE (DETECTION ONLY) ─────────────────────────────────────────
// Built once at startup. Providers read from it; no new sensors in this task.

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

#[derive(Debug, Clone, serde::Serialize)]
pub struct GpuInfo {
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

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiskInfo {
    pub name: String,
    pub kind: DiskKind,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HardwareProfile {
    pub cpu_vendor: CpuVendor,
    pub cpu_name: String,
    pub gpus: Vec<GpuInfo>,
    pub disks: Vec<DiskInfo>,
}

impl HardwareProfile {
    /// Returns true if any Nvidia dGPU is present.
    #[allow(dead_code)]
    pub fn has_nvidia_dgpu(&self) -> bool {
        self.gpus
            .iter()
            .any(|g| g.vendor == GpuVendor::Nvidia && g.kind == GpuKind::Discrete)
    }

    /// Returns true if any Intel iGPU is present. Used for future Intel iGPU provider.
    #[allow(dead_code)]
    pub fn has_intel_igpu(&self) -> bool {
        self.gpus
            .iter()
            .any(|g| g.vendor == GpuVendor::Intel && g.kind == GpuKind::Integrated)
    }

    /// Returns true if any AMD GPU (discrete or integrated) is present. Used for future AMD provider.
    #[allow(dead_code)]
    pub fn has_amd_gpu(&self) -> bool {
        self.gpus.iter().any(|g| g.vendor == GpuVendor::Amd)
    }
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

// ── GPU classification (name-based) ───────────────────────────────────────────

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
        GpuVendor::Intel => GpuKind::Integrated,
        GpuVendor::Nvidia | GpuVendor::Amd => GpuKind::Discrete,
        GpuVendor::Unknown => GpuKind::Unknown,
    };

    (vendor, kind)
}

/// Reuses existing GPU enumeration from collector::gpu (PDH + WMI). No new PDH queries.
fn detect_gpus(pdh: Option<&PdhHandles>, wmi_con: Option<&wmi::WMIConnection>) -> Vec<GpuInfo> {
    let (pdh_ref, wmi_ref) = match (pdh, wmi_con) {
        (Some(p), Some(w)) => (p, w),
        _ => return vec![],
    };
    let lock = OnceLock::new();
    let entries = crate::collector::query_gpu_utilization_pdh(pdh_ref, Some(wmi_ref), &lock);
    entries
        .into_iter()
        .map(|(_key, display_name, _util)| {
            let (vendor, kind) = classify_gpu(&display_name);
            GpuInfo {
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
