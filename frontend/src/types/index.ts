export type AlertState =
  | 'NORMAL'
  | 'WARNING'
  | 'CRITICAL_UNACKNOWLEDGED'
  | 'CRITICAL_ACKNOWLEDGED'
  | 'RECOVERED'

export interface Reading {
  node: string
  seq: number | null
  received_at: number
  temp_c: number | null
  humidity: number | null
  simulated: boolean
  valid?: boolean
}

export interface NodeView {
  node: string
  simulated: boolean
  online: boolean
  last_seen: number | null
  msg_count: number
  last_seq: number | null
  rssi: number | null
  msgs_last_60s: number
  state: AlertState
  critical_alert_id: number | null
  latest: Reading | null
}

export interface Alert {
  id: number
  event_id: string
  device_event_id: string | null
  node: string
  type: 'temp' | 'device_offline' | string
  severity: 'critical' | 'warning' | 'info'
  value: number | null
  peak_value: number | null
  threshold: number | null
  state: string
  source: string
  simulated: boolean
  triggered_at: number
  acknowledged_at: number | null
  resolved_at: number | null
  delivery_status: string | null
  rtt_ms: number | null
  note: string | null
  duration_s: number
}

export interface Settings {
  warning_c: number
  critical_c: number
  recovery_c: number
  recovery_seconds: number
  offline_seconds: number
  flood_max_per_sec: number
}

export interface MqttStatus {
  enabled: boolean
  connected: boolean
  host?: string
  port?: number
  authenticated?: boolean
  connected_since?: number | null
  connects?: number
  disconnects?: number
  messages_rx?: number
  messages_tx?: number
  last_error?: string | null
  broker_rtt_ms_last?: number | null
  broker_rtt_ms_avg?: number | null
  probe_loss_pct?: number | null
}

export interface SimulationStatus {
  running: boolean
  node: string
  temp_c: number
  target_c: number
  humidity: number
  interval_s: number
}

export interface SystemStatus {
  backend: string
  uptime_s: number
  mqtt: MqttStatus
  ws_clients: number
  api_auth: boolean
  primary_node: string
  simulation: SimulationStatus
  transport: string
  security?: SecurityMetrics
}

export interface SecurityMetrics {
  inspected: number
  blocked: number
  by_kind: Record<string, number>
  latency_us_avg: number | null
  latency_us_p95: number | null
  latency_us_max: number | null
  state_bytes_est: number
  devices_profiled: number
  hmac_enabled: boolean
  allowed_nodes: string[]
}

export interface SecurityEvent {
  id: number
  ts: number
  node: string | null
  topic: string | null
  kind: string
  severity: 'low' | 'medium' | 'high'
  detail: string | null
  blocked: boolean
  simulated: boolean
}

export interface Snapshot {
  system: SystemStatus
  nodes: NodeView[]
  active_alerts: Alert[]
  settings: Settings
  security: SecurityMetrics
}

export type WsMessage =
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'reading'; data: Reading }
  | { type: 'node'; data: NodeView }
  | { type: 'alert'; data: Alert }
  | { type: 'system'; data: SystemStatus }
  | { type: 'settings'; data: Settings }
  | { type: 'simulation'; data: SimulationStatus }
  | { type: 'security'; data: { event: SecurityEvent; metrics: SecurityMetrics } }
  | { type: 'pong'; data?: undefined }

export type PageId =
  | 'overview'
  | 'live'
  | 'analytics'
  | 'emergency'
  | 'history'
  | 'network'
  | 'devices'
  | 'security'
  | 'settings'
