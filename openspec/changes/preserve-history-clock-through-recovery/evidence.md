# Retained-history clock — 2026-11-13

Parent readiness campaign starts at `main@637728958dd2296dc754865ed2265f1cd0050537` on `agent/production-readiness-2026-11-13`. Session evidence lives under `D:/Documents/tryPython/_AgentArtifacts/monitorers/sessions/20261113-codex-successor/`.

`clock-red.log`: real bounded loop test initialized a distinguishable retained clock, then failed with `replacement discarded the retained history clock` (Cargo exit 101). After the fix, the same loop passes through two fresh collector sessions and verifies each emitted timestamp is the ring tail. The synthetic state test verifies backward/forward wall candidates are ignored, monotonic downtime is retained and a fresh ring gets its own origin.

Timestamp projection is stored as an optional process-local `(u64, Instant)` pair in HistoryStore, initialized once and copied under one short session-start lock. No OS handles or serialized fields added. Tick scheduling/rate priming still start fresh per session; history growth remains full-tick only. Metrics schema stays 6; lifecycle schema stays 1.

`rust-final.log`: canonical Rust gate passes all-feature/default/no-default/NVML/NVAPI matrices (211/211/192/205/203 library tests, plus the binary tests), fmt, Clippy all-targets/all-features `-D warnings`, and Cargo audit. Audit retains the three explicitly allowed advisories; no suppression added.

Initial 90s cadence check (`cadence.log`) failed maximum event interval: 1567ms versus 1500ms, with median 250ms, p95 266ms, 88 full ticks/351 events and no ratio/history-growth failures. It ran concurrently with browser stress and includes startup enrichment. It is retained as a failed measurement, not counted as success. A quiet repeat is required before final disposition; no threshold is changed.

Quiet 90s repeat (`cadence-quiet.log`) **PASS**: 357 events, 90 full ticks/history commits, observation 90190ms, median 249ms, p95 266ms, maximum 1428ms; full intervals median 1000ms, p95 1019ms. No SLO or checker changes. This demonstrates a passing local cadence run, not a performance optimization or universal latency guarantee.

Fresh `verify:tauri` succeeded (3m54s final Rust build). Executable SHA256 `70c884e149a90c4ce1518c9f9b6fad417bdc6b999d3292be867c172ee4e51338`. Packaged qualification passed 1/1 with real IPC, advancing history, isolated native store writes, real hardware drawer focus/keyboard cancellation and clean teardown. The non-elevated host denied HKLM debug-policy writes; the documented per-process environment fallback worked, and policy absence was asserted afterward.

Final real journeys pass: customization, sidebar relaunch persistence and restart soak (9/9, 17/17 and 25/25 assertions respectively). No owned app process remains and policy absence is checked again. These are real process-restart proofs, not injected physical fault/recovery tests; the retained-clock real-loop/synthetic tests establish session replacement clock continuity without altering the host clock.
