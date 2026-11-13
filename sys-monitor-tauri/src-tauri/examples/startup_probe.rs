// ── HEADLESS STARTUP-COST PROBE (cargo example) ──────────────────────────────
// Times the real session-bootstrap sequence (`run_session_body` minus the tick
// loop): CollectorState::new() plus the post-state hardware-profile discovery,
// so startup regressions and duplicate-OS-enumeration fixes are measurable on
// real hardware without a GUI.
//
//   cargo run --example startup_probe            # 5 samples, median reported
//   cargo run --example startup_probe -- -n 9    # explicit sample count
//
// Built with default features (nvapi/nvml) so it exercises the same code path
// as the shipped app. Run on a sensor-equipped Windows host.

use std::time::Instant;

use sys_monitor_tauri::collector::physical_disk_list;
use sys_monitor_tauri::hardware::{detect_with_cpu, DiskInfo, DiskKind};
use sys_monitor_tauri::state::CollectorState;

fn median(samples: &mut [u128]) -> u128 {
    samples.sort_unstable();
    samples[samples.len() / 2]
}

fn bootstrap_medians(state_costs: &mut [u128], profile_costs: &mut [u128]) -> (u128, u128, u128) {
    // Pair observations while iteration identity is intact; median sorts.
    let mut totals: Vec<u128> = state_costs
        .iter()
        .zip(profile_costs.iter())
        .map(|(a, b)| a + b)
        .collect();
    let state = median(state_costs);
    let profile = median(profile_costs);
    (state, profile, median(&mut totals))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let iterations: usize = match args.first().map(String::as_str) {
        Some("-n") => args.get(1).and_then(|v| v.parse().ok()).unwrap_or(5).max(1),
        _ => 5,
    };

    // Mechanism evidence: the per-instance cost of the enumerations the
    // bootstrap previously repeated (fresh System for the CPU brand, fresh
    // Disks for the profile list).
    let mut system_costs = Vec::new();
    let mut disks_costs = Vec::new();
    for _ in 0..iterations {
        let started = Instant::now();
        let mut sys = sysinfo::System::new();
        sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
        system_costs.push(started.elapsed().as_micros());
        let started = Instant::now();
        let _probe_disks = sysinfo::Disks::new_with_refreshed_list();
        disks_costs.push(started.elapsed().as_micros());
    }
    println!(
        "mechanism: System::new + refresh_cpu_list   median {} us",
        median(&mut system_costs)
    );
    println!(
        "mechanism: Disks::new_with_refreshed_list   median {} us",
        median(&mut disks_costs)
    );

    // End-to-end session bootstrap, mirroring run_session_body's sequence.
    let mut state_costs = Vec::new();
    let mut profile_costs = Vec::new();
    for _ in 0..iterations {
        let started = Instant::now();
        let mut collector_state = CollectorState::new();
        state_costs.push(started.elapsed().as_millis());

        let started = Instant::now();
        let physical = physical_disk_list(&collector_state.sysinfo_disks, &collector_state.pdh);
        let disk_infos: Option<Vec<DiskInfo>> = if physical.is_empty() {
            None
        } else {
            Some(
                physical
                    .iter()
                    .map(|(disk_key, kind, sysinfo_name, _drive_index)| {
                        let k = match kind {
                            sysinfo::DiskKind::SSD => DiskKind::Ssd,
                            sysinfo::DiskKind::HDD => DiskKind::Hdd,
                            _ => DiskKind::Unknown,
                        };
                        DiskInfo {
                            key: disk_key.clone(),
                            name: sysinfo_name.clone(),
                            kind: k,
                        }
                    })
                    .collect(),
            )
        };
        collector_state.profile = detect_with_cpu(
            Some(&collector_state.pdh),
            disk_infos,
            &collector_state.cpu_identity,
        );
        profile_costs.push(started.elapsed().as_millis());
    }

    let (state_median, profile_median, total_median) =
        bootstrap_medians(&mut state_costs, &mut profile_costs);
    println!(
        "session bootstrap: CollectorState::new      median {} ms",
        state_median
    );
    println!(
        "session bootstrap: profile discovery        median {} ms",
        profile_median
    );
    println!(
        "session bootstrap: TOTAL                    median {} ms",
        total_median
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_total_pairs_phases_before_sorting_them() {
        // Real totals are 110, 110, 70: median 110. Sorting the phases
        // independently first invents 20, 70, 200 and incorrectly reports 70.
        let mut state = [10, 100, 50];
        let mut profile = [100, 10, 20];
        assert_eq!(bootstrap_medians(&mut state, &mut profile), (50, 20, 110));
    }
}
