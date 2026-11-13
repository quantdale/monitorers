## Why

The final native-path review found that formatted PDH read errors collapse into empty maps and can fabricate zero GPU utilization or prune disks even when collection itself succeeded. GPU classification is duplicated with conflicting Intel/AMD results, and the startup probe sorts phase samples before pairing totals despite claiming otherwise.

## What Changes

- Preserve formatted-counter failure and per-instance missing values through the raw poll, history commit, and nullable readout projection.
- Keep disk and GPU read failure independent so one domain's failed counter does not hide the other.
- Use one conservative GPU classification policy for profile and ordering, recognizing that the Arc brand alone does not prove a discrete GPU.
- Pair startup phase timings before calculating medians and regression-test the reported totals.
- Reset capped diagnostic logs with truncate-on-open and surface metadata/reset failures rather than silently ignoring a failed deletion.
- Verify cadence across ring rollover and reject missing timestamp coverage; record per-device lengths and the newest committed timestamp so saturated buffers remain observable.
- Retain the in-flight schema-7 migration as one synchronized release, including nullable unavailable disk throughput/response fields.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `metrics-history-streaming`: unavailable formatted counter values remain explicit gaps/readouts rather than fabricated zero.
- `stable-hardware-identity`: shared conservative classification for profile and device ordering.
- `collector-time-fidelity`: cadence verification covers saturated rings and requires timestamp evidence.

## Impact

PDH reader, native poll/commit/projection and type mirrors, GPU classifier, startup timing example, capped diagnostic log, cadence evidence and focused regression tests. No new dependencies or cadence changes.
