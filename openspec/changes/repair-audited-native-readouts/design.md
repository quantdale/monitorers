## Context

See proposal.md. `read_pdh_counter_array` currently returns an empty map for both success and failure and discards invalid-status rows. GPU projection fills absent known keys with zero, while disk commits interpret an empty inventory as disappearance. `RawPoll.pdh_ok` only represents query collection. The pending schema-7 change already permits unavailable utilization.

## Goals / Non-Goals

**Goals:** preserve actual availability, independent domain progress, consistent classification, and truthful timing evidence.

**Non-Goals:** new telemetry sources, guessing unrecognized GPU models, changing stable keys or cadence.

## Decisions

- Return `Option<HashMap<String, Option<f64>>>` from the formatted-array reader: outer None is a failed read, inner None is an invalid instance. Keep the same reusable aligned FFI buffer and read the value union only for valid statuses.
- Carry nullable GPU utilization and disk activity in RawPoll. Add independent read-failure markers so collection success cannot authorize pruning a failed domain. Preserve per-instance identities with null values instead of discarding them. Keep NVML identity matching generic over the unused utilization field.
- Make absent disk throughput/response projection nullable, matching existing finite-safe formatters. Extend the single schema-7 migration together with its Rust/TS/mock documentation; no intermediate schema is shipped.
- Delegate ordering classification to the profile classifier. Recognize established Arc A-series and B5/B7 discrete family captions; otherwise retain unknown unless explicit form-factor terms apply. This avoids branding-only inference for Core Ultra integrated Arc GPUs.
- Compute paired startup totals before any in-place phase sorting. A crossed-phase regression demonstrates the previous wrong median.
- Replace the capped error log's ignored deletion with explicit truncate-on-open and propagate metadata inspection failures. Its existing cap-reset regression covers the normal path, and a failed reset now reaches the caller's best-effort diagnostic instead of appending past a cap indefinitely.
- Bound cadence length and elapsed-coverage expectations at ring capacity. Record per-device lengths and the newest committed timestamp so lost commits remain observable after saturation; retain legacy log parsing while requiring consistent device detail in modern records. Missing timestamp coverage must fail qualification.

## Risks / Trade-offs

- Counter availability changes can expose previously fabricated zeros as unavailable → qualify real idle/active hardware and preserve legitimate numeric zero in unit tests.
- Failed formatting and confirmed disappearance must remain distinct → test failed read counts beyond the prune threshold and verify successful empty inventories still prune.
- An incomplete caption can remain unknown → deliberate conservative metadata, without changing device identity or hiding a card.
