import { useCallback, useEffect, useState } from 'react'
import { BellOff, BellRing, CheckCircle2, Download, History, Search, Siren } from 'lucide-react'
import { useMonitor } from '../hooks/useMonitor'
import { api, type AlertQuery } from '../services/api'
import { AlertDetail, AlertTable } from '../components/AlertTable'
import { useAck } from '../components/Emergency'
import { Badge, Button, Card, SimBadge, fmtDur, fmtTime } from '../components/ui'
import type { Alert } from '../types'

export function EmergencyAlerts({ alarm }: { alarm: { isMuted: boolean; mute: () => void; unmute: () => void; playing: boolean; unlocked: boolean } }) {
  const { alerts, settings } = useMonitor()
  const active = Object.values(alerts).filter((a) => !a.resolved_at).sort((a, b) => b.triggered_at - a.triggered_at)
  const { ack, busy, err } = useAck()
  const [sel, setSel] = useState<Alert | null>(null)
  return (
    <div className="flex flex-col gap-4">
      <Card title="Active emergencies" icon={<Siren size={14} />} action={
        <div className="flex items-center gap-2">
          <Badge tone={alarm.playing ? 'red' : 'slate'} dot pulse={alarm.playing}>Siren {alarm.playing ? 'sounding' : alarm.unlocked ? 'idle' : 'audio not enabled'}</Badge>
          {alarm.isMuted ? <Button onClick={alarm.unmute}><BellRing size={15} />Unmute</Button> : <Button onClick={alarm.mute}><BellOff size={15} />Mute</Button>}
        </div>}>
        {active.length === 0 && <div className="flex flex-col items-center gap-2 py-12 text-slate-500"><CheckCircle2 className="text-safe" size={32} />No active alerts</div>}
        <div className="grid gap-3 md:grid-cols-2">
          {active.map((a) => {
            const crit = a.severity === 'critical'
            return (
              <div key={a.id} className={`rounded-2xl p-4 ring-1 ${crit ? 'bg-crit/10 ring-crit/40' : 'bg-warn/5 ring-warn/30'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className={`font-bold ${crit ? 'text-red-200' : 'text-warn'}`}>{a.type === 'device_offline' ? 'Device offline' : crit ? 'Critical temperature' : 'Temperature warning'}</div>
                    <div className="font-mono text-xs text-slate-400">{a.event_id} · {a.node}</div>
                  </div>
                  <div className="flex gap-1">{a.simulated && <SimBadge />}<Badge tone={crit ? 'red' : 'amber'} dot pulse={crit && !a.acknowledged_at}>{a.state.replaceAll('_', ' ')}</Badge></div>
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div className="font-mono text-3xl font-bold text-slate-100">{a.type === 'temp' ? `${(a.peak_value ?? a.value)?.toFixed(1)}°C` : '—'}</div>
                  <div className="text-right text-xs text-slate-500">since {fmtTime(a.triggered_at)}<br />{fmtDur(a.duration_s)}</div>
                </div>
                {crit && a.acknowledged_at && <p className="mt-2 text-xs text-red-300/80">Acknowledged at {fmtTime(a.acknowledged_at)} — condition still active until below {settings?.recovery_c}°C for {settings?.recovery_seconds}s.</p>}
                <div className="mt-3 flex gap-2">
                  {crit && !a.acknowledged_at && <Button tone="danger" onClick={() => ack(a.id)} disabled={busy === a.id}><CheckCircle2 size={15} />Acknowledge</Button>}
                  <Button tone="ghost" onClick={() => setSel(a)}>Details</Button>
                </div>
              </div>
            )
          })}
        </div>
        {err && <div className="mt-3 text-sm text-crit">{err}</div>}
      </Card>
      <Card title="Alert state model">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {['NORMAL', 'WARNING', 'CRITICAL_UNACKNOWLEDGED', 'CRITICAL_ACKNOWLEDGED', 'RECOVERED'].map((s, i) => (
            <span key={s} className="flex items-center gap-2"><Badge tone={i === 0 ? 'green' : i === 1 ? 'amber' : i < 4 ? 'red' : 'cyan'}>{s.replaceAll('_', ' ')}</Badge>{i < 4 && <span className="text-slate-600">→</span>}</span>
          ))}
        </div>
        <p className="mt-3 text-sm text-slate-400">Detection runs in the backend. Critical triggers at ≥ {settings?.critical_c}°C and only clears after staying below {settings?.recovery_c}°C for {settings?.recovery_seconds}s (hysteresis). Muting silences audio only; acknowledging records operator response but never marks the temperature as safe.</p>
      </Card>
      <AlertDetail alert={sel} onClose={() => setSel(null)} />
    </div>
  )
}

export function AlertHistory() {
  const { alerts: live } = useMonitor()
  const [q, setQ] = useState<AlertQuery>({})
  const [text, setText] = useState('')
  const [from, setFrom] = useState('')
  const [rows, setRows] = useState<Alert[]>([])
  const [sel, setSel] = useState<Alert | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await api.alerts({ ...q, q: text || undefined, since: from ? new Date(from).getTime() / 1000 : undefined }))
      setErr(null)
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [q, text, from])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])
  // live-refresh when any alert changes
  const liveKey = Object.values(live).map((a) => `${a.id}:${a.state}:${a.acknowledged_at}`).join()
  useEffect(() => { load() }, [liveKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const nodes = Array.from(new Set(rows.map((r) => r.node)))
  const sel_ = 'rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-200 ring-1 ring-white/10 focus:outline-none focus:ring-tele'
  return (
    <Card title="Emergency alert history" icon={<History size={14} />} action={
      <a href={api.csvUrl({ ...q, q: text || undefined })} className="inline-flex items-center gap-2 rounded-xl bg-tele/15 px-3 py-1.5 text-sm text-tele ring-1 ring-tele/40 hover:bg-tele/25"><Download size={15} />CSV</a>}>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-500" />
          <input placeholder="Search event, device, state…" value={text} onChange={(e) => setText(e.target.value)} className={`${sel_} w-full pl-9`} />
        </label>
        <select className={sel_} value={q.severity ?? ''} onChange={(e) => setQ({ ...q, severity: e.target.value || undefined })}>
          <option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option>
        </select>
        <select className={sel_} value={q.node ?? ''} onChange={(e) => setQ({ ...q, node: e.target.value || undefined })}>
          <option value="">All devices</option>{nodes.map((n) => <option key={n}>{n}</option>)}
        </select>
        <input type="date" className={sel_} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
      </div>
      {err && <div className="mb-3 text-sm text-crit">{err}</div>}
      <div className={loading ? 'opacity-60' : ''}><AlertTable alerts={rows} onSelect={setSel} empty="No alerts match these filters" /></div>
      <AlertDetail alert={sel} onClose={() => setSel(null)} />
    </Card>
  )
}
