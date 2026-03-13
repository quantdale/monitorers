use std::collections::HashMap;
use windows::Win32::System::Performance::{
    PdhGetFormattedCounterArrayW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE,
};

// ── WMI DISK MODEL (Win32_DiskDrive) ─────────────────────────────────────────

/// Query Win32_DiskDrive for Index and Model. Returns map from physical drive index to model name.
/// Used as the preferred display name when sysinfo returns a device path (e.g. \\.\PhysicalDrive0).
pub fn query_disk_models_wmi(wmi_con: Option<&wmi::WMIConnection>) -> HashMap<u32, String> {
    let Some(con) = wmi_con else {
        return HashMap::new();
    };
    let rows = match con
        .raw_query::<HashMap<String, wmi::Variant>>("SELECT Index, Model FROM Win32_DiskDrive")
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[Disk] WMI Win32_DiskDrive query failed: {:?}", e);
            return HashMap::new();
        }
    };
    let mut map = HashMap::new();
    for row in rows {
        let index = row.get("Index").and_then(|v| match v {
            wmi::Variant::I4(n) => Some((*n).max(0) as u32),
            wmi::Variant::UI4(n) => Some(*n),
            wmi::Variant::I8(n) => Some((*n).max(0) as u32),
            wmi::Variant::UI8(n) => Some(*n as u32),
            _ => None,
        });
        let model = row.get("Model").and_then(|v| match v {
            wmi::Variant::String(s) => Some(s.trim().to_string()),
            _ => None,
        });
        if let (Some(idx), Some(m)) = (index, model) {
            if !m.is_empty() {
                map.insert(idx, m);
            }
        }
    }
    map
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
pub fn query_disk_active_time(pdh: &crate::state::PdhHandles) -> HashMap<String, f64> {
    let counter = match pdh.disk_active_counter {
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

        let u64_count = (buffer_size as usize * 3).div_ceil(8);
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

/// Read \PhysicalDisk(*)\Disk Read Bytes/sec and Disk Write Bytes/sec.
/// Returns (instance_name -> (read_mb_s, write_mb_s)). Skips _Total.
fn query_disk_read_write(pdh: &crate::state::PdhHandles) -> HashMap<String, (f64, f64)> {
    let mut result = HashMap::new();
    let counter_read = match pdh.disk_read_counter {
        Some(c) => c,
        None => return result,
    };
    let counter_write = match pdh.disk_write_counter {
        Some(c) => c,
        None => return result,
    };

    const BYTES_TO_MB: f64 = 1.0 / (1024.0 * 1024.0);

    let read_map = query_pdh_counter_array(counter_read);
    let write_map = query_pdh_counter_array(counter_write);

    for (name, read_bps) in read_map {
        if name == "_Total" {
            continue;
        }
        let write_bps = write_map.get(&name).copied().unwrap_or(0.0);
        result.insert(name, (read_bps * BYTES_TO_MB, write_bps * BYTES_TO_MB));
    }
    for (name, write_bps) in write_map {
        if name == "_Total" {
            continue;
        }
        result
            .entry(name)
            .or_insert_with(|| (0.0, write_bps * BYTES_TO_MB));
    }

    result
}

/// Read \PhysicalDisk(*)\Avg. Disk sec/Transfer.
/// Returns (instance_name -> seconds). Skips _Total.
fn query_disk_response_time(pdh: &crate::state::PdhHandles) -> HashMap<String, f64> {
    let mut result = HashMap::new();
    let counter = match pdh.disk_response_counter {
        Some(c) => c,
        None => return result,
    };
    for (name, secs) in query_pdh_counter_array(counter) {
        if name == "_Total" {
            continue;
        }
        result.insert(name, secs);
    }
    result
}

/// Read a PDH counter array into instance_name -> value map.
fn query_pdh_counter_array(counter: isize) -> HashMap<String, f64> {
    let mut result = HashMap::new();
    unsafe {
        let mut buf_size: u32 = 0;
        let mut item_count: u32 = 0;
        let _ = PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE,
            &mut buf_size,
            &mut item_count,
            None,
        );
        if item_count == 0 {
            return result;
        }
        let u64_count = (buf_size as usize * 3).div_ceil(8);
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
            return result;
        }
        for i in 0..item_count as usize {
            let item: &PDH_FMT_COUNTERVALUE_ITEM_W = &*buf_ptr.add(i);
            if item.FmtValue.CStatus > 1 {
                continue;
            }
            let name = item.szName.to_string().unwrap_or_default();
            let value = item.FmtValue.Anonymous.doubleValue;
            result.insert(name, value);
        }
    }
    result
}

