import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, ShieldAlert, Siren, Wifi, WifiOff, X } from 'lucide-react'
import { useMonitor } from '../hooks/useMonitor'

type Toast = { id: number; tone: 'red' | 'amber' | 'green' | 'cyan'; title: string; body?: string; icon: typeof Siren }
const TONE = {
  red: 'border-crit/50 bg-[#2a0a0e]/95 text-red-100',
  amber: 'border-warn/50 bg-[#2a1d06]/95 text-amber-100',
  green: 'border-safe/50 bg-[#06261c]/95 text-emerald-100',
  cyan: 'border-tele/40 bg-ink-900/95 text-slate-100',
}

/** Short pop-up notifications so users notice changes without watching every panel. */
export function Toasts() {
  const { nodes, alerts, securityEvents, conn } = useMonitor()
  const [toasts, setToasts] = useState<Toast[]>([])
  const seen = useRef<{ online: Record<string, boolean>; alerts: Set<string>; sec: number; conn: string; ready: boolean }>({
    online: {}, alerts: new Set(), sec: 0, conn: 'connecting', ready: false,
  })
  const push = (t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setToasts((x) => [...x.slice(-3), { ...t, id }])
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 6000)
  }

  useEffect(() => {
    const s = seen.current
    if (!s.ready) {
      // first snapshot: remember the current state silently
      Object.values(nodes).forEach((n) => (s.online[n.node] = n.online))
      Object.values(alerts).forEach((a) => s.alerts.add(`${a.id}:${a.state}`))
      s.sec = securityEvents[0]?.id ?? 0
      s.ready = Object.keys(nodes).length > 0 || conn === 'open'
      s.conn = conn
      return
    }
    Object.values(nodes).forEach((n) => {
      const was = s.online[n.node]
      if (was !== undefined && was !== n.online) {
        push(n.online
          ? { tone: 'green', icon: Wifi, title: `${n.node} is back online`, body: 'Live readings resumed.' }
          : { tone: 'amber', icon: WifiOff, title: `${n.node} went offline`, body: 'Check its power and Wi-Fi, or press RST on the ESP32.' })
      }
      s.online[n.node] = n.online
    })
    Object.values(alerts).forEach((a) => {
      const key = `${a.id}:${a.state}`
      if (s.alerts.has(key)) return
      s.alerts.add(key)
      if (a.type !== 'temp') return
      if (a.severity === 'critical' && a.state === 'CRITICAL_UNACKNOWLEDGED')
        push({ tone: 'red', icon: Siren, title: 'Critical temperature', body: `${a.node} reached ${(a.peak_value ?? a.value)?.toFixed(1)}°C` })
      else if (a.severity === 'warning' && !a.resolved_at)
        push({ tone: 'amber', icon: Siren, title: 'Temperature warning', body: `${a.node} at ${a.value?.toFixed(1)}°C` })
      else if (a.resolved_at && a.severity === 'critical')
        push({ tone: 'green', icon: CheckCircle2, title: 'Emergency resolved', body: `${a.node} back below the recovery level.` })
    })
    const newest = securityEvents[0]
    if (newest && newest.id > s.sec) {
      s.sec = newest.id
      if (newest.severity === 'high')
        push({ tone: 'red', icon: ShieldAlert, title: `Security: ${newest.kind.replace(/_/g, ' ')}${newest.simulated ? ' (simulated)' : ''}`, body: newest.detail ?? undefined })
    }
    if (s.conn !== conn) {
      if (conn === 'open' && s.conn === 'closed') push({ tone: 'green', icon: Wifi, title: 'Reconnected to backend' })
      s.conn = conn
    }
  }, [nodes, alerts, securityEvents, conn])

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[55] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 shadow-2xl backdrop-blur ${TONE[t.tone]}`}>
            <t.icon size={20} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{t.title}</div>
              {t.body && <div className="mt-0.5 text-xs opacity-80">{t.body}</div>}
            </div>
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="opacity-60 hover:opacity-100" aria-label="Dismiss"><X size={16} /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
