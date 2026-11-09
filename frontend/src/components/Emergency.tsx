import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BellOff, BellRing, CheckCircle2, Eye, Siren, Volume2 } from 'lucide-react'
import { api } from '../services/api'
import type { Alert, Settings } from '../types'
import { Button, SimBadge, fmtTime } from './ui'

interface AlarmCtl {
  playing: boolean; unlocked: boolean; blocked: boolean; isMuted: boolean
  mute: () => void; unmute: () => void; enableAudio: () => Promise<boolean>
}

export function useAck() {
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const ack = async (id: number) => {
    setBusy(id); setErr(null)
    try { await api.acknowledge(id) } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  return { ack, busy, err }
}

export function EmergencyOverlay({ alert, settings, alarm, onView, onMinimize }: {
  alert: Alert | undefined; settings: Settings | null; alarm: AlarmCtl; onView: () => void; onMinimize: () => void
}) {
  const { ack, busy, err } = useAck()
  return (
    <AnimatePresence>
      {alert && (
        <motion.div
          role="alertdialog"
          aria-labelledby="emg-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="pointer-events-none absolute inset-0 animate-pulseRed bg-[radial-gradient(ellipse_at_center,rgba(239,68,68,.25),transparent_70%)]" />
          <motion.div
            initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
            className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-crit/60 bg-gradient-to-b from-[#2a0a0e] to-ink-950 p-6 shadow-crit sm:p-8"
          >
            <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-crit/30"><div className="h-full w-1/2 animate-sweep bg-crit" /></div>
            <div className="flex items-center gap-3">
              <motion.div animate={{ rotate: [0, -12, 12, -12, 0] }} transition={{ repeat: Infinity, duration: 1.1 }} className="rounded-2xl bg-crit/20 p-3 text-crit ring-1 ring-crit/50">
                <Siren size={30} />
              </motion.div>
              <div>
                <h2 id="emg-title" className="text-xl font-extrabold uppercase tracking-wide text-red-100 sm:text-2xl">🚨 Critical Temperature Detected</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-red-300/80">
                  <span className="font-mono">{alert.event_id}</span>·<span>{alert.node}</span>·<span>{fmtTime(alert.triggered_at)}</span>
                  {alert.simulated && <SimBadge />}
                </div>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-crit/10 p-4 ring-1 ring-crit/30">
                <div className="text-[11px] uppercase tracking-widest text-red-300/70">Temperature</div>
                <div className="font-mono text-4xl font-bold text-crit">{(alert.peak_value ?? alert.value)?.toFixed(1) ?? '--'}°C</div>
                <div className="text-[11px] text-red-300/60">peak this incident</div>
              </div>
              <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                <div className="text-[11px] uppercase tracking-widest text-slate-400">Safe limit</div>
                <div className="font-mono text-4xl font-bold text-slate-100">{settings?.critical_c ?? alert.threshold}°C</div>
                <div className="text-[11px] text-slate-500">critical threshold</div>
              </div>
            </div>
            <p className="mt-5 text-center text-sm font-bold uppercase tracking-[0.25em] text-red-200">Immediate attention required</p>
            {alarm.blocked && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-warn/10 p-3 text-sm text-warn ring-1 ring-warn/30">
                <span>Browser blocked the siren audio.</span>
                <Button tone="warn" onClick={() => alarm.enableAudio()}><Volume2 size={16} />Activate sound</Button>
              </div>
            )}
            {err && <div className="mt-3 rounded-lg bg-crit/10 p-2 text-xs text-red-300">Acknowledge failed: {err}</div>}
            <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Button tone="danger" onClick={() => ack(alert.id)} disabled={busy === alert.id}><CheckCircle2 size={16} />Acknowledge</Button>
              {alarm.isMuted
                ? <Button onClick={alarm.unmute}><BellRing size={16} />Unmute</Button>
                : <Button onClick={alarm.mute}><BellOff size={16} />Mute Siren</Button>}
              <Button tone="ghost" onClick={() => { onView(); onMinimize() }}><Eye size={16} />Sensor Details</Button>
            </div>
            <button onClick={onMinimize} className="mt-4 w-full text-center text-xs text-slate-500 hover:text-slate-300">Minimise to banner (alert stays active)</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function EmergencyBanner({ alerts, alarm, onOpen }: { alerts: Alert[]; alarm: AlarmCtl; onOpen: () => void }) {
  const top = alerts[0]
  const { ack, busy } = useAck()
  if (!top) return null
  const acked = !!top.acknowledged_at
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
      className="sticky top-0 z-40 border-b border-crit/50 bg-gradient-to-r from-crit/30 via-red-900/40 to-crit/30 backdrop-blur" role="alert">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <span className="flex items-center gap-2 font-bold uppercase tracking-wider text-red-100">
          <span className="h-2.5 w-2.5 animate-pulseRed rounded-full bg-crit" />
          {acked ? 'Critical — acknowledged, condition still active' : 'Critical temperature alert'}
        </span>
        <span className="font-mono text-sm text-red-200">{top.node} · {(top.peak_value ?? top.value)?.toFixed(1)}°C · {top.event_id}</span>
        {top.simulated && <SimBadge />}
        {alerts.length > 1 && <span className="text-xs text-red-300">+{alerts.length - 1} more</span>}
        <div className="ml-auto flex gap-2">
          {!acked && <Button tone="danger" className="!py-1 text-xs" onClick={() => ack(top.id)} disabled={busy === top.id}>Acknowledge</Button>}
          {!acked && (alarm.isMuted
            ? <Button className="!py-1 text-xs" onClick={alarm.unmute}><BellRing size={14} />Unmute</Button>
            : <Button className="!py-1 text-xs" onClick={alarm.mute}><BellOff size={14} />Mute</Button>)}
          {alarm.blocked && <Button tone="warn" className="!py-1 text-xs" onClick={() => alarm.enableAudio()}><Volume2 size={14} />Enable sound</Button>}
          <Button tone="ghost" className="!py-1 text-xs" onClick={onOpen}>Details</Button>
        </div>
      </div>
    </motion.div>
  )
}

export function AudioGate({ open, onEnable, onSkip }: { open: boolean; onEnable: () => void; onSkip: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ y: 16, scale: 0.97 }} animate={{ y: 0, scale: 1 }} className="glass w-full max-w-md rounded-3xl p-7 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-tele/10 text-tele ring-1 ring-tele/30"><Volume2 size={26} /></div>
            <h2 className="text-xl font-bold text-slate-100">Enable emergency audio</h2>
            <p className="mt-2 text-sm text-slate-400">Browsers block sound until you interact with the page. Enable audio so the railway-crossing siren can sound automatically when a critical temperature is detected.</p>
            <div className="mt-6 flex flex-col gap-2">
              <Button tone="primary" className="py-3 text-base" onClick={onEnable}><BellRing size={18} />Enable Emergency Audio</Button>
              <Button tone="ghost" onClick={onSkip}>Continue without sound (visual alerts only)</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