/// Return type for `poll_disk`: active %, read MB/s, write MB/s, response ms, display order.
pub type PollDiskResult = (
    HashMap<String, f64>,
    HashMap<String, f64>,
    HashMap<String, f64>,
    HashMap<String, f64>,
    Vec<String>,
);

/// Parse PDH PhysicalDisk instance name (e.g. "0 C:" or "1 D: E:") to get the physical drive index.
fn pdh_instance_to_drive_index(instance: &str) -> Option<u32> {
    instance
        .split_whitespace()
        .next()
        .and_then(|s| s.parse::<u32>().ok())
}

/// One entry per physical disk: (disk_key, kind, display_name_source, pdh_drive_index).
/// display_name_source is the sysinfo Disk::name() for the first drive letter (for fallback).
pub type PhysicalDiskEntry = (String, sysinfo::DiskKind, String, Option<u32>);

/// Returns one entry per physical disk (same keys and order as poll_disk). Third element is the
/// sysinfo disk name for the first drive (used as fallback when WMI model is unavailable).
/// Used by the hardware profile so the sidebar shows the same number of storage cards as the dashboard.
pub fn physical_disk_list(
    disks: &sysinfo::Disks,
    pdh: &crate::state::PdhHandles,
) -> Vec<PhysicalDiskEntry> {
    let mut known_drive_letters: HashMap<String, String> = HashMap::new();
    let mut drive_letter_to_kind: HashMap<String, sysinfo::DiskKind> = HashMap::new();
    let mut drive_letter_to_name: HashMap<String, String> = HashMap::new();
    for d in disks.list() {
        let mount = d.mount_point().to_string_lossy().to_string();
        let mount_upper = mount.to_uppercase();
        if mount_upper.len() >= 2 && mount_upper.as_bytes()[1] == b':' {
            let letter = mount_upper[..2].to_string();
            known_drive_letters.insert(letter.clone(), mount);
            drive_letter_to_kind.insert(letter.clone(), d.kind());
            drive_letter_to_name.insert(letter, d.name().to_string_lossy().to_string());
        }
    }

    let mut result = Vec::new();
    for (instance_name, _pct_active) in query_disk_active_time(pdh) {
        let mapped_letters: Vec<String> = pdh_instance_to_drive_letters(&instance_name)
            .into_iter()
            .filter(|letter| known_drive_letters.contains_key(letter))
            .collect();

        if mapped_letters.is_empty() {
            continue;
        }

        let disk_key = mapped_letters.join(" ");
        let kind = mapped_letters
            .first()
            .and_then(|letter| drive_letter_to_kind.get(letter).copied())
            .unwrap_or(sysinfo::DiskKind::Unknown(0));
        let sysinfo_name = mapped_letters
            .first()
            .and_then(|letter| drive_letter_to_name.get(letter).cloned())
            .unwrap_or_else(|| disk_key.clone());
        let drive_index = pdh_instance_to_drive_index(&instance_name);
        result.push((disk_key, kind, sysinfo_name, drive_index));
    }
    result
}

