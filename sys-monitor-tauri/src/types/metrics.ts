export type MetricValue = number | null;

/**
 * Mirrors `CollectorLifecycleState` (src-tauri/src/collector/supervisor.rs).
 * Serde serializes the Rust enum as snake_case via `rename_all`.
 */
export type CollectorLifecycleState =
  | 'starting'
  | 'healthy'
  | 'recovering'
  | 'failed'
  | 'stopping';

/**
 * Mirrors `CollectorStatus` (src-tauri/src/collector/supervisor.rs) — the typed
 * lifecycle contract delivered via the `collector-status` event and the
 * `get_collector_status` command. Keep in sync by hand; its schema version is
 * independent of the metrics snapshot version.
 */
export interface CollectorStatus {
  schema_version: number;
  state: CollectorLifecycleState;
  /** Monotonically increasing supervised-session counter (starts at 1). */
  generation: number;
  /** Consecutive failed sessions in the current streak (0 while healthy). */
  attempt: number;
  max_attempts: number;
  reason: string | null;
  timestamp_ms: number;
}

export interface NvidiaTelemetry {
  temp_c?: number | null;
  power_w?: number | null;
  mem_used_mb?: number | null;
  mem_total_mb?: number | null;
  fan_speed_pct?: number | null;
  clock_mhz?: number | null;
}

export interface DiskSnapshot {
  key: string;
  active: number;
  read_mb_s: number;
  write_mb_s: number;
  avg_response_ms: number;
}

export interface GpuSnapshot {
  /** Stable collector identity; display name is presentation-only. */
  key: string;
  name: string;
  vendor: string;   // "nvidia" | "intel" | "amd" | "unknown"
  util: number;
  temp_c?: number | null;
  nvidia?: NvidiaTelemetry | null;
}

export interface MetricsSnapshot {
  schema_version: number;
  /** True when this snapshot was emitted on a full (history-committing) tick. */
  on_tick: boolean;
  cpu: number;
  cpu_name: string;
  cpu_temp_c?: number | null;
  mem: number;
  mem_used_gb: number;
  mem_total_gb: number;
  disks: DiskSnapshot[];
  net_recv_kib_s: number;
  net_sent_kib_s: number;
  gpus: GpuSnapshot[];
}

export interface DiskHistory {
  key: string;
  values: MetricValue[];
  read_mb_s: number;
  write_mb_s: number;
  avg_response_ms: number;
  /**
   * Frontend-only ghost-pruning bookkeeping: wall-clock timestamp (ms) when
   * this disk was last seen in a live snapshot. Not part of the Rust IPC
   * payload (which has no such field); seeded on load and updated by the
   * merge functions. Optional so backend payloads remain valid.
   */
  last_seen_ts?: number;
}

export interface GpuHistory {
  key: string;
  name: string;
  vendor: string;
  values: MetricValue[];
  temp_c?: number | null;
  nvidia?: NvidiaTelemetry | null;
  /**
   * Frontend-only ghost-pruning bookkeeping: wall-clock timestamp (ms) when
   * this GPU was last seen in a live snapshot. Not part of the Rust IPC
   * payload (which has no such field); seeded on load and updated by the
   * merge functions. Optional so backend payloads remain valid.
   */
  last_seen_ts?: number;
}

export interface HistoryPayload {
  schema_version: number;
  timestamps: number[];
  cpu: number[];
  cpu_name: string;
  cpu_temp_c?: number | null;
  mem: number[];
  disks: DiskHistory[];
  net_recv: number[];
  net_sent: number[];
  gpus: GpuHistory[];
}
