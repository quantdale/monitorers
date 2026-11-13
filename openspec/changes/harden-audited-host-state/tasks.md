## 1. Host policy lifecycle

- [x] 1.1 Add regression coverage for existing values and failed owned-policy rewrites.
- [x] 1.2 Share a fail-closed registry reader between driver and standalone assertion; test absence, presence, malformed results and operational failures.
- [x] 1.3 Preserve pre-existing policies and cleanup ownership after failed rewrites; qualify driver unit seams and the real packaged lane.
- [x] 1.4 Bound CDP fetches and cancel the pending probe when process failure wins the launch race.

## 2. Dependencies and evidence

- [x] 2.1 Resolve Tokio 1.53.3, run Cargo audit, and inspect the Windows-target tree for remaining warnings.
- [x] 2.2 Run canonical affected gates and record evidence and residual limitations in the audit report.
