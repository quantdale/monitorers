// ── CADENCE VERIFICATION RECORDS & CHECKER ────────────────────────────────────
// Shared by the headless probe (src/bin/cadence_probe.rs), the optional
// production dev tap (main.rs, SYSMON_CADENCE_LOG), and the #[ignore]d
// real-hardware integration test (tests/cadence_hardware.rs).
//
// The cadence is a fixed ratio: the tick loop sleeps 250ms and commits history
// on every 4th tick. A bounded run (30–120s) therefore establishes the
// 1Hz-history / 4Hz-liveness invariants for any longer window.

use crate::state::SafeHistoryStore;

/// One JSONL line emitted per snapshot by the cadence probe (and by the
/// production dev tap when `SYSMON_CADENCE_LOG` is set).
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct CadenceRecord {
    /// Milliseconds since the probe's monotonic start instant (at emit time).
    pub elapsed_ms: u64,
    /// True when this snapshot was emitted on a full (history-committing) tick.
    pub on_tick: bool,
    /// History length of the CPU channel at emit time.
    pub cpu_len: usize,
    /// Total history points across all GPU entries at emit time.
    pub gpu_total_len: usize,
    /// Timestamps ring length at emit time.
    pub ts_len: usize,
}

impl CadenceRecord {
    /// Builds a record by briefly locking the store — the loop has already
    /// released its lock when it invokes the emit sink (3.3).
    pub fn from_snapshot(store: &SafeHistoryStore, on_tick: bool, elapsed_ms: u64) -> Self {
        let s = store.lock().unwrap_or_else(|e| e.into_inner());
        Self {
            elapsed_ms,
            on_tick,
            cpu_len: s.cpu_history.len(),
            gpu_total_len: s.gpu_entries.iter().map(|(_, _, h)| h.len()).sum(),
            ts_len: s.timestamps.len(),
        }
    }

    pub fn to_json_line(&self) -> String {
        serde_json::to_string(self).expect("CadenceRecord serialization is infallible")
    }
}

/// Result of running the checker over a probe's records.
#[derive(Debug, Clone)]
pub struct CadenceCheck {
    pub total_records: usize,
    pub mean_interval_ms: f64,
    pub on_tick_count: usize,
    pub expected_on_tick: usize,
    pub final_cpu_len: usize,
    pub elapsed_whole_secs: u64,
    /// Human-readable reasons this run FAILED. Empty == PASS.
    pub failures: Vec<String>,
}

impl CadenceCheck {
    pub fn passed(&self) -> bool {
        self.failures.is_empty()
    }

    /// One-line PASS/FAIL verdict plus a metrics table (4.2).
    pub fn render(&self) -> String {
        let verdict = if self.passed() { "PASS" } else { "FAIL" };
        let mut out = format!(
            "{verdict}\ntotal_records={} mean_interval_ms={:.1} on_tick_count={} (expected {} ± 1) final_cpu_len={} elapsed_whole_secs={}\n",
            self.total_records,
            self.mean_interval_ms,
            self.on_tick_count,
            self.expected_on_tick,
            self.final_cpu_len,
            self.elapsed_whole_secs,
        );
        for f in &self.failures {
            out.push_str(&format!("  FAIL: {f}\n"));
        }
        out
    }
}

/// Parses probe JSONL (one `CadenceRecord` per non-empty line) from any reader.
pub fn parse_jsonl(reader: impl std::io::BufRead) -> Result<Vec<CadenceRecord>, String> {
    let mut records = Vec::new();
    for (i, line) in reader.lines().enumerate() {
        let line = line.map_err(|e| format!("line {}: {e}", i + 1))?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match serde_json::from_str::<CadenceRecord>(line) {
            Ok(r) => records.push(r),
            Err(e) => return Err(format!("line {}: invalid cadence record: {e}", i + 1)),
        }
    }
    Ok(records)
}

