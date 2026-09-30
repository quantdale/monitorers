use std::collections::HashMap;

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

/// Choose the disk's DISPLAY name for a physical drive index.
///
/// `models` is the already-queried `query_disk_models_wmi` map (empty when WMI
/// is unavailable or the query failed). `fallback` is the name sysinfo
/// reported, which on some hosts is a raw device path (`\\.\PhysicalDrive0`)
/// and therefore not something to show a user.
///
/// Deliberately pure and WMI-free: it takes the queried map rather than a
/// connection, so it is unit-testable without COM, and a failed/empty query
/// degrades to `fallback` instead of dropping the disk.
///
/// This affects PRESENTATION ONLY. Disk identity is the drive-letter key
/// derived from `physical_disk_list`; two disks that report the same model
/// string keep distinct keys because the key never comes from the name.
pub fn disk_display_name(
    drive_index: Option<u32>,
    models: &HashMap<u32, String>,
    fallback: &str,
) -> String {
    drive_index
        .and_then(|idx| models.get(&idx))
        .filter(|model| !model.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
}

// ── DISK HELPERS ─────────────────────────────────────────────────────────────

/// A sysinfo disk's kind and display name, keyed by drive letter.
struct DriveLetterInfo {
    kind: sysinfo::DiskKind,
    name: String,
}

/// Build a map from drive letter (e.g. "C:") to sysinfo disk info, for every
/// sysinfo disk whose mount point is a drive-letter path. Shared by
/// `physical_disk_list()` and `poll_disk()`, which both resolve PDH-reported
/// drive letters back to known sysinfo disks; `poll_disk()` only needs the
/// key set (membership checks), while `physical_disk_list()` also needs kind
/// and name, so both fields are computed unconditionally — cheap, since `d`
/// is already in hand.
fn known_drive_letters(disks: &sysinfo::Disks) -> HashMap<String, DriveLetterInfo> {
    let mut map = HashMap::new();
    for d in disks.list() {
        let mount = d.mount_point().to_string_lossy().to_string();
        let mount_upper = mount.to_uppercase();
        if mount_upper.len() >= 2 && mount_upper.as_bytes()[1] == b':' {
            let letter = mount_upper[..2].to_string();
            map.insert(
                letter,
                DriveLetterInfo {
                    kind: d.kind(),
                    name: d.name().to_string_lossy().to_string(),
                },
            );
        }
    }
    map
}

/// Parse a PDH PhysicalDisk instance name like "0 C: D:" into drive letters ["C:", "D:"].
pub fn pdh_instance_to_drive_letters(instance: &str) -> Vec<String> {
    instance
        .split_whitespace()
        .skip(1) // skip the leading disk index token (e.g. "0")
        .filter(|token| token.ends_with(':'))
        .map(|token| token.to_uppercase())
        .collect()
}

/// Resolve a PDH PhysicalDisk instance name to the drive letters it shares
/// with the sysinfo disk list, preserving PDH's letter order. Letters unknown
/// to sysinfo (e.g. a volume hidden from enumeration) are dropped; an instance
/// with no surviving letters has no sysinfo-visible disk and yields None.
/// The caller derives the stable disk key as `letters.join(" ")`. Shared by
/// `physical_disk_list()` and both loops of `poll_disk()` so the instance →
/// key mapping cannot drift between the sidebar and dashboard paths.
fn instance_to_known_letters(
    instance: &str,
    known: &HashMap<String, DriveLetterInfo>,
) -> Option<Vec<String>> {
    let letters: Vec<String> = pdh_instance_to_drive_letters(instance)
        .into_iter()
        .filter(|letter| known.contains_key(letter))
        .collect();
    if letters.is_empty() {
        None
    } else {
        Some(letters)
    }
}

/// Read \PhysicalDisk(*)\% Idle Time values and invert to active-time %.
/// active% = 100 - idle%  — same value Task Manager's disk graph displays.
pub fn query_disk_active_time(pdh: &crate::state::PdhHandles) -> HashMap<String, f64> {
    let counter = match pdh.disk_active_counter {
        Some(c) => c,
        None => return HashMap::new(),
    };

    crate::pdh::read_pdh_counter_array(counter)
        .into_iter()
        .filter_map(|(name, idle_pct)| {
            // _Total is the aggregate — skip it, we render per-disk cards.
            if name == "_Total" {
                return None;
            }
            // Invert idle% → active%. Clamp handles out-of-range values near startup.
            Some((name, (100.0 - idle_pct).clamp(0.0_f64, 100.0)))
        })
        .collect()
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
fn query_pdh_counter_array(
    counter: windows::Win32::System::Performance::PDH_HCOUNTER,
) -> HashMap<String, f64> {
    crate::pdh::read_pdh_counter_array(counter)
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

/// Returns one entry per physical disk, sorted by key so the order matches
/// `poll_disk`'s deterministically sorted display order (both feed card lists;
/// HashMap iteration order must never leak into UI ordering). Third element is
/// the sysinfo disk name for the first drive (used as fallback when WMI model
/// is unavailable). Used by the hardware profile so the sidebar shows the same
/// number of storage cards as the dashboard.
pub fn physical_disk_list(
    disks: &sysinfo::Disks,
    pdh: &crate::state::PdhHandles,
) -> Vec<PhysicalDiskEntry> {
    let known = known_drive_letters(disks);

    let mut result = Vec::new();
    for (instance_name, _pct_active) in query_disk_active_time(pdh) {
        let Some(mapped_letters) = instance_to_known_letters(&instance_name, &known) else {
            continue;
        };

        let disk_key = mapped_letters.join(" ");
        let kind = mapped_letters
            .first()
            .and_then(|letter| known.get(letter))
            .map(|info| info.kind)
            .unwrap_or(sysinfo::DiskKind::Unknown(0));
        let sysinfo_name = mapped_letters
            .first()
            .and_then(|letter| known.get(letter))
            .map(|info| info.name.clone())
            .unwrap_or_else(|| disk_key.clone());
        let drive_index = pdh_instance_to_drive_index(&instance_name);
        result.push((disk_key, kind, sysinfo_name, drive_index));
    }
    result.sort_by(|a, b| a.0.cmp(&b.0));
    result
}

/// Read disk metrics from PDH and sysinfo. Returns raw values for commit — no history writes.
pub fn poll_disk(disks: &mut sysinfo::Disks, pdh: &crate::state::PdhHandles) -> PollDiskResult {
    disks.refresh(false);

    let known = known_drive_letters(disks);

    let read_write = query_disk_read_write(pdh);
    let response_times = query_disk_response_time(pdh);

    let mut disk_active = HashMap::new();
    let mut disk_read_mb_s = HashMap::new();
    let mut disk_write_mb_s = HashMap::new();
    let mut disk_avg_response_ms = HashMap::new();
    let mut disk_display_order = Vec::new();

    for (instance_name, pct_active) in query_disk_active_time(pdh) {
        let Some(mapped_letters) = instance_to_known_letters(&instance_name, &known) else {
            continue;
        };

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
        let Some(letters) = instance_to_known_letters(instance_name, &known) else {
            continue;
        };
        let disk_key = letters.join(" ");
        if !disk_avg_response_ms.contains_key(&disk_key) && disk_active.contains_key(&disk_key) {
            disk_avg_response_ms.insert(disk_key.clone(), secs * 1000.0);
        }
    }

    // Sort deterministically so card order is stable across ticks regardless
    // of HashMap iteration order (which is non-deterministic).
    disk_display_order.sort();

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

    // --- disk_display_name ---

    fn model_map(entries: &[(u32, &str)]) -> HashMap<u32, String> {
        entries
            .iter()
            .map(|(i, m)| (*i, (*m).to_string()))
            .collect()
    }

    #[test]
    fn disk_display_name_prefers_the_wmi_model_for_the_index() {
        let models = model_map(&[(0, "Samsung SSD 990 PRO 2TB")]);
        assert_eq!(
            disk_display_name(Some(0), &models, "\\\\.\\PhysicalDrive0"),
            "Samsung SSD 990 PRO 2TB"
        );
    }

    #[test]
    fn disk_display_name_falls_back_when_index_is_absent_from_a_non_empty_map() {
        let models = model_map(&[(7, "WDC WD40EFRX")]);
        // Index 0 is missing from the map: another disk's model must not leak.
        assert_eq!(
            disk_display_name(Some(0), &models, "\\\\.\\PhysicalDrive0"),
            "\\\\.\\PhysicalDrive0"
        );
    }

    #[test]
    fn disk_display_name_falls_back_when_no_wmi_map_exists() {
        assert_eq!(
            disk_display_name(Some(0), &HashMap::new(), "\\\\.\\PhysicalDrive0"),
            "\\\\.\\PhysicalDrive0"
        );
        // And when the index itself is unknown (no drive index recorded).
        assert_eq!(
            disk_display_name(None, &model_map(&[(0, "x")]), "fallback"),
            "fallback"
        );
    }

    #[test]
    fn disk_display_name_ignores_a_blank_model() {
        let models = model_map(&[(0, "   ")]);
        assert_eq!(
            disk_display_name(Some(0), &models, "\\\\.\\PhysicalDrive0"),
            "\\\\.\\PhysicalDrive0"
        );
    }

    #[test]
    fn two_disks_sharing_a_model_keep_distinct_drive_letter_keys() {
        // Presentation-only guarantee: identical model strings must not
        // collapse two physical disks onto one identity.
        let models = model_map(&[(0, "Generic Disk"), (1, "Generic Disk")]);
        let name_a = disk_display_name(Some(0), &models, "\\\\.\\PhysicalDrive0");
        let name_b = disk_display_name(Some(1), &models, "\\\\.\\PhysicalDrive1");
        assert_eq!(name_a, name_b, "the model string is expected to be shared");
        // Keys come from the drive-letter join, never from the name.
        let key_a = pdh_instance_to_drive_letters("0 C:").join(" ");
        let key_b = pdh_instance_to_drive_letters("1 D:").join(" ");
        assert_eq!(key_a, "C:");
        assert_eq!(key_b, "D:");
        assert_ne!(key_a, key_b);
    }

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

    // --- instance_to_known_letters (shared instance → disk-key mapping) ---

    fn known_map(entries: &[(&str, sysinfo::DiskKind, &str)]) -> HashMap<String, DriveLetterInfo> {
        entries
            .iter()
            .map(|(letter, kind, name)| {
                (
                    letter.to_string(),
                    DriveLetterInfo {
                        kind: *kind,
                        name: name.to_string(),
                    },
                )
            })
            .collect()
    }

    #[test]
    fn test_instance_to_known_letters_single_drive() {
        let known = known_map(&[("C:", sysinfo::DiskKind::SSD, "Samsung SSD")]);
        assert_eq!(
            instance_to_known_letters("0 C:", &known),
            Some(vec!["C:".to_string()])
        );
    }

    #[test]
    fn test_instance_to_known_letters_multi_drive_preserves_pdh_order() {
        let known = known_map(&[
            ("C:", sysinfo::DiskKind::SSD, "a"),
            ("D:", sysinfo::DiskKind::HDD, "b"),
        ]);
        let letters = instance_to_known_letters("0 C: D:", &known).expect("both letters known");
        assert_eq!(letters, vec!["C:".to_string(), "D:".to_string()]);
        // The stable disk key is derived from these letters at both call sites.
        assert_eq!(letters.join(" "), "C: D:");
    }

    #[test]
    fn test_instance_to_known_letters_drops_unknown_volumes() {
        // D: exists in PDH but not in sysinfo's list — it must be filtered out
        // while the known letter survives, in original order.
        let known = known_map(&[("D:", sysinfo::DiskKind::HDD, "b")]);
        assert_eq!(
            instance_to_known_letters("0 C: D:", &known),
            Some(vec!["D:".to_string()])
        );
    }

    #[test]
    fn test_instance_to_known_letters_normalizes_case() {
        let known = known_map(&[("C:", sysinfo::DiskKind::SSD, "a")]);
        assert_eq!(
            instance_to_known_letters("0 c:", &known),
            Some(vec!["C:".to_string()])
        );
    }

    #[test]
    fn test_instance_to_known_letters_none_without_any_known_volume() {
        let known = known_map(&[("Z:", sysinfo::DiskKind::SSD, "a")]);
        assert_eq!(instance_to_known_letters("0 C: D:", &known), None);
        assert_eq!(instance_to_known_letters("_Total", &known), None);
        assert_eq!(instance_to_known_letters("1", &known), None);
        assert_eq!(instance_to_known_letters("", &known), None);
    }
}
