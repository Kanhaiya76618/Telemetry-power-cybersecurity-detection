import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { MonitorSocket, defaultWsUrl, type ConnState } from '../services/socket'
import type {
  Alert, NodeView, Reading, SecurityEvent, SecurityMetrics, Settings, SimulationStatus, SystemStatus, WsMessage,
} from '../types'

export interface MonitorState {
  conn: ConnState
  system: SystemStatus | null
  nodes: Record<string, NodeView>
  alerts: Record<number, Alert>
  live: Record<string, Reading[]>
  settings: Settings | null
  security: SecurityMetrics | null
  securityEvents: SecurityEvent[]
  lastMessageAt: number | null
}

const initial: MonitorState = {
  conn: 'connecting', system: null, nodes: {}, alerts: {}, live: {}, settings: null, security: null,
  securityEvents: [], lastMessageAt: null,
}

type Action = { kind: 'conn'; conn: ConnState } | { kind: 'msg'; msg: WsMessage }
const MAX_LIVE = 2000

export function reducer(s: MonitorState, a: Action): MonitorState {
  if (a.kind === 'conn') return { ...s, conn: a.conn }
  const m = a.msg
  const now = Date.now()
  switch (m.type) {
    case 'snapshot': {
      const nodes: Record<string, NodeView> = {}
      m.data.nodes.forEach((n) => (nodes[n.node] = n))
      const alerts: Record<number, Alert> = { ...s.alerts }
      m.data.active_alerts.forEach((x) => (alerts[x.id] = x))
      // anything we thought active but the server no longer lists is stale
      Object.values(alerts).forEach((x) => {
        if (!x.resolved_at && !m.data.active_alerts.find((y) => y.id === x.id)) delete alerts[x.id]
      })
      return { ...s, system: m.data.system, nodes, alerts, settings: m.data.settings, security: m.data.security, lastMessageAt: now }
    }
    case 'reading': {
      const r = m.data
      const list = [...(s.live[r.node] ?? []), r]
      if (list.length > MAX_LIVE) list.splice(0, list.length - MAX_LIVE)
      const node = s.nodes[r.node]
      return {
        ...s,
        live: { ...s.live, [r.node]: list },
        nodes: node ? { ...s.nodes, [r.node]: { ...node, latest: r, online: true, last_seen: r.received_at } } : s.nodes,
        lastMessageAt: now,
      }
    }
    case 'node':
      return { ...s, nodes: { ...s.nodes, [m.data.node]: m.data }, lastMessageAt: now }
    case 'alert':
      return { ...s, alerts: { ...s.alerts, [m.data.id]: m.data }, lastMessageAt: now }
    case 'system':
      return { ...s, system: m.data, security: m.data.security ?? s.security, lastMessageAt: now }
    case 'settings':
      return { ...s, settings: m.data }
    case 'simulation':
      return s.system ? { ...s, system: { ...s.system, simulation: m.data } } : s
    case 'security':
      return { ...s, security: m.data.metrics, securityEvents: [m.data.event, ...s.securityEvents].slice(0, 300) }
    default:
      return s
  }
}

interface Ctx extends MonitorState {
  focusNode: string | null
  activeCritical: Alert[]
  sim: SimulationStatus | null
}
const MonitorCtx = createContext<Ctx | null>(null)

export function MonitorProvider({ children, socketFactory }: { children: ReactNode; socketFactory?: typeof MonitorSocket }) {
  const [state, dispatch] = useReducer(reducer, initial)
  const ref = useRef<MonitorSocket | null>(null)
  useEffect(() => {
    const S = socketFactory ?? MonitorSocket
    const sock = new S(defaultWsUrl(), (msg) => dispatch({ kind: 'msg', msg }), (conn) => dispatch({ kind: 'conn', conn }))
    ref.current = sock
    sock.start()
    return () => sock.stop()
  }, [socketFactory])

  const value = useMemo<Ctx>(() => {
    const sim = state.system?.simulation ?? null
    const primary = state.system?.primary_node ?? 'node1'
    const real = state.nodes[primary]
    // Prefer the real device; show the simulator only when it's running and the real node isn't live.
    const focusNode = sim?.running && !real?.online ? sim.node : real ? primary : sim?.running ? sim.node : Object.keys(state.nodes)[0] ?? primary
    const activeCritical = Object.values(state.alerts)
      .filter((a) => a.severity === 'critical' && !a.resolved_at)
      .sort((a, b) => b.triggered_at - a.triggered_at)
    return { ...state, focusNode, activeCritical, sim }
  }, [state])

  return <MonitorCtx.Provider value={value}>{children}</MonitorCtx.Provider>
}

export function useMonitor() {
  const c = useContext(MonitorCtx)
  if (!c) throw new Error('useMonitor outside provider')
  return c
}
