// ── HEADLESS CADENCE PROBE ───────────────────────────────────────────────────
// Runs the REAL collector tick loop for a bounded duration and streams one JSONL
// record per emitted snapshot to stdout, so an AI agent or CI can verify the
// 1Hz-history / 4Hz-liveness cadence against real hardware without a GUI.
//
//   cargo run --bin cadence_probe -- --secs 90 > cadence.jsonl   # probe only
//   cargo run --bin cadence_probe -- --check cadence.jsonl       # check a file
//   cargo run --bin cadence_probe -- --secs 90 --check -         # probe + self-check
//
// Built with default features (nvapi/nvml) so it exercises the same code path
// as the shipped app. Run on a sensor-equipped Windows host.

use std::io::Write;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use sys_monitor_tauri::cadence::{check_records, parse_jsonl, CadenceRecord};
use sys_monitor_tauri::collector::{physical_disk_list, query_disk_models_wmi, run_collector_loop};
use sys_monitor_tauri::hardware::{detect, DiskInfo, DiskKind};
use sys_monitor_tauri::sensor::{CpuSensorProvider, GpuSensorProvider, SensorRegistry};
use sys_monitor_tauri::state::{CollectorState, HistoryStore, SafeHistoryStore};

const DEFAULT_SECS: u64 = 90;
const MIN_SECS: u64 = 30;
// Production retries WMI with exponential backoff for a long-running app; a
// bounded probe must not stall on an unavailable WMI service, so it caps the
// retry budget and falls back to `wmi_con = None` (the collector tolerates it).
const WMI_ATTEMPTS: u32 = 3;
const WMI_RETRY_SECS: u64 = 1;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (secs, ticks_override, check_arg) = match parse_args(&args) {
        Ok(v) => v,
        Err(msg) => {
            eprintln!("[cadence_probe] {msg}");
            print_usage();
            std::process::exit(2);
        }
    };

    // `--check <path>`: verify an existing JSONL file; no probe run.
    if let Some(ref target) = check_arg {
        if target != "-" {
            let file = std::fs::File::open(target).unwrap_or_else(|e| {
                eprintln!("[cadence_probe] cannot open {target}: {e}");
                std::process::exit(2);
            });
            let records = match parse_jsonl(std::io::BufReader::new(file)) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[cadence_probe] {e}");
                    std::process::exit(2);
                }
            };
            let check = check_records(&records);
            print!("{}", check.render());
            std::process::exit(if check.passed() { 0 } else { 1 });
        }
    }

    // Probe run. Mirror production's MTA/COM threading on a background thread.
    let effective_secs = secs.max(MIN_SECS);
    let ticks: Option<u32> =
        Some(ticks_override.unwrap_or_else(|| (effective_secs * 4).min(u32::MAX as u64) as u32));

    // When `--check -`, also capture the emitted lines so this run can be
    // self-checked after the loop (probe+check in one command, 4.1).
    let capture_enabled = check_arg.as_deref() == Some("-");
    let (capture_tx, capture_rx) = mpsc::channel::<String>();

    let start = Instant::now();
    let worker = std::thread::spawn(move || {
        let wmi_con = connect_wmi();

        let mut collector_state = CollectorState::new();
        let cpu_name = collector_state
            .system
            .cpus()
            .first()
            .map(|c| c.brand().to_string())
            .unwrap_or_default();
        let cpu_name = if cpu_name.is_empty() {
            "CPU".to_string()
        } else {
            cpu_name
        };

        // Full profile (GPUs + physical-disk list), mirroring main.rs setup.
        let _ = sys_monitor_tauri::collector::collect_pdh(&collector_state);
        let physical = physical_disk_list(&collector_state.sysinfo_disks, &collector_state.pdh);
        let wmi_disk_models = query_disk_models_wmi(wmi_con.as_ref());
        let disk_infos: Option<Vec<DiskInfo>> = if physical.is_empty() {
            None
        } else {
            Some(
                physical
                    .into_iter()
                    .map(|(disk_key, kind, sysinfo_name, drive_index)| {
                        let display_name = drive_index
                            .and_then(|i| wmi_disk_models.get(&i).cloned())
                            .filter(|s| !s.is_empty())
                            .unwrap_or(sysinfo_name.clone());
                        let name = if display_name.is_empty() {
                            disk_key.clone()
                        } else {
                            display_name
                        };
                        let k = match kind {
                            sysinfo::DiskKind::SSD => DiskKind::Ssd,
                            sysinfo::DiskKind::HDD => DiskKind::Hdd,
                            _ => DiskKind::Unknown,
                        };
                        DiskInfo { name, kind: k }
                    })
                    .collect(),
            )
        };
        collector_state.profile = detect(Some(&collector_state.pdh), wmi_con.as_ref(), disk_infos);

        let store = SafeHistoryStore::new(HistoryStore::new(&cpu_name));
        let mut registry = SensorRegistry::new();
        registry.register(CpuSensorProvider);
        if !collector_state.profile.gpus.is_empty() {
            registry.register(GpuSensorProvider);
        }

        run_collector_loop(
            &mut collector_state,
            wmi_con.as_ref(),
            &mut registry,
            &store,
            ticks,
            None,
            |snap| {
                let elapsed_ms = start.elapsed().as_millis() as u64;
                let rec = CadenceRecord::from_snapshot(&store, snap.on_tick, elapsed_ms);
                let line = rec.to_json_line();
                println!("{line}");
                std::io::stdout().flush().ok();
                if capture_enabled {
                    let _ = capture_tx.send(line);
                }
            },
            |msg| eprintln!("[cadence_probe] collector-error: {msg}"),
        );
    });

    if let Err(e) = worker.join() {
        eprintln!("[cadence_probe] collector thread panicked: {e:?}");
        std::process::exit(2);
    }

    if capture_enabled {
        let lines: Vec<String> = capture_rx.iter().collect();
        let joined = lines.join("\n");
        let records = match parse_jsonl(std::io::Cursor::new(joined)) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[cadence_probe] {e}");
                std::process::exit(2);
            }
        };
        let check = check_records(&records);
        print!("{}", check.render());
        std::process::exit(if check.passed() { 0 } else { 1 });
    }
}

