//! Real-hardware cadence verification (opt-in: `cargo test --ignored cadence_real_hardware`).
//!
//! Shells the built cadence probe for a bounded real run and asserts the
//! emission cadence invariants against real PDH/WMI/NVML sensors. Gated
//! `#[ignore]` because it needs a sensor-equipped Windows host and ~90s; the
//! default `cargo test` (which may lack sensors) is unaffected.
//!
//! The probe lives as a cargo EXAMPLE (not a bin) so the shipped app crate has
//! exactly one binary — multiple bins corrupt Tauri bundling — so build it
//! first: `cargo build --example cadence_probe`.

use sys_monitor_tauri::cadence::{check_records, parse_jsonl};

fn probe_exe() -> std::path::PathBuf {
    let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target");
    for profile in ["debug", "release"] {
        let candidate = target
            .join(profile)
            .join("examples")
            .join(format!("cadence_probe{}", std::env::consts::EXE_SUFFIX));
        if candidate.exists() {
            return candidate;
        }
    }
    panic!("cadence_probe example not built; run: cargo build --example cadence_probe");
}

#[test]
#[ignore = "requires a sensor-equipped Windows host and ~90s"]
fn cadence_real_hardware() {
    let probe = probe_exe();
    let output = std::process::Command::new(&probe)
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
