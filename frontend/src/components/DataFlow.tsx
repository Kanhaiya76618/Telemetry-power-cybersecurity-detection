import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Cpu, Monitor, Radio, ShieldCheck, Workflow, Wifi } from 'lucide-react'
import { useMonitor } from '../hooks/useMonitor'
import type { PageId, Reading } from '../types'
import { Card, cx } from './ui'

/** Live pipeline view: every reading is drawn as a pulse travelling sensor → dashboard.
 *  Simulated readings are injected at the backend, so their pulse honestly starts there. */
export function DataFlow({ go }: { go: (p: PageId) => void }) {
  const { conn, system, nodes, live, activeCritical, security } = useMonitor()
  const primary = system?.primary_node ?? 'node1'
  const esp = nodes[primary]
  const sim = system?.simulation
  const rtt = system?.mqtt.broker_rtt_ms_avg

  const latest = useMemo(() => {
    let best: Reading | null = null
    for (const arr of Object.values(live)) {
      const r = arr[arr.length - 1]
      if (r && (!best || r.received_at > best.received_at)) best = r
    }
    return best
  }, [live])

  const [pulses, setPulses] = useState<{ id: number; sim: boolean }[]>([])
  const lastTs = useRef(0)
  useEffect(() => {
    if (!latest || latest.received_at <= lastTs.current) return
    lastTs.current = latest.received_at
    const id = Date.now() + Math.random()
    setPulses((p) => [...p.slice(-3), { id, sim: latest.simulated }])
    const t = setTimeout(() => setPulses((p) => p.filter((x) => x.id !== id)), 1500)
    return () => clearTimeout(t)
  }, [latest])

  const stages = [
    { label: 'ESP32 + DHT11', sub: esp?.online ? `${esp.latest?.temp_c?.toFixed(1) ?? '--'}°C live` : sim?.running ? 'simulator on' : 'offline', ok: !!esp?.online || !!sim?.running, icon: Cpu, page: 'devices' as PageId },
    { label: 'Wi-Fi / 5G', sub: esp?.online && esp.rssi != null ? `${esp.rssi} dBm` : esp?.online ? 'connected' : 'no device', ok: !!esp?.online, icon: Wifi, page: 'network' as PageId },
    { label: 'MQTT broker', sub: system?.mqtt.connected ? (rtt != null ? `${rtt} ms RTT` : 'connected') : 'down', ok: !!system?.mqtt.connected, icon: Radio, page: 'network' as PageId },
    { label: 'Security + alerts', sub: `${security?.inspected ?? 0} msgs checked`, ok: conn === 'open', icon: ShieldCheck, page: 'security' as PageId },
    { label: 'Dashboard', sub: activeCritical.length ? 'EMERGENCY' : conn === 'open' ? 'live' : 'reconnecting', ok: conn === 'open', crit: activeCritical.length > 0, icon: Monitor, page: 'live' as PageId },
  ]

  return (
    <Card title="Live data flow" icon={<Workflow size={14} />} action={
      <div className="flex items-center gap-3 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-tele" />real reading</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-400" />simulated</span>
      </div>}>
      <div className="relative">
        {/* track */}
        <div className="pointer-events-none absolute left-[10%] right-[10%] top-[34px] h-0.5 rounded-full bg-gradient-to-r from-tele/10 via-tele/30 to-tele/10" />
        <AnimatePresence>
          {pulses.map((p) => (
            <motion.span key={p.id}
              className={cx('pointer-events-none absolute top-[29px] z-10 h-3 w-3 -translate-x-1/2 rounded-full', p.sim ? 'bg-violet-400 shadow-[0_0_14px_#a78bfa]' : 'bg-tele shadow-[0_0_14px_#22d3ee]')}
              initial={{ left: p.sim ? '70%' : '10%', opacity: 0 }}
              animate={{ left: '90%', opacity: [0, 1, 1, 0] }}
              transition={{ duration: p.sim ? 0.6 : 1.3, ease: 'easeInOut' }} />
          ))}
        </AnimatePresence>
        <div className="grid grid-cols-5 gap-2 sm:gap-3">
          {stages.map((s) => (
            <motion.button key={s.label} onClick={() => go(s.page)} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
              title={`Open ${s.page} page`}
              className="group flex min-w-0 flex-col items-center gap-2 rounded-xl p-1 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-tele">
              <span className={cx('relative z-0 flex h-[68px] w-[68px] max-w-full items-center justify-center rounded-2xl ring-1 transition-colors',
                s.crit ? 'bg-crit/20 text-crit ring-crit/60 animate-pulseRed' : s.ok ? 'bg-ink-800 text-tele ring-tele/30 group-hover:ring-tele/70' : 'bg-ink-800 text-slate-500 ring-white/10')}>
                <s.icon size={26} />
                <span className={cx('absolute -right-1 -top-1 h-3 w-3 rounded-full ring-2 ring-ink-900', s.crit ? 'bg-crit' : s.ok ? 'bg-safe' : 'bg-warn')} />
              </span>
              <span className="w-full truncate text-[11px] font-semibold text-slate-200 sm:text-sm">{s.label}</span>
              <span className={cx('hidden w-full truncate text-xs sm:block', s.crit ? 'font-bold text-crit' : s.ok ? 'text-slate-400' : 'text-warn')}>{s.sub}</span>
            </motion.button>
          ))}
        </div>
      </div>
    </Card>
  )
}
