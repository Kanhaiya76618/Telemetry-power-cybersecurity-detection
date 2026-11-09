import type { WsMessage } from '../types'
import { getApiKey } from './api'

export type ConnState = 'connecting' | 'open' | 'closed'

/** Auto-reconnecting WebSocket with exponential back-off and keep-alive pings. */
export class MonitorSocket {
  private ws: WebSocket | null = null
  private retry = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private ping: ReturnType<typeof setInterval> | null = null
  private stopped = false
  public reconnects = 0

  constructor(
    private url: string,
    private onMessage: (m: WsMessage) => void,
    private onState: (s: ConnState) => void,
    private WS: typeof WebSocket = WebSocket,
  ) {}

  start() {
    this.stopped = false
    this.open()
  }

  private open() {
    this.onState('connecting')
    const key = getApiKey()
    const url = key ? `${this.url}?token=${encodeURIComponent(key)}` : this.url
    let ws: WebSocket
    try {
      ws = new this.WS(url)
    } catch {
      this.schedule()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.onState('open')
      this.ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), 15000)
    }
    ws.onmessage = (ev) => {
      try {
        this.onMessage(JSON.parse(ev.data as string))
      } catch {
        /* ignore malformed frame */
      }
    }
    ws.onclose = () => {
      if (this.ping) clearInterval(this.ping)
      this.ping = null
      this.ws = null
      this.onState('closed')
      if (!this.stopped) this.schedule()
    }
    ws.onerror = () => ws.close()
  }

  private schedule() {
    const delay = Math.min(10000, 500 * 2 ** this.retry)
    this.retry++
    this.reconnects++
    this.timer = setTimeout(() => this.open(), delay)
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.ping) clearInterval(this.ping)
    this.ws?.close()
  }
}

export function defaultWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws/monitor`
}
