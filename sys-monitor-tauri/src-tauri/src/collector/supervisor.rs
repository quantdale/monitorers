// ── COLLECTOR SUPERVISOR ─────────────────────────────────────────────────────
// Replaces the historical fail-stop contract (one panic => "restart the app")
// with a supervised session lifecycle:
//
//   Starting → Healthy → Recovering → Healthy
//                    ↘ Failed → (manual retry) → Recovering/Healthy
//
// The supervisor owns exactly one live collector session at a time. A session is
// built by an injected `SessionRunner` (production wires the real Tauri loop;
// tests wire scripted runners), observed through its `LoopOutcome`, and — when it
// panics — replaced after a bounded, staged backoff until a documented attempt
// budget is exhausted. All waits poll the stop/retry flags at a small interval,
// so shutdown and manual retry are responsive and tests inject millisecond-scale
// policies instead of sleeping through production backoff.
//
// Status transitions are reported through one callback so the IPC layer stays
// single-sourced; a failing status delivery must never kill supervision.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::collector::run_loop::LoopOutcome;

/// Schema version of the `CollectorStatus` payload. Independent of
/// `SCHEMA_VERSION` (metrics snapshot/history): this contract was added without
/// changing existing payload shapes. Bump in lockstep with
/// `EXPECTED_LIFECYCLE_SCHEMA_VERSION` in `src/hooks/useMetrics.ts`.
pub const LIFECYCLE_SCHEMA_VERSION: u32 = 1;

/// Granularity at which supervision polls stop/retry/session-exit signals.
/// Bounds shutdown latency during backoff and failed-wait states; small enough
/// that tests injecting sub-second policies finish quickly.
pub const SUPERVISOR_POLL_INTERVAL: Duration = Duration::from_millis(10);

// ── Lifecycle state machine ──────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CollectorLifecycleState {
    Starting,
    Healthy,
    Recovering,
    Failed,
    Stopping,
}

impl CollectorLifecycleState {
    pub fn as_str(&self) -> &'static str {
        match self {
            CollectorLifecycleState::Starting => "starting",
            CollectorLifecycleState::Healthy => "healthy",
            CollectorLifecycleState::Recovering => "recovering",
            CollectorLifecycleState::Failed => "failed",
            CollectorLifecycleState::Stopping => "stopping",
        }
    }
}

/// Typed lifecycle/status contract delivered via the `collector-status` event
/// and the `get_collector_status` command. Serialize-only (backend → frontend).
#[derive(Clone, Debug, Serialize)]
pub struct CollectorStatus {
    pub schema_version: u32,
    pub state: CollectorLifecycleState,
    /// Monotonically increasing supervised-session counter (starts at 1).
    pub generation: u32,
    /// Consecutive failed sessions in the current streak (0 while healthy).
    pub attempt: u32,
    /// Automatic recovery attempts allowed per failure streak.
    pub max_attempts: u32,
    /// Human-readable reason for the most recent non-healthy transition.
    pub reason: Option<String>,
    pub timestamp_ms: u64,
}

pub fn status_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl CollectorStatus {
    fn new(
        state: CollectorLifecycleState,
        generation: u32,
        attempt: u32,
        max_attempts: u32,
    ) -> Self {
        CollectorStatus {
            schema_version: LIFECYCLE_SCHEMA_VERSION,
            state,
            generation,
            attempt,
            max_attempts,
            reason: None,
            timestamp_ms: status_timestamp_ms(),
        }
    }

    fn with_reason(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }

    /// Initial managed status before the supervisor's first transition.
    pub fn initial(max_attempts: u32) -> Self {
        Self::new(CollectorLifecycleState::Starting, 0, 0, max_attempts)
    }
}

/// Shared latest status behind the poison-safe mutex convention used by every
/// other managed store in this backend.
pub type SafeCollectorStatus = Mutex<CollectorStatus>;

pub fn lock_status(status: &SafeCollectorStatus) -> std::sync::MutexGuard<'_, CollectorStatus> {
    status.lock().unwrap_or_else(|e| e.into_inner())
}

// ── Recovery policy ──────────────────────────────────────────────────────────

