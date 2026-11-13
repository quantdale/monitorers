## 1. Reproduce and implement

- [x] 1.1 Establish a real-loop regression with a distinguishable retained clock and reproduce the session reset.
- [x] 1.2 Retain the timestamp projection in HistoryStore; preserve per-session scheduling and add synthetic continuity tests.
- [x] 1.3 Update architecture documentation and perform sibling-contract review.

## 2. Qualify

- [x] 2.1 Run all Rust feature matrices, formatting, Clippy, audit and the real hardware cadence probe.
- [x] 2.2 Build a fresh production executable and qualify real IPC, persistence/relaunch, rendered UI and host cleanup.
- [x] 2.3 Review, record final validation and archive the change.
