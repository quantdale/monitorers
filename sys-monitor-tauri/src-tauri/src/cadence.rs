// ── CADENCE VERIFICATION RECORDS & CHECKER ────────────────────────────────────
// Shared by the headless probe (examples/cadence_probe.rs), the optional
// production dev tap (main.rs, SYSMON_CADENCE_LOG), and the #[ignore]d
// real-hardware integration test (tests/cadence_hardware.rs).
//
// The cadence is a fixed ratio: the deadline scheduler targets 250ms and
// commits history on every 4th tick. A bounded real-hardware run must observe
// at least 60 seconds so both ratio and wall-clock SLOs are meaningful.

use crate::collector::run_loop::TickTiming;
use crate::state::SafeHistoryStore;

pub const MIN_OBSERVATION_MS: u64 = 60_000;

/// One JSONL line emitted per snapshot by the cadence probe (and by the
/// production dev tap when `SYSMON_CADENCE_LOG` is set).
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(default)]
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
    /// Number of GPU entries represented by `gpu_total_len` at this point.
    pub gpu_count: usize,
    /// Real timestamp span in the history ring, in milliseconds.
    pub timestamp_span_ms: u64,
    /// Time spent in the collector body before emit, in milliseconds.
    pub work_duration_ms: u64,
    /// How late this tick started relative to its scheduled deadline.
    pub deadline_overrun_ms: u64,
    /// WMI bootstrap/enrichment time in this tick, when attempted.
    pub wmi_duration_ms: u64,
    /// Full PDH/sysinfo poll time; zero on registry-only ticks.
    pub full_poll_duration_ms: u64,
    /// Registry provider time; zero on full ticks.
    pub registry_duration_ms: u64,
    /// Duration for the short HistoryStore lock/commit/build section.
    pub history_lock_duration_us: u64,
}

