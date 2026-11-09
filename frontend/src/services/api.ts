import type { Alert, Reading, Settings, SimulationStatus, SecurityEvent, SecurityMetrics } from '../types'

const KEY_STORAGE = 'esn.apiKey'

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}
export function setApiKey(v: string) {
  try {
    if (v) localStorage.setItem(KEY_STORAGE, v)
    else localStorage.removeItem(KEY_STORAGE)
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const key = getApiKey()
  if (key) headers['X-API-Key'] = key
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as object) } })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const j = await res.json()
      msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

export type RangeId = '1m' | '5m' | '15m' | '1h' | '24h'
export const RANGE_SECONDS: Record<RangeId, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '24h': 86400 }

export interface AlertQuery {
  severity?: string
  node?: string
  since?: number
  until?: number
  q?: string
}
const qs = (o: Record<string, unknown>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null) as [string, string][]).toString()

export const api = {
  history: (node: string | undefined, range: RangeId) =>
    req<{ points: Reading[] }>(`/api/sensors/history?${qs({ node, range })}`),
  alerts: (q: AlertQuery = {}) => req<Alert[]>(`/api/alerts?${qs({ ...q })}`),
  alert: (id: number) => req<Alert>(`/api/alerts/${id}`),
  acknowledge: (id: number) => req<Alert>(`/api/alerts/${id}/acknowledge`, { method: 'POST' }),
  csvUrl: (q: AlertQuery = {}) => `/api/alerts/export.csv?${qs({ ...q })}`,
  settings: () => req<Settings>('/api/settings'),
  saveSettings: (s: Partial<Settings>) => req<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
  simStart: () => req<SimulationStatus>('/api/simulation/start', { method: 'POST' }),
  simStop: () => req<SimulationStatus>('/api/simulation/stop', { method: 'POST' }),
  simCommand: (action: 'set' | 'increase' | 'decrease' | 'trigger' | 'reset', value?: number, step?: number) =>
    req<SimulationStatus>('/api/simulation/command', { method: 'POST', body: JSON.stringify({ action, value, step }) }),
  network: () => req<NetworkInfo>('/api/network'),
  securityEvents: () => req<SecurityEvent[]>('/api/security/events?limit=200'),
  securityMetrics: () => req<SecurityMetrics>('/api/security/metrics'),
  simulateAttack: (attack: string) =>
    req<{ findings: { kind: string; detail: string; blocked: boolean }[] }>('/api/security/simulate', {
      method: 'POST',
      body: JSON.stringify({ attack }),
    }),
  evaluateSecurity: () => req<SecurityEvaluation>('/api/security/evaluate', { method: 'POST' }),
}

export interface NetworkInfo {
  mqtt: import('../types').MqttStatus
  ws_clients: number
  devices: import('../types').NodeView[]
  emergency_ack_rtt_ms: { count: number; last: number | null; avg: number | null; method: string }
  five_g: {
    connected: boolean
    latency_ms: number | null
    packet_loss_pct: number | null
    throughput_mbps: number | null
    signal_rsrp_dbm: number | null
    slice: string | null
    note: string
  }
}

export interface EvalConfig {
  name: string
  kind: 'baseline' | 'rule' | 'ml'
  accuracy: number
  precision: number
  recall: number
  f1: number
  false_positive_rate: number
  latency_us_per_msg: number
  model_bytes: number | null
}
export interface SecurityEvaluation {
  dataset: string
  messages: number
  attacks: number
  ml_available: boolean
  configs: EvalConfig[]
  energy_consumption: string
}
