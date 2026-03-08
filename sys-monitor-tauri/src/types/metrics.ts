export interface DiskSnapshot {
  key: string;
  active: number;
  read_mb_s: number;
  write_mb_s: number;
  temp_c?: number | null;
}

export interface GpuSnapshot {
  name: string;
  util: number;
  temp_c?: number | null;
}

export interface MetricsSnapshot {
  cpu: number;
  cpu_name: string;
  cpu_temp_c?: number | null;
  nvidia_temp?: number | null;
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
  temp_c?: number | null;
}

export interface GpuHistory {
  name: string;
  values: number[];
  temp_c?: number | null;
}

export interface HistoryPayload {
  cpu: number[];
  cpu_name: string;
  cpu_temp_c?: number | null;
  mem: number[];
  disks: DiskHistory[];
  net_recv: number[];
  net_sent: number[];
  gpus: GpuHistory[];
}
