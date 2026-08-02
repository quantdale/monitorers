//! Real-hardware cadence verification (opt-in: `cargo test --ignored cadence_real_hardware`).
//!
//! Shells the built cadence probe for a bounded real run and asserts the
//! emission cadence invariants against real PDH/WMI/NVML sensors. Gated
//! `#[ignore]` because it needs a sensor-equipped Windows host and ~90s; the
//! default `cargo test` (which may lack sensors) is unaffected.

use sys_monitor_tauri::cadence::{check_records, parse_jsonl};

#[test]
#[ignore = "requires a sensor-equipped Windows host and ~90s"]
fn cadence_real_hardware() {
    let probe = env!("CARGO_BIN_EXE_cadence_probe");
    let output = std::process::Command::new(probe)
        .arg("--secs")
        .arg("90")
        .output()
        .expect("cadence_probe must execute");
    assert!(
        output.status.success(),
        "cadence_probe exited with {:?}\nstderr:\n{}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );

    let records = parse_jsonl(std::io::Cursor::new(output.stdout)).expect("probe JSONL must parse");
    let check = check_records(&records);
    print!("{}", check.render());
    assert!(
        check.passed(),
        "cadence invariants must hold on real hardware"
    );
}
