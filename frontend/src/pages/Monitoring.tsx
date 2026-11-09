import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Radio } from 'lucide-react'
import { useMonitor } from '../hooks/useMonitor'
import { HumidityCard, TemperatureGauge } from '../components/Gauges'
import { LiveChart, useHistory } from '../components/LiveChart'
import { Badge, Card, SimBadge, Stat, cx, fmtNum, fmtTime } from '../components/ui'
import type { RangeId } from '../services/api'

export function NodePicker({ value, onChange }: { value: string | null; onChange: (n: string) => void }) {
  const { nodes } = useMonitor()
  return (
    <div className="flex flex-wrap gap-2">
      {Object.values(nodes).map((n) => (
        <button key={n.node} onClick={() => onChange(n.node)}
          className={cx('flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm ring-1 transition-colors', n.node === value ? 'bg-tele/15 text-tele ring-tele/40' : 'bg-white/5 text-slate-400 ring-white/10 hover:text-slate-200')}>
          <span className={cx('h-2 w-2 rounded-full', n.online ? 'bg-safe' : 'bg-slate-600')} />
          <span className="font-mono">{n.node}</span>
          {n.simulated && <span className="text-[10px] uppercase text-violet-300">sim</span>}
        </button>
      ))}
      {!Object.keys(nodes).length && <span className="text-sm text-slate-500">No devices have reported yet. Power the ESP32 or start the simulation.</span>}
    </div>
  )
}

function useSelectedNode() {
  const { focusNode } = useMonitor()
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => { if (!sel && focusNode) setSel(focusNode) }, [focusNode, sel])
  return [sel ?? focusNode, setSel] as const
}

export function LiveMonitoring() {
  const { nodes, settings, live } = useMonitor()
  const [node, setNode] = useSelectedNode()
  const n = node ? nodes[node] : undefined
  const feed = (node ? live[node] ?? [] : []).slice(-40).reverse()
  return (
    <div className="flex flex-col gap-4">
      <NodePicker value={node} onChange={setNode} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TemperatureGauge node={n} settings={settings} />
        <div className="lg:col-span-2"><LiveChart node={node} initialRange="1m" height={330} title="Real-time stream" /></div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <HumidityCard node={n} history={feed.slice().reverse().map((r) => ({ t: r.received_at, h: r.humidity }))} />
        <Card className="lg:col-span-2" title="Incoming readings" icon={<Radio size={14} />} action={n?.simulated ? <SimBadge /> : <Badge tone="cyan">MQTT QoS 0</Badge>}>
          <div className="max-h-72 overflow-y-auto font-mono text-xs">
            {feed.length === 0 && <div className="py-8 text-center text-slate-500">Waiting for readings…</div>}
            {feed.map((r) => (
              <div key={`${r.received_at}-${r.seq}`} className="flex gap-4 border-b border-white/[0.03] py-1.5 text-slate-400">
                <span className="w-20 text-slate-500">{fmtTime(r.received_at)}</span>
                <span className="w-16">#{r.seq ?? '—'}</span>
                <span className={cx('w-20', r.temp_c === null ? 'text-crit' : (settings && r.temp_c >= settings.critical_c) ? 'text-crit' : (settings && r.temp_c >= settings.warning_c) ? 'text-warn' : 'text-slate-200')}>{r.temp_c === null ? 'INVALID' : `${r.temp_c.toFixed(1)}°C`}</span>
                <span className="w-16 text-tele">{fmtNum(r.humidity, 0, '%')}</span>
                {r.simulated && <span className="text-violet-300">simulated</span>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

export function Analytics() {
  const [node, setNode] = useSelectedNode()
  const [range, setRange] = useState<RangeId>('1h')
  const { data } = useHistory(node, range)
  const stats = useMemo(() => {
    const t = data.map((r) => r.temp_c).filter((v): v is number => v !== null)
    const h = data.map((r) => r.humidity).filter((v): v is number => v !== null)
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
    const sd = (a: number[]) => { const m = avg(a); return m === null ? null : Math.sqrt(avg(a.map((x) => (x - m) ** 2))!) }
    return { n: data.length, invalid: data.length - t.length, tMin: t.length ? Math.min(...t) : null, tMax: t.length ? Math.max(...t) : null, tAvg: avg(t), tSd: sd(t), hMin: h.length ? Math.min(...h) : null, hMax: h.length ? Math.max(...h) : null, hAvg: avg(h) }
  }, [data])
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <NodePicker value={node} onChange={setNode} />
        <div className="flex rounded-lg bg-white/5 p-0.5 ring-1 ring-white/10">
          {(['1m', '5m', '15m', '1h', '24h'] as RangeId[]).map((r) => (
            <button key={r} onClick={() => setRange(r)} className={cx('rounded-md px-2.5 py-1 font-mono text-xs', r === range ? 'bg-tele/20 text-tele' : 'text-slate-400')}>{r}</button>
          ))}
        </div>
      </div>
      <Card title={`Statistics · last ${range}`} icon={<BarChart3 size={14} />}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Samples" value={stats.n} />
          <Stat label="Invalid" value={stats.invalid} tone={stats.invalid ? 'amber' : undefined} />
          <Stat label="Temp min" value={fmtNum(stats.tMin, 1, '°')} />
          <Stat label="Temp max" value={fmtNum(stats.tMax, 1, '°')} tone="amber" />
          <Stat label="Temp avg" value={fmtNum(stats.tAvg, 1, '°')} />
          <Stat label="Temp σ" value={fmtNum(stats.tSd, 2)} />
          <Stat label="RH range" value={stats.hMin === null ? '—' : `${stats.hMin.toFixed(0)}–${stats.hMax!.toFixed(0)}%`} tone="cyan" />
          <Stat label="RH avg" value={fmtNum(stats.hAvg, 1, '%')} tone="cyan" />
        </div>
      </Card>
      <LiveChart key={`${node}-${range}`} node={node} initialRange={range} height={380} title="Temperature & humidity history" />
    </div>
  )
}