impl CadenceRecord {
    /// Builds a record by briefly locking the store — the loop has already
    /// released its lock when it invokes the emit sink (3.3).
    pub fn from_snapshot(
        store: &SafeHistoryStore,
        on_tick: bool,
        elapsed_ms: u64,
        timing: TickTiming,
    ) -> Self {
        let s = store.lock().unwrap_or_else(|e| e.into_inner());
        let timestamp_span_ms = s
            .timestamps
            .front()
            .zip(s.timestamps.back())
            .map(|(first, last)| last.saturating_sub(*first))
            .unwrap_or(0);
        Self {
            elapsed_ms,
            on_tick,
            cpu_len: s.cpu_history.len(),
            gpu_total_len: s.gpu_entries.iter().map(|(_, _, h)| h.len()).sum(),
            ts_len: s.timestamps.len(),
            gpu_count: s.gpu_entries.len(),
            timestamp_span_ms,
            work_duration_ms: timing.work_duration.as_millis() as u64,
            deadline_overrun_ms: timing.deadline_overrun.as_millis() as u64,
            wmi_duration_ms: timing.wmi_duration.as_millis() as u64,
            full_poll_duration_ms: timing.full_poll_duration.as_millis() as u64,
            registry_duration_ms: timing.registry_duration.as_millis() as u64,
            history_lock_duration_us: timing.history_lock_duration.as_micros() as u64,
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
    pub p50_interval_ms: u64,
    pub p95_interval_ms: u64,
    pub max_interval_ms: u64,
    pub p50_full_interval_ms: u64,
    pub p95_full_interval_ms: u64,
    pub max_full_interval_ms: u64,
    pub on_tick_count: usize,
    pub expected_on_tick: usize,
    pub final_cpu_len: usize,
    pub final_ts_len: usize,
    pub final_gpu_total_len: usize,
    pub timestamp_span_ms: u64,
    pub observation_ms: u64,
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
            "{verdict}\ntotal_records={} observation_ms={} mean_interval_ms={:.1} event_interval_ms={{p50:{} p95:{} max:{}}} full_interval_ms={{p50:{} p95:{} max:{}}} on_tick_count={} (expected {} ± 1) cpu_len={} ts_len={} gpu_total_len={} timestamp_span_ms={} elapsed_whole_secs={}\n",
            self.total_records,
            self.observation_ms,
            self.mean_interval_ms,
            self.p50_interval_ms,
            self.p95_interval_ms,
            self.max_interval_ms,
            self.p50_full_interval_ms,
            self.p95_full_interval_ms,
            self.max_full_interval_ms,
            self.on_tick_count,
            self.expected_on_tick,
            self.final_cpu_len,
            self.final_ts_len,
            self.final_gpu_total_len,
            self.timestamp_span_ms,
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

/// Asserts both cadence-ratio and wall-clock fidelity over a probe run.
///
/// The ratio checks alone are intentionally insufficient: a loop that emits
/// every 750ms can still preserve a perfect 4:1 pattern. The wall-clock SLOs
/// below describe the intended scheduler behavior on a healthy Windows host:
/// event p50 200–350ms, p95 <=500ms, no interval below 150ms or above 1500ms;
/// full-tick p50 800–1200ms, p95 <=1800ms, and max <=2500ms. A real
/// verification run must observe at least 60 seconds, and committed history
/// must cover that elapsed duration within a small measurement tolerance.
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
    let intervals: Vec<u64> = records
        .windows(2)
        .map(|w| w[1].elapsed_ms.saturating_sub(w[0].elapsed_ms))
        .collect();
    let mean_interval_ms = if deltas == 0 {
        0.0
    } else {
        sum_delta as f64 / deltas as f64
    };
    let mut sorted_intervals = intervals.clone();
    sorted_intervals.sort_unstable();
    let p50_interval_ms = percentile(&sorted_intervals, 0.50);
    let p95_interval_ms = percentile(&sorted_intervals, 0.95);
    let max_interval_ms = sorted_intervals.last().copied().unwrap_or(0);

    if total_records == 0 {
        failures.push("no records — probe produced no output".to_string());
    } else if total_records < 2 {
        failures.push("fewer than two records — cadence distribution is unmeasurable".to_string());
    } else {
        if !(200..=350).contains(&p50_interval_ms) {
            failures.push(format!(
                "event interval p50 {p50_interval_ms}ms outside 200–350ms SLO"
            ));
        }
        if p95_interval_ms > 500 {
            failures.push(format!(
                "event interval p95 {p95_interval_ms}ms > 500ms SLO"
            ));
        }
        if sorted_intervals.first().copied().unwrap_or(0) < 150 {
            failures.push("event interval below 150ms — catch-up/spin detected".to_string());
        }
        if max_interval_ms > 1_500 {
            failures.push(format!(
                "event interval max {max_interval_ms}ms > 1500ms liveness SLO"
            ));
        }
    }

    let full_intervals: Vec<u64> = records
        .iter()
        .filter(|record| record.on_tick)
        .map(|record| record.elapsed_ms)
        .collect::<Vec<_>>()
        .windows(2)
        .map(|w| w[1].saturating_sub(w[0]))
        .collect();
    let mut sorted_full_intervals = full_intervals.clone();
    sorted_full_intervals.sort_unstable();
    let p50_full_interval_ms = percentile(&sorted_full_intervals, 0.50);
    let p95_full_interval_ms = percentile(&sorted_full_intervals, 0.95);
    let max_full_interval_ms = sorted_full_intervals.last().copied().unwrap_or(0);
    if !sorted_full_intervals.is_empty() {
        if !(800..=1_200).contains(&p50_full_interval_ms) {
            failures.push(format!(
                "full-history interval p50 {p50_full_interval_ms}ms outside 800–1200ms SLO"
            ));
        }
        if p95_full_interval_ms > 1_800 {
            failures.push(format!(
                "full-history interval p95 {p95_full_interval_ms}ms > 1800ms SLO"
            ));
        }
        if max_full_interval_ms > 2_500 {
            failures.push(format!(
                "full-history interval max {max_full_interval_ms}ms > 2500ms SLO"
            ));
        }
    }

    let observation_ms = records
        .first()
        .zip(records.last())
        .map(|(first, last)| last.elapsed_ms.saturating_sub(first.elapsed_ms))
        .unwrap_or(0);
    if observation_ms < MIN_OBSERVATION_MS {
        failures.push(format!(
            "observation {observation_ms}ms < minimum {MIN_OBSERVATION_MS}ms"
        ));
    }

    // (B) on_tick cadence ≈ 1 Hz.
    let on_tick_count = records.iter().filter(|r| r.on_tick).count();
    let expected_on_tick = total_records.div_ceil(4);
    if (on_tick_count as isize - expected_on_tick as isize).unsigned_abs() > 1 {
        failures.push(format!(
            "on_tick count {on_tick_count} != total/4 (rounded up) {expected_on_tick} ± 1"
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

    // (D) Every aligned history channel advances only on full ticks.
    let final_cpu_len = records.last().map(|r| r.cpu_len).unwrap_or(0);
    let final_ts_len = records.last().map(|r| r.ts_len).unwrap_or(0);
    let final_gpu_total_len = records.last().map(|r| r.gpu_total_len).unwrap_or(0);
    let timestamp_span_ms = records.last().map(|r| r.timestamp_span_ms).unwrap_or(0);
    if final_cpu_len != on_tick_count {
        failures.push(format!(
            "final cpu_len {final_cpu_len} != on_tick_count {on_tick_count} (history length must equal full-tick count)"
        ));
    }
    if final_ts_len != on_tick_count {
        failures.push(format!(
            "final ts_len {final_ts_len} != on_tick_count {on_tick_count} (timestamp history is not aligned)"
        ));
    }
    for (i, w) in records.windows(2).enumerate() {
        let cpu_delta = w[1].cpu_len as isize - w[0].cpu_len as isize;
        let ts_delta = w[1].ts_len as isize - w[0].ts_len as isize;
        let expected = if w[1].on_tick { 1 } else { 0 };
        if cpu_delta != expected || ts_delta != expected {
            failures.push(format!(
                "record {}: aligned history deltas cpu={cpu_delta} timestamps={ts_delta}, expected {expected}",
                i + 1
            ));
            break;
        }
        let gpu_delta = w[1].gpu_total_len as isize - w[0].gpu_total_len as isize;
        if !w[1].on_tick && gpu_delta != 0 {
            failures.push(format!(
                "record {}: GPU history grew by {gpu_delta} on an off-tick",
                i + 1
            ));
            break;
        }
        if w[1].on_tick {
            let expected_gpu = w[1].gpu_count as isize;
            if gpu_delta != expected_gpu {
                failures.push(format!(
                    "record {}: GPU history delta {gpu_delta} != active GPU count {expected_gpu}",
                    i + 1
                ));
                break;
            }
        }
    }

    // (E) Real elapsed-time coverage. This is the check that rejects a slow
    // 4:1 loop: history length must track seconds, not just emitted samples.
    if observation_ms >= MIN_OBSERVATION_MS {
        let expected_history = observation_ms / 1_000 + 1;
        let tolerance = 2.max(expected_history / 20);
        if final_cpu_len.abs_diff(expected_history as usize) > tolerance as usize {
            failures.push(format!(
                "final cpu_len {final_cpu_len} does not cover elapsed time: expected about {expected_history} ± {tolerance} points over {observation_ms}ms"
            ));
        }
        if timestamp_span_ms > 0 {
            let timestamp_tolerance = 2_000.max(observation_ms / 20);
            if timestamp_span_ms.abs_diff(observation_ms) > timestamp_tolerance {
                failures.push(format!(
                    "timestamp span {timestamp_span_ms}ms differs from monotonic observation {observation_ms}ms by more than {timestamp_tolerance}ms"
                ));
            }
        }
    }

    let elapsed_whole_secs = records.last().map(|r| r.elapsed_ms / 1000).unwrap_or(0);

    CadenceCheck {
        total_records,
        mean_interval_ms,
        p50_interval_ms,
        p95_interval_ms,
        max_interval_ms,
        p50_full_interval_ms,
        p95_full_interval_ms,
        max_full_interval_ms,
        on_tick_count,
        expected_on_tick,
        final_cpu_len,
        final_ts_len,
        final_gpu_total_len,
        timestamp_span_ms,
        observation_ms,
        elapsed_whole_secs,
        failures,
    }
}

fn percentile(sorted: &[u64], quantile: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let index = ((sorted.len() - 1) as f64 * quantile).round() as usize;
    sorted[index.min(sorted.len() - 1)]
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
            gpu_count: 0,
            timestamp_span_ms: elapsed_ms,
            work_duration_ms: 1,
            deadline_overrun_ms: 0,
            wmi_duration_ms: 0,
            full_poll_duration_ms: 0,
            registry_duration_ms: 0,
            history_lock_duration_us: 0,
        }
    }

    // A synthetic 60-second run that respects every invariant must PASS.
    #[test]
    fn test_checker_passes_on_correct_cadence_fixture() {
        let records: Vec<CadenceRecord> = (0..241usize)
            .map(|i| {
                let on_tick = i % 4 == 0;
                rec(i as u64 * 250, on_tick, (i / 4) + 1)
            })
            .collect();
        let check = check_records(&records);
        assert!(check.passed(), "failures: {:?}", check.failures);
        assert_eq!(check.total_records, 241);
        assert_eq!(check.on_tick_count, 61);
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
    fn test_checker_rejects_slow_perfect_ratio_that_old_checker_accepted() {
        // Every fourth record is still a full tick, but the whole run emits
        // every 750ms. Ratio-only checking would pass this fixture; the
        // wall-clock SLO and elapsed-history coverage must reject it.
        let records: Vec<CadenceRecord> = (0..81usize)
            .map(|i| {
                let on_tick = i % 4 == 0;
                rec(i as u64 * 750, on_tick, (i / 4) + 1)
            })
            .collect();
        let check = check_records(&records);
        assert!(!check.passed());
        assert!(check
            .failures
            .iter()
            .any(|failure| failure.contains("event interval p50")
                || failure.contains("does not cover elapsed")));
    }

    #[test]
    fn test_checker_rejects_full_tick_interval_outlier() {
        let records: Vec<CadenceRecord> = (0..241usize)
            .map(|i| {
                let elapsed = i as u64 * 250 + if i >= 8 { 3_000 } else { 0 };
                rec(elapsed, i % 4 == 0, (i / 4) + 1)
            })
            .collect();
        let check = check_records(&records);
        assert!(!check.passed());
        assert!(check
            .failures
            .iter()
            .any(|failure| failure.contains("full-history interval max")));
    }

    #[test]
    fn test_checker_rejects_too_short_observation() {
        let records: Vec<CadenceRecord> = (0..20usize)
            .map(|i| rec(i as u64 * 250, i % 4 == 0, (i / 4) + 1))
            .collect();
        let check = check_records(&records);
        assert!(!check.passed());
        assert!(check
            .failures
            .iter()
            .any(|failure| failure.contains("minimum")));
    }

    #[test]
    fn test_checker_rejects_catch_up_burst() {
        let mut elapsed = 0_u64;
        let records: Vec<CadenceRecord> = (0..241usize)
            .map(|i| {
                let current = elapsed;
                elapsed += if i % 2 == 0 { 100 } else { 400 };
                rec(current, i % 4 == 0, (i / 4) + 1)
            })
            .collect();
        let check = check_records(&records);
        assert!(!check.passed());
        assert!(check
            .failures
            .iter()
            .any(|failure| failure.contains("below 150ms")));
    }

    #[test]
    fn test_checker_rejects_timestamp_history_that_does_not_cover_elapsed_time() {
        let mut records: Vec<CadenceRecord> = (0..241usize)
            .map(|i| rec(i as u64 * 250, i % 4 == 0, (i / 4) + 1))
            .collect();
        records
            .last_mut()
            .expect("fixture is non-empty")
            .timestamp_span_ms = 1_000;
        let check = check_records(&records);
        assert!(!check.passed());
        assert!(check
            .failures
            .iter()
            .any(|failure| failure.contains("timestamp span")));
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

    // --- percentile (nearest-rank over pre-sorted input) ---

    #[test]
    fn test_percentile_empty_returns_zero_and_single_passes_through() {
        assert_eq!(percentile(&[], 0.5), 0);
        assert_eq!(percentile(&[42], 0.95), 42);
    }

    #[test]
    fn test_percentile_bounds_and_median_of_sorted_input() {
        let sorted = [10_u64, 20, 30, 40, 50];
        assert_eq!(percentile(&sorted, 0.0), 10);
        assert_eq!(percentile(&sorted, 0.50), 30);
        assert_eq!(percentile(&sorted, 0.95), 50);
        assert_eq!(percentile(&sorted, 1.0), 50);
    }
}
