export type MetricValue = number | null;

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
  temp_c?: number | null;
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
  net_recv_kb: number;
  net_sent_kb: number;
  gpus: GpuSnapshot[];
}

export interface DiskHistory {
  key: string;
  values: MetricValue[];
  read_mb_s: number;
  write_mb_s: number;
  avg_response_ms: number;
  temp_c?: number | null;
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