fn connect_wmi() -> Option<wmi::WMIConnection> {
    for attempt in 1..=WMI_ATTEMPTS {
        match wmi::COMLibrary::new() {
            Err(e) => {
                eprintln!("[cadence_probe] COMLibrary init failed (attempt {attempt}): {e}");
            }
            Ok(com) => match wmi::WMIConnection::new(com) {
                Ok(con) => return Some(con),
                Err(e) => {
                    eprintln!("[cadence_probe] WMI connect failed (attempt {attempt}): {e}");
                }
            },
        }
        if attempt < WMI_ATTEMPTS {
            std::thread::sleep(Duration::from_secs(WMI_RETRY_SECS));
        }
    }
    eprintln!(
        "[cadence_probe] WMI unavailable — continuing with wmi_con = None (collector tolerates this)"
    );
    None
}

fn parse_args(args: &[String]) -> Result<(u64, Option<u32>, Option<String>), String> {
    let mut secs = DEFAULT_SECS;
    let mut ticks: Option<u32> = None;
    let mut check: Option<String> = None;
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                print_usage();
                std::process::exit(0);
            }
            "--secs" => {
                let v = it.next().ok_or("--secs requires a value")?;
                secs = v
                    .parse()
                    .map_err(|_| format!("invalid --secs value: {v}"))?;
            }
            "--ticks" => {
                let v = it.next().ok_or("--ticks requires a value")?;
                ticks = Some(
                    v.parse()
                        .map_err(|_| format!("invalid --ticks value: {v}"))?,
                );
            }
            "--check" => {
                let v = it
                    .next()
                    .ok_or("--check requires a path (or '-' for self-check)")?;
                check = Some(v.clone());
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok((secs, ticks, check))
}

fn print_usage() {
    eprintln!(
        "usage: cadence_probe [--secs <n>] [--ticks <n>] [--check <file|-|>]

  --secs <n>   run for n seconds (default 90, min 30); maps to ticks = n*4
  --ticks <n>  override the number of collector ticks (each ~250ms)
  --check <f>  check a JSONL file instead of running; use '-' to self-check this run
  --help       show this help"
    );
}
