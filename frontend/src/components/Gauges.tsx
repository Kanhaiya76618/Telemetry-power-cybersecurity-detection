import { motion } from 'framer-motion'
import { Droplets, Thermometer, WifiOff } from 'lucide-react'
import type { NodeView, Settings } from '../types'
import { Badge, Card, SimBadge, cx, fmtAgo, fmtTime, stateLabel, stateTone } from './ui'

const COLORS = { green: '#10b981', amber: '#f59e0b', red: '#ef4444', cyan: '#22d3ee', slate: '#64748b', violet: '#a78bfa' }

function arcPath(cx0: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx0 + r * Math.cos(a), cy + r * Math.sin(a)]
  const [x0, y0] = p(a0)
  const [x1, y1] = p(a1)
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`
}

export function TemperatureGauge({ node, settings, compact }: { node: NodeView | undefined; settings: Settings | null; compact?: boolean }) {
  const min = 0
  const max = 60
  const temp = node?.latest?.temp_c ?? null
  const online = !!node?.online
  const tone = stateTone(node?.state, online)
  const color = COLORS[tone]
  const critical = online && (node?.state === 'CRITICAL_UNACKNOWLEDGED' || node?.state === 'CRITICAL_ACKNOWLEDGED')
  const START = Math.PI * 0.75
  const SWEEP = Math.PI * 1.5
  const frac = temp === null ? 0 : Math.min(1, Math.max(0, (temp - min) / (max - min)))
  const tick = (v: number) => START + SWEEP * ((v - min) / (max - min))
  const size = compact ? 220 : 280
  const label = !node
    ? 'Awaiting device'
    : !online
      ? 'Sensor offline — no live data'
      : temp === null
        ? 'Invalid sensor reading'
        : stateLabel(node.state)

  return (
    <Card
      className={cx('relative overflow-hidden', critical && 'shadow-crit ring-1 ring-crit/50')}
      title="Temperature"
      icon={<Thermometer size={14} />}
      action={<div className="flex gap-1.5">{node?.simulated && <SimBadge />}<Badge tone={online ? 'green' : 'slate'} dot pulse={online}>{online ? 'Live' : 'Offline'}</Badge></div>}
    >
      {critical && <div className="pointer-events-none absolute inset-0 animate-pulseRed bg-crit/[0.07]" />}
      <div className="relative mx-auto" style={{ width: size, maxWidth: '100%' }}>
        <svg viewBox="0 0 200 200" className="w-full" role="img" aria-label={`Temperature ${temp ?? 'unknown'} degrees`}>
          <defs>
            <filter id="glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <path d={arcPath(100, 100, 80, START, START + SWEEP)} stroke="rgba(148,163,184,.12)" strokeWidth="14" fill="none" strokeLinecap="round" />
          {settings && (
            <>
              <path d={arcPath(100, 100, 92, tick(settings.warning_c), tick(settings.critical_c))} stroke={COLORS.amber} strokeOpacity=".5" strokeWidth="3" fill="none" />
              <path d={arcPath(100, 100, 92, tick(settings.critical_c), START + SWEEP)} stroke={COLORS.red} strokeOpacity=".6" strokeWidth="3" fill="none" />
            </>
          )}
          <motion.path
            d={arcPath(100, 100, 80, START, START + SWEEP)}
            stroke={color}
            strokeWidth="14"
            fill="none"
            strokeLinecap="round"
            filter="url(#glow)"
            initial={false}
            animate={{ pathLength: Math.max(frac, 0.001), stroke: color, opacity: online ? 1 : 0.35 }}
            transition={{ type: 'spring', stiffness: 60, damping: 16 }}
          />
          {[0, 15, 30, 45, 60].map((v) => {
            const a = tick(v)
            return <text key={v} x={100 + 62 * Math.cos(a)} y={100 + 62 * Math.sin(a) + 3} textAnchor="middle" className="fill-slate-600 font-mono" fontSize="8">{v}</text>
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
          {!online && node && <WifiOff size={18} className="mb-1 text-slate-500" />}
          <motion.div
            key={temp ?? 'na'}
            initial={{ scale: 0.96, opacity: 0.6 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cx('font-mono font-bold tabular-nums tracking-tight', compact ? 'text-4xl' : 'text-5xl', !online && 'text-slate-500 line-through decoration-1')}
            style={{ color: online ? color : undefined }}
            data-testid="temp-value"
          >
            {temp === null ? '--.-' : temp.toFixed(1)}
            <span className="text-2xl text-slate-400">°C</span>
          </motion.div>
          <div className={cx('mt-1 max-w-[80%] text-center text-xs font-semibold uppercase tracking-[0.15em]')} style={{ color }} data-testid="temp-status">
            {label}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span className="font-mono">{node?.node ?? '—'}</span>
        <span>Updated {node?.latest ? `${fmtTime(node.latest.received_at)} · ${fmtAgo(node.latest.received_at)}` : 'never'}</span>
      </div>
      {settings && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
          <div className="rounded-lg bg-safe/5 py-1.5 text-safe ring-1 ring-safe/20">Normal &lt; {settings.warning_c}°</div>
          <div className="rounded-lg bg-warn/5 py-1.5 text-warn ring-1 ring-warn/20">Warn {settings.warning_c}–{settings.critical_c}°</div>
          <div className="rounded-lg bg-crit/5 py-1.5 text-crit ring-1 ring-crit/20">Critical ≥ {settings.critical_c}°</div>
        </div>
      )}
    </Card>
  )
}

export function HumidityCard({ node, history }: { node: NodeView | undefined; history: { t: number; h: number | null }[] }) {
  const h = node?.latest?.humidity ?? null
  const online = !!node?.online
  const r = 42
  const c = 2 * Math.PI * r
  const pts = history.filter((p) => p.h !== null).slice(-60)
  const minH = Math.min(...pts.map((p) => p.h!), 100)
  const maxH = Math.max(...pts.map((p) => p.h!), 0)
  const span = Math.max(1, maxH - minH)
  const spark = pts.map((p, i) => `${(i / Math.max(1, pts.length - 1)) * 100},${30 - ((p.h! - minH) / span) * 26 - 2}`).join(' ')
  return (
    <Card title="Humidity" icon={<Droplets size={14} />} action={node?.simulated ? <SimBadge /> : undefined}>
      <div className="flex items-center gap-5">
        <div className="relative h-28 w-28 shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle cx="50" cy="50" r={r} stroke="rgba(148,163,184,.12)" strokeWidth="9" fill="none" />
            <motion.circle cx="50" cy="50" r={r} stroke="#22d3ee" strokeWidth="9" fill="none" strokeLinecap="round"
              strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c * (1 - (h ?? 0) / 100), opacity: online ? 1 : 0.3 }}
              transition={{ type: 'spring', stiffness: 60, damping: 16 }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cx('font-mono text-2xl font-bold', online ? 'text-tele' : 'text-slate-500')}>{h === null ? '--' : Math.round(h)}<span className="text-sm">%</span></span>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">RH</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-500">Last update</div>
          <div className="font-mono text-sm text-slate-300">{node?.latest ? fmtTime(node.latest.received_at) : '—'}</div>
          {!online && node && <div className="mt-1 text-xs text-slate-500">Device offline — value is stale</div>}
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-3 h-10 w-full">
            {pts.length > 1 && <polyline points={spark} fill="none" stroke="#22d3ee" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
          </svg>
          <div className="flex justify-between font-mono text-[10px] text-slate-600"><span>{pts.length ? `${minH.toFixed(0)}%` : ''}</span><span>last {pts.length} readings</span><span>{pts.length ? `${maxH.toFixed(0)}%` : ''}</span></div>
        </div>
      </div>
    </Card>
  )
}
