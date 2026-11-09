import { act, render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RailwaySiren } from '../audio/RailwaySiren'
import { shouldSound } from '../hooks/useAlarm'
import { MonitorSocket } from '../services/socket'
import { reducer, type MonitorState } from '../hooks/useMonitor'
import { TemperatureGauge } from '../components/Gauges'
import { EmergencyOverlay } from '../components/Emergency'
import type { Alert, NodeView, Settings } from '../types'

// ---------- minimal Web Audio mock ----------
class P { value = 0; setValueAtTime() {} exponentialRampToValueAtTime() {} setTargetAtTime() {} cancelScheduledValues() {} }
class N { gain = new P(); frequency = new P(); threshold = new P(); ratio = new P(); type = ''; connect(n: unknown) { return n } disconnect() {} start() {} stop() {} }
class FakeCtx {
  static created = 0
  state: AudioContextState = 'suspended'
  currentTime = 0
  destination = {}
  oscillators = 0
  onstatechange: (() => void) | null = null
  constructor() { FakeCtx.created++ }
  async resume() { this.state = 'running' }
  async close() { this.state = 'closed' }
  createOscillator() { this.oscillators++; return new N() }
  createGain() { return new N() }
  createBiquadFilter() { return new N() }
  createDynamicsCompressor() { return new N() }
}

const settings: Settings = { warning_c: 40, critical_c: 45, recovery_c: 43, recovery_seconds: 10, offline_seconds: 10, flood_max_per_sec: 5 }
const alert = (o: Partial<Alert> = {}): Alert => ({
  id: 1, event_id: 'B-1-001', device_event_id: null, node: 'node1', type: 'temp', severity: 'critical', value: 46.5,
  peak_value: 46.5, threshold: 45, state: 'CRITICAL_UNACKNOWLEDGED', source: 'backend', simulated: false,
  triggered_at: Date.now() / 1000, acknowledged_at: null, resolved_at: null, delivery_status: null, rtt_ms: null, note: null, duration_s: 1, ...o,
})
const node = (o: Partial<NodeView> = {}): NodeView => ({
  node: 'node1', simulated: false, online: true, last_seen: Date.now() / 1000, msg_count: 5, last_seq: 5, rssi: -50,
  msgs_last_60s: 30, state: 'NORMAL', critical_alert_id: null,
  latest: { node: 'node1', seq: 5, received_at: Date.now() / 1000, temp_c: 29.5, humidity: 61, simulated: false }, ...o,
})

describe('railway siren', () => {
  beforeEach(() => { vi.useFakeTimers() })
  it('refuses to start before unlock (autoplay policy)', () => {
    const s = new RailwaySiren(FakeCtx as unknown as typeof AudioContext)
    expect(s.start()).toBe(false)
    expect(s.playing).toBe(false)
  })
  it('starts once, never overlaps, and stops cleanly', async () => {
    const s = new RailwaySiren(FakeCtx as unknown as typeof AudioContext)
    await s.unlock()
    const spy = vi.spyOn(globalThis, 'setInterval')
    expect(s.start()).toBe(true)
    expect(s.start()).toBe(true)
    expect(s.start()).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    s.stop()
    expect(s.playing).toBe(false)
    expect(s.start()).toBe(true)
    s.stop()
  })
})

describe('alarm decision', () => {
  it('sounds for unacknowledged critical, not when muted/acked/resolved', () => {
    expect(shouldSound([alert()], new Set())).toBe(true)
    expect(shouldSound([alert()], new Set([1]))).toBe(false)
    expect(shouldSound([alert({ acknowledged_at: 1 })], new Set())).toBe(false)
    expect(shouldSound([alert({ resolved_at: 1 })], new Set())).toBe(false)
    expect(shouldSound([alert({ id: 2 })], new Set([1]))).toBe(true) // new incident re-arms siren
  })
})

describe('state reducer', () => {
  const base: MonitorState = { conn: 'open', system: null, nodes: { node1: node() }, alerts: {}, live: {}, settings, security: null, securityEvents: [], lastMessageAt: null }
  it('applies live temperature updates', () => {
    const s = reducer(base, { kind: 'msg', msg: { type: 'reading', data: { node: 'node1', seq: 6, received_at: 2, temp_c: 41.2, humidity: 60, simulated: false } } })
    expect(s.nodes.node1.latest?.temp_c).toBe(41.2)
    expect(s.live.node1).toHaveLength(1)
  })
  it('tracks alert updates without losing them on mute', () => {
    const s = reducer(base, { kind: 'msg', msg: { type: 'alert', data: alert() } })
    expect(s.alerts[1].state).toBe('CRITICAL_UNACKNOWLEDGED')
  })
})

describe('websocket reconnection', () => {
  it('reconnects with back-off after the connection drops', () => {
    vi.useFakeTimers()
    const instances: FakeWS[] = []
    class FakeWS { readyState = 0; onopen?: () => void; onclose?: () => void; onmessage?: (e: { data: string }) => void; onerror?: () => void
      constructor() { instances.push(this) } send() {} close() { this.onclose?.() } }
    const states: string[] = []
    const msgs: unknown[] = []
    const sock = new MonitorSocket('ws://x/ws/monitor', (m) => msgs.push(m), (s) => states.push(s), FakeWS as unknown as typeof WebSocket)
    sock.start()
    instances[0].onopen?.()
    instances[0].onmessage?.({ data: '{"type":"pong"}' })
    instances[0].close()
    expect(states).toEqual(['connecting', 'open', 'closed'])
    vi.advanceTimersByTime(600)
    expect(instances).toHaveLength(2)
    expect(msgs).toHaveLength(1)
    sock.stop()
  })
})

describe('components', () => {
  it('shows live temperature and normal status', () => {
    render(<TemperatureGauge node={node()} settings={settings} />)
    expect(screen.getByTestId('temp-value')).toHaveTextContent('29.5')
    expect(screen.getByTestId('temp-status')).toHaveTextContent(/system normal/i)
  })
  it('never shows an offline sensor as safe', () => {
    render(<TemperatureGauge node={node({ online: false })} settings={settings} />)
    expect(screen.getByTestId('temp-status')).toHaveTextContent(/offline/i)
    expect(screen.queryByText(/system normal/i)).toBeNull()
  })
  it('labels simulated data', () => {
    render(<TemperatureGauge node={node({ simulated: true })} settings={settings} />)
    expect(screen.getByText(/simulated/i)).toBeInTheDocument()
  })
  it('emergency overlay shows details and mute does not clear the alert', () => {
    const mute = vi.fn()
    render(<EmergencyOverlay alert={alert()} settings={settings} onView={() => {}} onMinimize={() => {}}
      alarm={{ playing: true, unlocked: true, blocked: false, isMuted: false, mute, unmute: () => {}, enableAudio: async () => true }} />)
    expect(screen.getByText(/critical temperature detected/i)).toBeInTheDocument()
    expect(screen.getByText('46.5°C')).toBeInTheDocument()
    act(() => { fireEvent.click(screen.getByText(/mute siren/i)) })
    expect(mute).toHaveBeenCalled()
    expect(screen.getByText(/critical temperature detected/i)).toBeInTheDocument()
  })
  it('offers manual sound activation when autoplay is blocked', () => {
    render(<EmergencyOverlay alert={alert()} settings={settings} onView={() => {}} onMinimize={() => {}}
      alarm={{ playing: false, unlocked: false, blocked: true, isMuted: false, mute: () => {}, unmute: () => {}, enableAudio: async () => true }} />)
    expect(screen.getByText(/activate sound/i)).toBeInTheDocument()
  })
})