/// Read disk metrics from PDH and sysinfo. Returns raw values for commit — no history writes.
pub fn poll_disk(disks: &mut sysinfo::Disks, pdh: &crate::state::PdhHandles) -> PollDiskResult {
    disks.refresh(false);

    let mut known_drive_letters: HashMap<String, String> = HashMap::new();
    for d in disks.list() {
        let mount = d.mount_point().to_string_lossy().to_string();
        let mount_upper = mount.to_uppercase();
        if mount_upper.len() >= 2 && mount_upper.as_bytes()[1] == b':' {
            known_drive_letters.insert(mount_upper[..2].to_string(), mount);
        }
    }

    let read_write = query_disk_read_write(pdh);
    let response_times = query_disk_response_time(pdh);

    let mut disk_active = HashMap::new();
    let mut disk_read_mb_s = HashMap::new();
    let mut disk_write_mb_s = HashMap::new();
    let mut disk_avg_response_ms = HashMap::new();
    let mut disk_display_order = Vec::new();

    for (instance_name, pct_active) in query_disk_active_time(pdh) {
        let mapped_letters: Vec<String> = pdh_instance_to_drive_letters(&instance_name)
            .into_iter()
            .filter(|letter| known_drive_letters.contains_key(letter))
            .collect();

        if mapped_letters.is_empty() {
            continue;
        }

        let disk_key = mapped_letters.join(" ");
        if !disk_active.contains_key(&disk_key) {
            disk_display_order.push(disk_key.clone());
        }
        disk_active.insert(disk_key.clone(), pct_active.clamp(0.0, 100.0));

        if let Some((read_mb, write_mb)) = read_write.get(&instance_name) {
            disk_read_mb_s.insert(disk_key.clone(), *read_mb);
            disk_write_mb_s.insert(disk_key.clone(), *write_mb);
        }

        if let Some(secs) = response_times.get(&instance_name) {
            disk_avg_response_ms.insert(disk_key.clone(), secs * 1000.0);
        }
    }

    // Fallback: match response_times by drive letters in case instance names differ.
    for (instance_name, secs) in &response_times {
        let letters: Vec<String> = pdh_instance_to_drive_letters(instance_name)
            .into_iter()
            .filter(|l| known_drive_letters.contains_key(l))
            .collect();
        if letters.is_empty() {
            continue;
        }
        let disk_key = letters.join(" ");
        if !disk_avg_response_ms.contains_key(&disk_key) && disk_active.contains_key(&disk_key) {
            disk_avg_response_ms.insert(disk_key.clone(), secs * 1000.0);
        }
    }

    (
        disk_active,
        disk_read_mb_s,
        disk_write_mb_s,
        disk_avg_response_ms,
        disk_display_order,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- pdh_instance_to_drive_letters ---

    #[test]
    fn test_pdh_instance_single_drive() {
        assert_eq!(pdh_instance_to_drive_letters("0 C:"), vec!["C:"]);
    }

    #[test]
    fn test_pdh_instance_two_drives() {
        assert_eq!(pdh_instance_to_drive_letters("0 C: D:"), vec!["C:", "D:"]);
    }

    #[test]
    fn test_pdh_instance_disk_only_no_letters() {
        assert_eq!(pdh_instance_to_drive_letters("1"), vec![] as Vec<String>);
    }

    #[test]
    fn test_pdh_instance_total_empty() {
        assert_eq!(
            pdh_instance_to_drive_letters("_Total"),
            vec![] as Vec<String>
        );
    }

    #[test]
    fn test_pdh_instance_whitespace_resilience() {
        assert_eq!(pdh_instance_to_drive_letters("  0 C:  "), vec!["C:"]);
    }

    // --- pdh_instance_to_drive_index ---

    #[test]
    fn test_pdh_instance_to_drive_index() {
        assert_eq!(pdh_instance_to_drive_index("0 C:"), Some(0));
        assert_eq!(pdh_instance_to_drive_index("1 D:"), Some(1));
        assert_eq!(pdh_instance_to_drive_index("2 E: F:"), Some(2));
        assert_eq!(pdh_instance_to_drive_index("_Total"), None);
        assert_eq!(pdh_instance_to_drive_index(""), None);
    }
}