/// Bounded automatic-recovery policy. Pure functions make every timing decision
/// testable without wall-clock sleeps.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RecoveryPolicy {
    /// Automatic replacement attempts allowed per failure streak. After this
    /// many consecutive failures (without an intervening healthy period long
    /// enough to reset the streak) the next failure escalates to `Failed` and
    /// the supervisor stops restarting on its own.
    pub max_attempts: u32,
    /// Backoff before the first automatic retry.
    pub base_backoff: Duration,
    /// Upper bound for the staged backoff.
    pub max_backoff: Duration,
    /// A session that stayed healthy at least this long resets the failure
    /// streak before its outcome is accounted.
    pub healthy_reset_after: Duration,
}

impl RecoveryPolicy {
    /// Production defaults: three automatic retries per failure streak, staged
    /// backoff 500ms → 1s → 2s (capped), healthy period 30s resets the streak.
    pub const fn production() -> Self {
        RecoveryPolicy {
            max_attempts: 3,
            base_backoff: Duration::from_millis(500),
            max_backoff: Duration::from_secs(8),
            healthy_reset_after: Duration::from_secs(30),
        }
    }

    /// Staged exponential backoff for attempt `attempt` (1-based): base × 2^(n-1),
    /// capped at `max_backoff`.
    pub fn backoff_for(&self, attempt: u32) -> Duration {
        if attempt == 0 {
            return Duration::ZERO;
        }
        let doubling = attempt.saturating_sub(1).min(5);
        let scaled = self.base_backoff.saturating_mul(1u32 << doubling);
        scaled.min(self.max_backoff)
    }

    /// Whether `attempt` consecutive failures exhaust the automatic budget.
    pub fn should_escalate(&self, attempt: u32) -> bool {
        attempt > self.max_attempts
    }

    /// Whether an elapsed healthy period resets the failure streak.
    pub fn streak_expired(&self, healthy_elapsed: Duration) -> bool {
        healthy_elapsed >= self.healthy_reset_after
    }
}

impl Default for RecoveryPolicy {
    fn default() -> Self {
        Self::production()
    }
}

// ── Session runner contract ──────────────────────────────────────────────────

/// Per-generation signals handed to a starting session.
#[derive(Clone)]
pub struct SessionSignals {
    /// Set by the session when it delivers its first successful snapshot; the
    /// supervisor turns this into the `Healthy` transition.
    pub first_emit: Arc<AtomicBool>,
    /// Cooperative shutdown flag (production: the managed app flag).
    pub stop: Arc<AtomicBool>,
}

/// Builds and launches exactly one collector session. Implementations construct
/// fresh OS-facing state per call (`CollectorState`, WMI bootstrap, sensor
/// registry) on their own side of the thread boundary and return immediately
/// after spawning; the supervisor reaps outcomes via the returned handle.
pub trait SessionRunner: Send {
    fn start(&mut self, generation: u32, signals: SessionSignals) -> JoinHandle<LoopOutcome>;
}

// ── Supervised loop ──────────────────────────────────────────────────────────

fn responsive_wait(total: Duration, stop: &AtomicBool) -> bool {
    let deadline = Instant::now() + total;
    while Instant::now() < deadline {
        if stop.load(Ordering::Relaxed) {
            return false;
        }
        let now = Instant::now();
        std::thread::sleep(SUPERVISOR_POLL_INTERVAL.min(deadline - now));
    }
    !stop.load(Ordering::Relaxed)
}

