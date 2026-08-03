export interface DiskSnapshot {
  key: string;
  active: number;
  read_mb_s: number;
  write_mb_s: number;
  avg_response_ms: number;
  temp_c?: number | null;
}

export interface GpuSnapshot {
  name: string;
  vendor: string;   // "nvidia" | "intel" | "amd" | "unknown"
  util: number;
  temp_c?: number | null;
}

export interface MetricsSnapshot {
  schema_version: number;
  /** True when this snapshot was emitted on a full (history-committing) tick. */
  on_tick: boolean;
  cpu: number;
  cpu_name: string;
  cpu_temp_c?: number | null;
  nvidia_temp?: number | null;
  nvidia_power_w?: number;
  nvidia_mem_used_mb?: number;
  nvidia_mem_total_mb?: number;
  nvidia_fan_speed_pct?: number;
  nvidia_clock_mhz?: number;
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
  values: number[];
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
  name: string;
  values: number[];
  temp_c?: number | null;
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