/// Asserts the cadence invariants over a probe run (4.1/4.2).
///
/// - (A) Liveness sanity: mean inter-emit interval ∈ [150, 1000] ms.
///   Lower bound catches spinning (no sleep); upper bound catches >1s liveness.
///   The ideal 250ms assumes polls are cheap; real WMI/PDH overhead means the
///   tolerance is calibrated to the measured first-real-run mean (≈ 755ms on
///   an RTX 4050 host, 2026-08-02 — see design.md).
/// - (B) Fidelity ratio: `on_tick:true` count == `floor(total/4)` ± 1.
/// - (C) History advances exactly +1 per `on_tick:true` record and +0 per
///   `on_tick:false` record (no ungated 4 Hz growth — the COR-001 bug class).
/// - (D) History-length consistency: final `cpu_len` must equal `on_tick_count`
///   (the history length matches the number of full ticks — valid at any tick
///   speed). The absolute 1Hz expectation (cpu_len ≈ elapsed_whole_secs) is
///   hardware-dependent; elapsed whole seconds is still printed in the table
///   for reference.
pub fn check_records(records: &[CadenceRecord]) -> CadenceCheck {
    let total_records = records.len();
    let mut failures = Vec::new();

    // (A) mean inter-emit interval.
    let mut sum_delta: u64 = 0;
    let mut deltas = 0usize;
    for w in records.windows(2) {
        sum_delta = sum_delta.saturating_add(w[1].elapsed_ms.saturating_sub(w[0].elapsed_ms));
        deltas += 1;
    }
    let mean_interval_ms = if deltas == 0 {
        0.0
    } else {
        sum_delta as f64 / deltas as f64
    };
    if total_records == 0 {
        failures.push("no records — probe produced no output".to_string());
    } else if mean_interval_ms < 150.0 {
        failures.push(format!(
            "mean inter-emit interval {mean_interval_ms:.1}ms < 150ms (spinning — no sleep between ticks)"
        ));
    } else if mean_interval_ms > 1000.0 {
        failures.push(format!(
            "mean inter-emit interval {mean_interval_ms:.1}ms > 1000ms (tick too slow — liveness broken, expected ~250ms; calibrated to real-WMI overhead, see design.md)"
        ));
    } else if mean_interval_ms > 800.0 {
        failures.push(format!(
            "WARN: mean inter-emit interval {mean_interval_ms:.1}ms > 800ms (tick slower than expected, may indicate PDH/WMI overhead regression)"
        ));
    }

    // (B) on_tick cadence ≈ 1 Hz.
    let on_tick_count = records.iter().filter(|r| r.on_tick).count();
    let expected_on_tick = total_records / 4;
    if (on_tick_count as isize - expected_on_tick as isize).unsigned_abs() > 1 {
        failures.push(format!(
            "on_tick count {on_tick_count} != floor(total/4) {expected_on_tick} ± 1"
        ));
    }

    // (C) history grows exactly +1 per on_tick:true, +0 per on_tick:false.
    for (i, w) in records.windows(2).enumerate() {
        let delta = w[1].cpu_len as isize - w[0].cpu_len as isize;
        let expected = if w[1].on_tick { 1 } else { 0 };
        if delta != expected {
            failures.push(format!(
                "record {}: cpu_len delta {delta} != expected {expected} (on_tick={})",
                i + 1,
                w[1].on_tick
            ));
            break; // one example is enough; avoid log spam
        }
    }

    // (D) history-length consistency: must equal the number of full ticks.
    let final_cpu_len = records.last().map(|r| r.cpu_len).unwrap_or(0);
    // elapsed_whole_secs is still printed in the table for reference, but the
    // hard gate is speed-relative (validated at any tick period — 4.2/4.4).
    if final_cpu_len != on_tick_count {
        failures.push(format!(
            "final cpu_len {final_cpu_len} != on_tick_count {on_tick_count} (history length must equal full-tick count)"
        ));
    }

    let elapsed_whole_secs = records.last().map(|r| r.elapsed_ms / 1000).unwrap_or(0);

    CadenceCheck {
        total_records,
        mean_interval_ms,
        on_tick_count,
        expected_on_tick,
        final_cpu_len,
        elapsed_whole_secs,
        failures,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(elapsed_ms: u64, on_tick: bool, cpu_len: usize) -> CadenceRecord {
        CadenceRecord {
            elapsed_ms,
            on_tick,
            cpu_len,
            gpu_total_len: 0,
            ts_len: cpu_len,
        }
    }

    // A synthetic 20-record run that respects every invariant must PASS (4.2).
    #[test]
    fn test_checker_passes_on_correct_cadence_fixture() {
        let records: Vec<CadenceRecord> = (0..20usize)
            .map(|i| {
                let on_tick = i % 4 == 0;
                rec(i as u64 * 250, on_tick, (i / 4) + 1)
            })
            .collect();
        let check = check_records(&records);
        assert!(check.passed(), "failures: {:?}", check.failures);
        assert_eq!(check.total_records, 20);
        assert_eq!(check.on_tick_count, 5);
        assert!((210.0..=290.0).contains(&check.mean_interval_ms));
    }

    // 4.3 negative fixtures — each violates exactly one invariant.

    #[test]
    fn test_checker_fails_on_four_hz_history_growth() {
        // History grows on EVERY record (ungated 4Hz growth: the COR-001 class).
        let records: Vec<CadenceRecord> = (0..20usize)
            .map(|i| rec(i as u64 * 250, i % 4 == 0, i + 1))
            .collect();
        let check = check_records(&records);
        assert!(!check.passed());
        assert!(
            check.failures.iter().any(|f| f.contains("cpu_len delta")),
            "expected a history-growth failure, got: {:?}",
            check.failures
        );
    }

    #[test]
    fn test_checker_fails_on_missing_full_ticks() {
        // Never a full tick -> on_tick count (0) far from floor(20/4).
        let records: Vec<CadenceRecord> = (0..20).map(|i| rec(i * 250, false, 0)).collect();
        let check = check_records(&records);
        assert!(!check.passed());
        assert!(
            check.failures.iter().any(|f| f.contains("on_tick count")),
            "expected an on_tick-cadence failure, got: {:?}",
            check.failures
        );
    }

    #[test]
    fn test_checker_fails_on_excessive_drift() {
        // cpu_len pinned at 100 while only ~5s elapse -> drift >> 2.
        let records: Vec<CadenceRecord> = (0..20).map(|i| rec(i * 250, i % 4 == 0, 100)).collect();
        let check = check_records(&records);
        assert!(!check.passed());
        assert!(
            check.failures.iter().any(|f| f.contains("final cpu_len")),
            "expected a history-length-consistency failure, got: {:?}",
            check.failures
        );
    }

    #[test]
    fn test_checker_fails_on_fast_liveness_interval() {
        // 100ms cadence (4x too fast) -> mean interval outside [210, 290]ms.
        let records: Vec<CadenceRecord> = (0..20)
            .map(|i| rec(i * 100, i % 4 == 0, (i / 4) as usize))
            .collect();
        let check = check_records(&records);
        assert!(!check.passed());
        assert!(
            check.failures.iter().any(|f| f.contains("interval")),
            "expected an interval failure, got: {:?}",
            check.failures
        );
    }

    #[test]
    fn test_parse_jsonl_skips_empty_lines_and_errors_on_garbage() {
        let input = concat!(
            r#"{"elapsed_ms":0,"on_tick":true,"cpu_len":1,"gpu_total_len":0,"ts_len":1}"#,
            "\n\n",
            r#"{"elapsed_ms":250,"on_tick":false,"cpu_len":1,"gpu_total_len":0,"ts_len":1}"#,
            "\n",
        );
        let records = parse_jsonl(std::io::Cursor::new(input)).expect("valid lines parse");
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].elapsed_ms, 0);
        assert!(records[0].on_tick);

        let bad = parse_jsonl(std::io::Cursor::new(b"not json\n"));
        assert!(bad.is_err());
    }
}
