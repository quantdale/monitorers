export interface DiskSnapshot {
  key: string;
  active: number;
}

export interface MetricsSnapshot {
  cpu: number;
  mem: number;
  mem_used_gb: number;
  mem_total_gb: number;
  disks: DiskSnapshot[];
  net_recv_kb: number;
  net_sent_kb: number;
  igpu: number;
  dgpu: number;
}

export interface DiskHistory {
  key: string;
  values: number[];
}

export interface HistoryPayload {
  cpu: number[];
  mem: number[];
  disks: DiskHistory[];
  net_recv: number[];
  net_sent: number[];
  igpu: number[];
  dgpu: number[];
}
