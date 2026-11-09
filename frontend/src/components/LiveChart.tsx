import { useEffect, useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, RANGE_SECONDS, type RangeId } from '../services/api'
import { useMonitor } from '../hooks/useMonitor'
import type { Reading } from '../types'
import { Badge, Card, SimBadge, cx } from './ui'

const RANGES: RangeId[] = ['1m', '5m', '15m', '1h', '24h']

export function useHistory(node: string | null, range: RangeId) {
  const { live, conn } = useMonitor()
  const [base, setBase] = useState<Reading[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!node) return
    let alive = true
    api.history(node, range).then((r) => alive && (setBase(r.points), setError(null))).catch((e) => alive && setError(String(e.message ?? e)))
    return () => {
      alive = false
    }
  }, [node, range, conn])
  const data = useMemo(() => {
    const since = Date.now() / 1000 - RANGE_SECONDS[range]
    const lastBase = base.length ? base[base.length - 1].received_at : 0
    const extra = (node ? live[node] ?? [] : []).filter((r) => r.received_at > lastBase)
    return [...base, ...extra].filter((r) => r.received_at >= since)
  }, [base, live, node, range])
  return { data, error }
}

export function LiveChart({ node, initialRange = '5m', height = 300, title = 'Live Sensor Telemetry' }: {
  node: string | null; initialRange?: RangeId; height?: number; title?: string
}) {
  const { settings, nodes } = useMonitor()
  const [range, setRange] = useState<RangeId>(initialRange)
  const { data, error } = useHistory(node, range)
  const simulated = node ? nodes[node]?.simulated : false
  const rows = data.map((r) => ({ t: r.received_at * 1000, temp: r.temp_c, hum: r.humidity }))
  const fmt = (t: number) => new Date(t).toLocaleTimeString([], range === '24h' ? { hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <Card
      title={title}
      icon={<Activity size={14} />}
      action={
        <div className="flex items-center gap-2">
          {simulated ? <SimBadge /> : <Badge tone="cyan" dot pulse>Live</Badge>}
          <div className="flex rounded-lg bg-white/5 p-0.5 ring-1 ring-white/10">
            {RANGES.map((r) => (
              <button key={r} onClick={() => setRange(r)} className={cx('rounded-md px-2 py-1 font-mono text-[11px] transition-colors', r === range ? 'bg-tele/20 text-tele' : 'text-slate-400 hover:text-slate-200')}>
                {r}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div style={{ height }} className="w-full min-w-0">
        {rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
            <Activity className="opacity-40" />
            {error ? `History unavailable: ${error}` : 'No readings in this time range yet'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmt} stroke="#475569" fontSize={11} tickLine={false} minTickGap={40} />
              <YAxis yAxisId="t" domain={[(min: number) => Math.floor(Math.min(min, 20)), (max: number) => Math.ceil(Math.max(max, (settings?.critical_c ?? 45) + 3))]} stroke="#475569" fontSize={11} tickLine={false} />
              <YAxis yAxisId="h" orientation="right" domain={[0, 100]} stroke="#475569" fontSize={11} tickLine={false} hide />
              <Tooltip
                contentStyle={{ background: 'rgba(8,12,22,.95)', border: '1px solid rgba(34,211,238,.2)', borderRadius: 12, fontSize: 12 }}
                labelFormatter={(t) => new Date(t as number).toLocaleString()}
                formatter={(v: number, n: string) => [v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}${n === 'Temperature' ? ' °C' : ' %'}`, n]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {settings && (
                <>
                  <ReferenceLine yAxisId="t" y={settings.warning_c} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: `Warn ${settings.warning_c}°`, fill: '#f59e0b', fontSize: 10, position: 'insideTopLeft' }} />
                  <ReferenceLine yAxisId="t" y={settings.critical_c} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `Critical ${settings.critical_c}°`, fill: '#ef4444', fontSize: 10, position: 'insideTopLeft' }} />
                </>
              )}
              <Line yAxisId="t" type="monotone" dataKey="temp" name="Temperature" stroke={simulated ? '#a78bfa' : '#f97316'} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} strokeDasharray={simulated ? '6 3' : undefined} />
              <Line yAxisId="h" type="monotone" dataKey="hum" name="Humidity" stroke="#22d3ee" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeOpacity={0.8} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}
