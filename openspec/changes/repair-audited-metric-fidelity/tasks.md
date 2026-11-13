## 1. Device history correctness

- [x] 1.1 Add failure/recovery, temporary absence, and rollover regressions demonstrating original timestamp drift.
- [x] 1.2 Store nullable dynamic histories and append one slot per full tick for every retained device, keeping scalar and pruning policies independent.
- [x] 1.3 Project nullable full-tick utilization, synchronize schema 7 across Rust/TypeScript/mock/docs, and preserve last-valid frontend GPU scalars.

## 2. Polling and bootstrap reliability

- [x] 2.1 Add deterministic negative thermal-cache tests and cache connected query failures for five seconds.
- [x] 2.2 Remove disconnected network interfaces at refresh and verify upstream baseline semantics.
- [x] 2.3 Reproduce delayed initial listener attachment and fence the first history request on registration settlement.
- [x] 2.4 Correct bounded append edge cases discovered during metrics utility review and cover their boundary behavior.

## 3. Qualification

- [x] 3.0 Cover and repair secondary-series extrema, explicit null temperatures, monotonic pruning, overlong-history tail slicing, and production/probe identity parity found in the second audit pass.

- [x] 3.1 Run frontend and Rust canonical gates, simulation typecheck, E2E and mock simulation.
- [x] 3.2 Build and qualify the packaged application, check WebView2 policy cleanup, and run the real-hardware cadence checker.
- [x] 3.3 Review accumulated diff, validate OpenSpec and record findings and evidence in the audit report.
