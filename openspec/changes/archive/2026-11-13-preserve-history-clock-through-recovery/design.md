## Context

Supervision preserves HistoryStore while replacing all OS-facing CollectorState and WMI state. The current loop initializes both scheduling and timestamp epochs per session. Only the timestamp epoch needs a longer lifetime (see proposal.md).

## Goals / Non-Goals

Goals: comparable sample times for the entire retained ring, including recovery downtime, without additional per-tick locking or clock reads.

Non-goals: changing wall-clock time on the host, timestamp migration, new IPC fields, altering recovery policy or sampling deadlines.

## Decisions

HistoryStore retains an optional immutable `(wall_origin_ms, Instant)` pair. The first session initializes it under one short lock; later sessions copy it. The loop continues to schedule deadlines from its fresh session epoch, and computes the single ring/live timestamp from the retained clock epoch. This preserves actual monotonic downtime without fabricating samples. Merely clamping new timestamps to the old tail would hide downtime; sampling wall time anew permits rewind or arbitrary jumps.

Tests inject differing candidate wall origins and synthetic monotonic instants, plus a real bounded collector loop with an intentionally distinguishable retained origin. They never alter the host clock. No OS handles enter HistoryStore.

## Risks / Trade-offs

The timestamps intentionally remain tied to the app's first wall origin after a clock correction, matching the existing within-session contract. A new process gets a new empty ring and new origin. `Instant` remains process-local and is never serialized or persisted.
