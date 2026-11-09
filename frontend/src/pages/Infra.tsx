import { useEffect, useState } from 'react'
import { Antenna, Cpu, KeyRound, Network as NetIcon, Save, Server, Volume2, WifiOff } from 'lucide-react'
import { useMonitor } from '../hooks/useMonitor'
import { api, getApiKey, setApiKey, type NetworkInfo } from '../services/api'
import { siren } from '../audio/RailwaySiren'
import { useSirenState } from '../hooks/useAlarm'
import { Badge, Button, Card, NA, SimBadge, Stat, fmtAgo, fmtDateTime, fmtDur } from '../components/ui'
import type { Settings } from '../types'

export function NetworkPage() {
  const { system, conn, nodes } = useMonitor()
  const [net, setNet] = useState<NetworkInfo | null>(null)
  useEffect(() => {
    const load = () => api.network().then(setNet).catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])
  const m = system?.mqtt
  const v = (x: number | null | undefined, unit: string) => (x === null || x === undefined ? <NA /> : `${x}${unit}`)
  const real = Object.values(nodes).filter((n) => !n.simulated)
  const sim = system?.simulation.running
  return (
    <div className="flex flex-col gap-4">
      <Card title="Measured on this deployment (local Wi-Fi)" icon={<NetIcon size={14} />} action={<Badge tone="cyan">Real measurements</Badge>}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="MQTT broker" value={m?.connected ? 'Connected' : m?.enabled === false ? 'Disabled' : 'Disconnected'} tone={m?.connected ? 'green' : 'red'} hint={m?.host ? `${m.host}:${m.port}${m.authenticated ? ' · auth' : ' · anonymous'}` : undefined} />
          <Stat label="Broker RTT (QoS1 probe)" value={v(m?.broker_rtt_ms_avg, ' ms')} hint="backend ↔ broker, monotonic clock" />
          <Stat label="Probe loss" value={v(m?.probe_loss_pct, ' %')} hint="backend ↔ broker" />
          <Stat label="Dashboard WebSocket" value={conn} tone={conn === 'open' ? 'green' : 'amber'} hint={`${system?.ws_clients ?? 0} client(s)`} />
          <Stat label="MQTT msgs received" value={m?.messages_rx ?? <NA />} />
          <Stat label="MQTT msgs sent" value={m?.messages_tx ?? <NA />} hint="ACK + config + probes" />
          <Stat label="Reconnects" value={m?.connects !== undefined ? Math.max(0, m.connects - 1) : <NA />} hint={m?.last_error ?? 'no errors'} />
          <Stat label="Emergency ACK RTT" value={v(net?.emergency_ack_rtt_ms.avg, ' ms')} hint={net?.emergency_ack_rtt_ms.count ? `${net.emergency_ack_rtt_ms.count} samples, ESP32 clock` : 'needs a real ESP32 emergency'} />
        </div>
      </Card>
      <Card title="Device heartbeat" icon={<Cpu size={14} />}>
        <div className="grid gap-3 md:grid-cols-3">
          {real.length === 0 && <div className="text-sm text-slate-500">No real devices have connected yet.</div>}
          {real.map((n) => (
            <div key={n.node} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
              <div className="flex justify-between"><span className="font-mono text-slate-200">{n.node}</span><Badge tone={n.online ? 'green' : 'slate'} dot>{n.online ? 'online' : 'offline'}</Badge></div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-400">
                <div>Last seen<br /><span className="text-slate-200">{fmtAgo(n.last_seen)}</span></div>
                <div>Msgs/60s<br /><span className="font-mono text-slate-200">{n.msgs_last_60s}</span></div>
                <div>Wi-Fi RSSI<br /><span className="font-mono text-slate-200">{n.rssi != null ? `${n.rssi} dBm` : 'n/a'}</span></div>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Private 5G / MEC metrics" icon={<Antenna size={14} />} action={<Badge tone="slate">Not connected</Badge>}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="5G latency" value={<NA />} />
          <Stat label="Packet loss" value={<NA />} />
          <Stat label="Throughput" value={<NA />} />
          <Stat label="Signal (RSRP)" value={<NA />} />
          <Stat label="Network slice" value={<NA />} />
        </div>
        <p className="mt-3 text-sm text-slate-400">{net?.five_g.note ?? 'Not available.'} Planned collectors: Anubhav 5G board telemetry, <span className="font-mono">iperf3</span> background load (no / medium / heavy), InfluxDB time-series and Grafana. Note: MQTT QoS (message delivery guarantee) is not the same as 5G QoS (5QI / slicing).</p>
        {sim && <div className="mt-3 flex items-center gap-2 text-xs text-violet-300"><SimBadge />Simulation is running — simulated readings do not traverse MQTT, so they don't affect the metrics above.</div>}
      </Card>
    </div>
  )
}

export function DevicesPage() {
  const { nodes, settings } = useMonitor()
  const list = Object.values(nodes)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.length === 0 && <Card><div className="py-8 text-center text-sm text-slate-500">No devices yet — power on the ESP32 (see docs/setup-guide.md) or start the simulation.</div></Card>}
        {list.map((n) => (
          <Card key={n.node} title={n.node} icon={n.online ? <Cpu size={14} /> : <WifiOff size={14} />} action={<div className="flex gap-1">{n.simulated && <SimBadge />}<Badge tone={n.online ? 'green' : 'slate'} dot pulse={n.online}>{n.online ? 'online' : 'offline'}</Badge></div>}>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Temperature" value={n.online && n.latest?.temp_c != null ? `${n.latest.temp_c.toFixed(1)}°C` : 'No live data'} tone={n.online ? undefined : 'slate'} />
              <Stat label="Humidity" value={n.online && n.latest?.humidity != null ? `${n.latest.humidity.toFixed(0)}%` : '—'} tone="cyan" />
              <Stat label="Alert state" value={n.state.replaceAll('_', ' ')} />
              <Stat label="Last seen" value={fmtAgo(n.last_seen)} hint={fmtDateTime(n.last_seen)} />
              <Stat label="Messages" value={n.msg_count} hint={`last seq #${n.last_seq ?? '—'}`} />
              <Stat label="Type" value={n.simulated ? 'Simulator' : 'ESP32 + DHT11'} />
            </div>
            {!n.online && <p className="mt-3 text-xs text-slate-500">Offline after {settings?.offline_seconds}s without telemetry. The last value is not treated as safe.</p>}
          </Card>
        ))}
      </div>
      <Card title="Reference wiring (typical 3-pin DHT11 module — verify your pinout)" icon={<Cpu size={14} />}>
        <div className="grid gap-2 font-mono text-sm sm:grid-cols-3">
          {[['VCC (+)', '3V3'], ['DATA (S/OUT)', 'GPIO4'], ['GND (−)', 'GND']].map(([a, b]) => (
            <div key={a} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/5"><span className="text-slate-300">DHT11 {a}</span><span className="text-tele">→ ESP32 {b}</span></div>
          ))}
        </div>
      </Card>
    </div>
  )
}

export function SettingsPage() {
  const { settings, system } = useMonitor()
  const [form, setForm] = useState<Settings | null>(settings)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [key, setKey] = useState(getApiKey())
  useSirenState()
  useEffect(() => { if (settings && !form) setForm(settings) }, [settings, form])
  const save = async () => {
    if (!form) return
    try {
      setForm(await api.saveSettings(form))
      setMsg({ ok: true, text: 'Saved. Backend thresholds updated and pushed to devices on campus/<node>/config.' })
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
  }
  const field = (k: keyof Settings, label: string, unit: string, step = 0.5) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      <div className="flex items-center rounded-xl bg-white/5 ring-1 ring-white/10 focus-within:ring-tele">
        <input type="number" step={step} value={form?.[k] ?? ''} onChange={(e) => form && setForm({ ...form, [k]: Number(e.target.value) })} className="w-full bg-transparent px-3 py-2 font-mono text-slate-100 focus:outline-none" />
        <span className="pr-3 text-xs text-slate-500">{unit}</span>
      </div>
    </label>
  )
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Detection thresholds (enforced by backend)" icon={<Server size={14} />}>
        <div className="grid grid-cols-2 gap-3">
          {field('warning_c', 'Warning at ≥', '°C')}
          {field('critical_c', 'Critical at ≥', '°C')}
          {field('recovery_c', 'Recover below', '°C')}
          {field('recovery_seconds', 'Recovery hold', 's', 1)}
          {field('offline_seconds', 'Offline timeout', 's', 1)}
          {field('flood_max_per_sec', 'Flood limit (P6)', 'msg/s', 1)}
        </div>
        <p className="mt-3 text-xs text-slate-500">Keep <span className="font-mono">TEMPERATURE_THRESHOLD</span> in the ESP32 sketch equal to the critical value. The backend also publishes these values (retained) on <span className="font-mono">campus/node1/config</span>, and the firmware applies them on connect.</p>
        <div className="mt-4 flex items-center gap-3">
          <Button tone="primary" onClick={save}><Save size={15} />Save thresholds</Button>
          {msg && <span className={`text-xs ${msg.ok ? 'text-safe' : 'text-crit'}`}>{msg.text}</span>}
        </div>
      </Card>
      <div className="flex flex-col gap-4">
        <Card title="Emergency audio" icon={<Volume2 size={14} />}>
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={1} step={0.05} value={siren.volume} onChange={(e) => siren.setVolume(Number(e.target.value))} className="flex-1 accent-cyan-400" aria-label="Siren volume" />
            <span className="w-10 font-mono text-sm text-slate-300">{Math.round(siren.volume * 100)}%</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {!siren.unlocked && <Button tone="warn" onClick={() => siren.unlock()}>Enable audio</Button>}
            <Button disabled={!siren.unlocked} onClick={() => { siren.start(); setTimeout(() => siren.stop(), 3000) }}>Test siren (3s)</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Status: {siren.unlocked ? 'enabled' : 'blocked until you click (browser autoplay policy)'}</p>
        </Card>
        <Card title="API access" icon={<KeyRound size={14} />}>
          <p className="mb-3 text-xs text-slate-500">Backend API auth is <b className="text-slate-300">{system?.api_auth ? 'ON' : 'OFF (local demo)'}</b>. When <span className="font-mono">API_TOKEN</span> is set, enter it here; it is stored only in this browser and sent as <span className="font-mono">X-API-Key</span>. MQTT credentials never reach the browser.</p>
          <div className="flex gap-2">
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="API token" className="w-full rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-tele" />
            <Button onClick={() => { setApiKey(key); location.reload() }}>Save</Button>
          </div>
        </Card>
        <Card title="System">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Backend uptime" value={fmtDur(system?.uptime_s)} />
            <Stat label="Transport" value="Wi-Fi" hint="5G: not connected" />
          </div>
        </Card>
      </div>
    </div>
  )
}