/// Runs the supervised collector lifecycle until application shutdown.
///
/// Guarantees:
/// - At most one session runs at any moment: each session's outcome is fully
///   reaped before the next one starts (`start()` is never re-entered early).
/// - A panicked session triggers bounded automatic recovery: `Recovering`
///   status, staged backoff (shutdown-responsive), replacement session.
/// - Once consecutive failures exceed `max_attempts` without an intervening
///   healthy period long enough to reset the streak, the supervisor reports
///   `Failed` and waits for either shutdown or a manual retry request.
/// - Manual retry requests are consumed whenever a session starts, so clicks
///   made outside `Failed` cannot authorize a later automatic restart.
/// - Shutdown from any state reports `Stopping` and returns without spawning.
pub fn supervise(
    runner: &mut dyn SessionRunner,
    stop: Arc<AtomicBool>,
    retry_request: Arc<AtomicBool>,
    policy: RecoveryPolicy,
    mut on_status: impl FnMut(&CollectorStatus),
) {
    let mut generation = 0u32;
    // Consecutive failed sessions in the current failure streak.
    let mut streak = 0u32;

    loop {
        if stop.load(Ordering::Relaxed) {
            on_status(&CollectorStatus::new(
                CollectorLifecycleState::Stopping,
                generation,
                streak,
                policy.max_attempts,
            ));
            return;
        }

        // A pending retry click from before this session started is stale;
        // discard it so it cannot authorize a future restart.
        retry_request.store(false, Ordering::Relaxed);

        generation += 1;
        let first_emit = Arc::new(AtomicBool::new(false));
        let signals = SessionSignals {
            first_emit: Arc::clone(&first_emit),
            stop: Arc::clone(&stop),
        };

        on_status(&CollectorStatus::new(
            CollectorLifecycleState::Starting,
            generation,
            streak,
            policy.max_attempts,
        ));

        let handle = runner.start(generation, signals);
        // Reap the session outcome on a helper thread so the supervisor can
        // observe the healthy transition and shutdown while the session runs.
        let (outcome_tx, outcome_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let outcome = handle.join().unwrap_or(LoopOutcome::Panicked(
                "session thread panicked outside the tick loop".to_string(),
            ));
            let _ = outcome_tx.send(outcome);
        });

        let mut healthy_since: Option<Instant> = None;
        let mut healthy_reported = false;
        let mut stopping_reported = false;

        let outcome = loop {
            if !healthy_reported && first_emit.load(Ordering::Relaxed) {
                healthy_reported = true;
                healthy_since.get_or_insert_with(Instant::now);
                on_status(&CollectorStatus::new(
                    CollectorLifecycleState::Healthy,
                    generation,
                    0,
                    policy.max_attempts,
                ));
            }
            if let Ok(outcome) = outcome_rx.try_recv() {
                break outcome;
            }
            if stop.load(Ordering::Relaxed) && !stopping_reported {
                stopping_reported = true;
                on_status(&CollectorStatus::new(
                    CollectorLifecycleState::Stopping,
                    generation,
                    streak,
                    policy.max_attempts,
                ));
            }
            std::thread::sleep(SUPERVISOR_POLL_INTERVAL.min(Duration::from_millis(2)));
        };

        match outcome {
            // Natural end (bounded probes/tests) or cooperative shutdown: do
            // not restart on our own.
            LoopOutcome::Completed | LoopOutcome::Stopped => {
                if !stopping_reported {
                    on_status(&CollectorStatus::new(
                        CollectorLifecycleState::Stopping,
                        generation,
                        streak,
                        policy.max_attempts,
                    ));
                }
                return;
            }
            LoopOutcome::Panicked(reason) => {
                // A session that ran healthy long enough resets the streak
                // before this failure is counted.
                let healthy_elapsed = healthy_since
                    .map(|since| since.elapsed())
                    .unwrap_or(Duration::ZERO);
                if policy.streak_expired(healthy_elapsed) {
                    streak = 0;
                }
                streak = streak.saturating_add(1);

                if policy.should_escalate(streak) {
                    on_status(
                        &CollectorStatus::new(
                            CollectorLifecycleState::Failed,
                            generation,
                            streak,
                            policy.max_attempts,
                        )
                        .with_reason(reason.clone()),
                    );
                    // Terminal wait: only shutdown or a manual retry exits.
                    loop {
                        if stop.load(Ordering::Relaxed) {
                            on_status(&CollectorStatus::new(
                                CollectorLifecycleState::Stopping,
                                generation,
                                streak,
                                policy.max_attempts,
                            ));
                            return;
                        }
                        if retry_request.swap(false, Ordering::Relaxed) {
                            // Manual retry: reset the budget, start one session.
                            streak = 0;
                            break;
                        }
                        std::thread::sleep(SUPERVISOR_POLL_INTERVAL);
                    }
                } else {
                    on_status(
                        &CollectorStatus::new(
                            CollectorLifecycleState::Recovering,
                            generation,
                            streak,
                            policy.max_attempts,
                        )
                        .with_reason(reason.clone()),
                    );
                    let backoff = policy.backoff_for(streak);
                    if backoff > Duration::ZERO && !responsive_wait(backoff, &stop) {
                        on_status(&CollectorStatus::new(
                            CollectorLifecycleState::Stopping,
                            generation,
                            streak,
                            policy.max_attempts,
                        ));
                        return;
                    }
                    // Retry clicks during automatic recovery are coalesced into
                    // no-ops: they never shorten backoff or reset the streak.
                    retry_request.store(false, Ordering::Relaxed);
                }
            }
        }
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Policy purity (no sleeps, no threads) ──

    #[test]
    fn test_policy_backoff_is_staged_and_capped() {
        let policy = RecoveryPolicy::production();
        assert_eq!(policy.backoff_for(1), Duration::from_millis(500));
        assert_eq!(policy.backoff_for(2), Duration::from_millis(1_000));
        assert_eq!(policy.backoff_for(3), Duration::from_millis(2_000));
        assert_eq!(policy.backoff_for(9), policy.max_backoff);
        assert_eq!(policy.backoff_for(0), Duration::ZERO);
    }

    #[test]
    fn test_policy_escalation_boundary_matches_budget() {
        let policy = fast_policy();
        assert!(!policy.should_escalate(1));
        assert!(!policy.should_escalate(2));
        assert!(
            policy.should_escalate(3),
            "budget 2 => the third consecutive failure escalates"
        );
    }

    #[test]
    fn test_policy_streak_reset_requires_full_healthy_period() {
        let policy = fast_policy();
        assert!(!policy.streak_expired(Duration::from_millis(9)));
        assert!(policy.streak_expired(Duration::from_millis(10)));
    }

    #[test]
    fn test_status_serializes_snake_case_contract_fields() {
        let status = CollectorStatus::new(CollectorLifecycleState::Recovering, 7, 2, 3)
            .with_reason("tick panicked: synthetic");
        let json = serde_json::to_value(&status).expect("status must serialize");
        assert_eq!(json["schema_version"], LIFECYCLE_SCHEMA_VERSION);
        assert_eq!(json["state"], "recovering");
        assert_eq!(json["generation"], 7);
        assert_eq!(json["attempt"], 2);
        assert_eq!(json["max_attempts"], 3);
        assert_eq!(json["reason"], "tick panicked: synthetic");
        assert!(json.get("timestamp_ms").is_some());

        let healthy = serde_json::to_value(CollectorStatus::new(
            CollectorLifecycleState::Healthy,
            8,
            0,
            3,
        ))
        .expect("healthy status must serialize");
        assert_eq!(healthy["state"], "healthy");
        assert!(healthy["reason"].is_null());
    }

    #[test]
    fn test_initial_status_is_starting_generation_zero() {
        let initial = CollectorStatus::initial(3);
        assert_eq!(initial.state, CollectorLifecycleState::Starting);
        assert_eq!(initial.generation, 0);
        assert_eq!(initial.attempt, 0);
        assert_eq!(initial.max_attempts, 3);
    }

    // ── Scripted supervision (injected outcomes + millisecond policies) ──

    struct ScriptedRunner {
        scripts: Vec<Script>,
        generations_seen: Arc<Mutex<Vec<u32>>>,
        session_alive: Arc<AtomicBool>,
        overlap_detected: Arc<AtomicBool>,
    }

    enum Script {
        /// End immediately as a panicked session (never reported healthy).
        Panicked(String),
        /// Report healthy, stay alive `run_for`, then end panicked.
        PanickedAfterHealthy { run_for: Duration, reason: String },
        /// Report healthy, run until the stop flag, then end stopped.
        RunUntilStopped,
    }

    impl ScriptedRunner {
        fn new(scripts: Vec<Script>) -> Self {
            ScriptedRunner {
                scripts,
                generations_seen: Arc::new(Mutex::new(Vec::new())),
                session_alive: Arc::new(AtomicBool::new(false)),
                overlap_detected: Arc::new(AtomicBool::new(false)),
            }
        }
    }

    impl SessionRunner for ScriptedRunner {
        fn start(&mut self, generation: u32, signals: SessionSignals) -> JoinHandle<LoopOutcome> {
            // Structural duplicate-emission check: entering start() while a
            // previous session is still alive would mean two emitters exist.
            if self.session_alive.swap(true, Ordering::SeqCst) {
                self.overlap_detected.store(true, Ordering::SeqCst);
            }
            self.generations_seen.lock().unwrap().push(generation);
            let script = self.scripts.remove(0);
            let alive = Arc::clone(&self.session_alive);
            let first_emit = signals.first_emit;
            let stop = signals.stop;
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1));
                first_emit.store(true, Ordering::Relaxed);
                let outcome = match script {
                    Script::Panicked(reason) => LoopOutcome::Panicked(reason),
                    Script::PanickedAfterHealthy { run_for, reason } => {
                        std::thread::sleep(run_for);
                        LoopOutcome::Panicked(reason)
                    }
                    Script::RunUntilStopped => {
                        while !stop.load(Ordering::Relaxed) {
                            std::thread::sleep(Duration::from_millis(1));
                        }
                        LoopOutcome::Stopped
                    }
                };
                alive.store(false, Ordering::SeqCst);
                outcome
            })
        }
    }

    const STARTING: CollectorLifecycleState = CollectorLifecycleState::Starting;
    const HEALTHY: CollectorLifecycleState = CollectorLifecycleState::Healthy;
    const RECOVERING: CollectorLifecycleState = CollectorLifecycleState::Recovering;
    const FAILED: CollectorLifecycleState = CollectorLifecycleState::Failed;
    const STOPPING: CollectorLifecycleState = CollectorLifecycleState::Stopping;

    fn fast_policy() -> RecoveryPolicy {
        RecoveryPolicy {
            max_attempts: 2,
            base_backoff: Duration::from_millis(2),
            max_backoff: Duration::from_millis(4),
            healthy_reset_after: Duration::from_millis(10),
        }
    }

    /// Observation handles for a supervision run started on its own thread.
    type SupervisionLog = Arc<Mutex<Vec<(u32, CollectorLifecycleState, u32)>>>;

    struct Supervision {
        log: SupervisionLog,
        generations: Arc<Mutex<Vec<u32>>>,
        overlap_detected: Arc<AtomicBool>,
        stop: Arc<AtomicBool>,
        retry: Arc<AtomicBool>,
    }

    fn run_supervised(scripts: Vec<Script>, policy: RecoveryPolicy) -> Supervision {
        let log = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let retry = Arc::new(AtomicBool::new(false));
        let mut runner = ScriptedRunner::new(scripts);
        let generations = Arc::clone(&runner.generations_seen);
        let overlap_detected = Arc::clone(&runner.overlap_detected);
        let log_inner = Arc::clone(&log);
        let stop_inner = Arc::clone(&stop);
        let retry_inner = Arc::clone(&retry);
        std::thread::spawn(move || {
            supervise(&mut runner, stop_inner, retry_inner, policy, |status| {
                log_inner
                    .lock()
                    .unwrap()
                    .push((status.generation, status.state, status.attempt));
            });
        });
        Supervision {
            log,
            generations,
            overlap_detected,
            stop,
            retry,
        }
    }

    fn states_of(log: &[(u32, CollectorLifecycleState, u32)]) -> Vec<CollectorLifecycleState> {
        log.iter().map(|(_, s, _)| *s).collect()
    }

    fn starting_count(log: &[(u32, CollectorLifecycleState, u32)]) -> usize {
        states_of(log).iter().filter(|s| **s == STARTING).count()
    }

    fn wait_for(
        log: &SupervisionLog,
        pred: impl Fn(&[(u32, CollectorLifecycleState, u32)]) -> bool,
        timeout: Duration,
    ) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            {
                let guard = log.lock().unwrap();
                if pred(&guard) {
                    return true;
                }
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    const TIMEOUT: Duration = Duration::from_secs(5);

    #[test]
    fn test_supervision_reports_starting_then_healthy_then_stopping() {
        let sup = run_supervised(vec![Script::RunUntilStopped], fast_policy());
        assert!(wait_for(
            &sup.log,
            |log| states_of(log).contains(&HEALTHY),
            TIMEOUT
        ));
        sup.stop.store(true, Ordering::Relaxed);
        assert!(wait_for(
            &sup.log,
            |log| states_of(log).last() == Some(&STOPPING),
            TIMEOUT
        ));
        assert_eq!(*sup.generations.lock().unwrap(), vec![1]);
        assert!(!sup.overlap_detected.load(Ordering::SeqCst));
    }

    #[test]
    fn test_single_panic_recovers_into_a_replacement_session() {
        let sup = run_supervised(
            vec![
                Script::Panicked("synthetic tick panic".into()),
                Script::RunUntilStopped,
            ],
            fast_policy(),
        );
        assert!(
            wait_for(
                &sup.log,
                |log| {
                    let s = states_of(log);
                    s.contains(&RECOVERING) && s.iter().filter(|st| **st == HEALTHY).count() >= 2
                },
                TIMEOUT
            ),
            "expected recovering followed by two healthy reports: {:?}",
            states_of(&sup.log.lock().unwrap())
        );
        {
            let log = sup.log.lock().unwrap();
            let rec = log
                .iter()
                .find(|(_, s, _)| *s == RECOVERING)
                .expect("recovering logged");
            assert_eq!(rec.0, 1, "recovering belongs to the failed generation");
            assert_eq!(rec.2, 1, "first failure of a fresh streak is attempt 1");
            assert_eq!(
                *sup.generations.lock().unwrap(),
                vec![1, 2],
                "exactly one replacement"
            );
        }
        assert!(
            !sup.overlap_detected.load(Ordering::SeqCst),
            "sessions must never overlap"
        );
        sup.stop.store(true, Ordering::Relaxed);
        assert!(wait_for(
            &sup.log,
            |log| states_of(log).last() == Some(&STOPPING),
            TIMEOUT
        ));
    }

    #[test]
    fn test_repeated_panics_escalate_to_failed_then_manual_retry_restores() {
        // Budget 2: failures one and two are retried automatically; the third
        // consecutive failure exhausts the budget and escalates.
        let sup = run_supervised(
            vec![
                Script::Panicked("crash one".into()),
                Script::Panicked("crash two".into()),
                Script::Panicked("crash three".into()),
                Script::RunUntilStopped, // started by the manual retry
            ],
            fast_policy(),
        );
        assert!(wait_for(
            &sup.log,
            |log| states_of(log).contains(&FAILED),
            TIMEOUT
        ));
        {
            let log = sup.log.lock().unwrap();
            let idx = log.iter().position(|(_, s, _)| *s == FAILED).unwrap();
            let (generation, _, attempt) = log[idx];
            assert_eq!(
                attempt,
                fast_policy().max_attempts + 1,
                "failed carries the exhausted count"
            );
            assert_eq!(
                generation, 3,
                "failed belongs to the last failed generation"
            );
        }
        // No further automatic restarts while failed.
        std::thread::sleep(Duration::from_millis(40));
        assert_eq!(
            starting_count(&sup.log.lock().unwrap()),
            3,
            "no session may start automatically once failed"
        );

        sup.retry.store(true, Ordering::Relaxed);
        assert!(
            wait_for(
                &sup.log,
                |log| { states_of(log).last() == Some(&HEALTHY) && starting_count(log) >= 4 },
                TIMEOUT
            ),
            "manual retry must leave Failed and reach Healthy"
        );
        assert_eq!(*sup.generations.lock().unwrap(), vec![1, 2, 3, 4]);
        assert!(!sup.overlap_detected.load(Ordering::SeqCst));
        sup.stop.store(true, Ordering::Relaxed);
    }

    #[test]
    fn test_stale_retry_requests_cannot_authorize_automatic_restart() {
        // The session completes naturally; a retry click raised mid-run must be
        // discarded rather than surviving as authorization for a later restart.
        let sup = run_supervised(vec![Script::RunUntilStopped], fast_policy());
        assert!(wait_for(
            &sup.log,
            |log| states_of(log).contains(&HEALTHY),
            TIMEOUT
        ));
        sup.retry.store(true, Ordering::Relaxed);
        // Complete naturally (Completed is not scripted here, so use stop):
        // first verify the flag does not restart anything while healthy.
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(starting_count(&sup.log.lock().unwrap()), 1);
        sup.stop.store(true, Ordering::Relaxed);
        assert!(wait_for(
            &sup.log,
            |log| states_of(log).last() == Some(&STOPPING),
            TIMEOUT
        ));
        assert_eq!(starting_count(&sup.log.lock().unwrap()), 1);
    }

    #[test]
    fn test_shutdown_during_failed_wait_reports_stopping_without_new_sessions() {
        let sup = run_supervised(
            vec![
                Script::Panicked("a".into()),
                Script::Panicked("b".into()),
                Script::Panicked("c".into()),
            ],
            fast_policy(),
        );
        assert!(wait_for(
            &sup.log,
            |log| states_of(log).contains(&FAILED),
            TIMEOUT
        ));
        sup.stop.store(true, Ordering::Relaxed);
        assert!(wait_for(
            &sup.log,
            |log| states_of(log).last() == Some(&STOPPING),
            TIMEOUT
        ));
        assert_eq!(starting_count(&sup.log.lock().unwrap()), 3);
    }

    #[test]
    fn test_shutdown_during_recovery_backoff_starts_no_replacement() {
        // Slow the policy just for this test so the backoff window is observable.
        let policy = RecoveryPolicy {
            max_attempts: 2,
            base_backoff: Duration::from_millis(400),
            max_backoff: Duration::from_millis(400),
            healthy_reset_after: Duration::from_secs(3600),
        };
        let sup = run_supervised(vec![Script::Panicked("boom".into())], policy);
        assert!(wait_for(
            &sup.log,
            |log| states_of(log).contains(&RECOVERING),
            TIMEOUT
        ));
        // Shutdown lands inside the backoff wait...
        std::thread::sleep(Duration::from_millis(20));
        sup.stop.store(true, Ordering::Relaxed);
        assert!(wait_for(
            &sup.log,
            |log| states_of(log).last() == Some(&STOPPING),
            TIMEOUT
        ));
        // ...and no replacement session ever starts (generation count stays 1).
        assert_eq!(*sup.generations.lock().unwrap(), vec![1]);
    }

    #[test]
    fn test_long_healthy_period_resets_the_failure_streak() {
        // gen1 fails immediately (streak 1), gen2 fails immediately (streak 2 =
        // budget), gen3 would escalate — but gen4's predecessor... Instead the
        // direct scenario: gen1 runs healthy past healthy_reset_after, then
        // panics; the streak resets first, so the following recovering shows
        // attempt 1 again.
        let sup = run_supervised(
            vec![
                Script::PanickedAfterHealthy {
                    run_for: fast_policy().healthy_reset_after + Duration::from_millis(10),
                    reason: "late crash".into(),
                },
                Script::RunUntilStopped,
            ],
            fast_policy(),
        );
        assert!(wait_for(
            &sup.log,
            |log| {
                let s = states_of(log);
                s.contains(&RECOVERING) && s.last() == Some(&HEALTHY)
            },
            TIMEOUT
        ));
        {
            let log = sup.log.lock().unwrap();
            let rec = log.iter().find(|(_, s, _)| *s == RECOVERING).unwrap();
            assert_eq!(
                rec.2, 1,
                "a healthy period longer than healthy_reset_after must reset the streak"
            );
        }
        sup.stop.store(true, Ordering::Relaxed);
    }

    #[test]
    fn test_failed_reason_carries_panic_message() {
        let entries = Arc::new(Mutex::new(Vec::<String>::new()));
        let reasons = Arc::clone(&entries);
        let stop = Arc::new(AtomicBool::new(false));
        let retry = Arc::new(AtomicBool::new(false));
        let mut runner = ScriptedRunner::new(vec![
            Script::Panicked("disk provider exploded".into()),
            Script::Panicked("again".into()),
            Script::Panicked("third".into()),
        ]);
        let stop_inner = Arc::clone(&stop);
        let retry_inner = Arc::clone(&retry);
        let policy = fast_policy();
        std::thread::spawn(move || {
            supervise(&mut runner, stop_inner, retry_inner, policy, |status| {
                if status.state == FAILED {
                    if let Some(reason) = &status.reason {
                        reasons.lock().unwrap().push(reason.clone());
                    }
                }
            });
        });
        let deadline = Instant::now() + TIMEOUT;
        while entries.lock().unwrap().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(2));
        }
        assert_eq!(
            entries.lock().unwrap().last().map(String::as_str),
            Some("third"),
            "failed status carries the latest failure reason"
        );
        stop.store(true, Ordering::Relaxed);
    }

    #[test]
    fn test_responsive_wait_returns_false_on_stop() {
        let stop = AtomicBool::new(true);
        assert!(!responsive_wait(Duration::from_secs(60), &stop));
        let clear = AtomicBool::new(false);
        let started = Instant::now();
        assert!(responsive_wait(Duration::from_millis(3), &clear));
        assert!(started.elapsed() >= Duration::from_millis(3));
    }
}
