import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity, BarChart3, Bell, BellOff, BellRing, Cpu, History, LayoutDashboard, Menu, Network, Radio, Settings as Cog,
  ShieldAlert, Siren, Volume2, X,
} from 'lucide-react'
import { useMonitor } from '../hooks/useMonitor'
import type { PageId } from '../types'
import { Badge, cx, fmtAgo } from './ui'

export const NAV: { id: PageId; label: string; icon: typeof Activity; group: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Environmental' },
  { id: 'live', label: 'Live Monitoring', icon: Activity, group: 'Environmental' },
  { id: 'analytics', label: 'Sensor Analytics', icon: BarChart3, group: 'Environmental' },
  { id: 'emergency', label: 'Emergency Alerts', icon: Siren, group: 'Environmental' },
  { id: 'history', label: 'Alert History', icon: History, group: 'Environmental' },
  { id: 'security', label: 'Cybersecurity (P6)', icon: ShieldAlert, group: 'Cybersecurity' },
  { id: 'network', label: 'Network Monitoring', icon: Network, group: 'Infrastructure' },
  { id: 'devices', label: 'Device Management', icon: Cpu, group: 'Infrastructure' },
  { id: 'settings', label: 'Settings', icon: Cog, group: 'Infrastructure' },
]

function NavList({ page, go, badges }: { page: PageId; go: (p: PageId) => void; badges: Partial<Record<PageId, number>> }) {
  let lastGroup = ''
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((n) => {
        const header = n.group !== lastGroup
        lastGroup = n.group
        const active = n.id === page
        return (
          <div key={n.id}>
            {header && <div className="mb-1 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">{n.group}</div>}
            <button onClick={() => go(n.id)} className={cx('group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors', active ? 'text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200')}>
              {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-gradient-to-r from-tele/15 to-transparent ring-1 ring-tele/25" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
              {active && <motion.span layoutId="nav-bar" className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-tele" />}
              <n.icon size={17} className={cx('relative', active && 'text-tele')} />
              <span className="relative flex-1 text-left">{n.label}</span>
              {!!badges[n.id] && <span className="relative rounded-full bg-crit px-1.5 text-[10px] font-bold text-white">{badges[n.id]}</span>}
            </button>
          </div>
        )
      })}
    </nav>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-2">
      <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-tele/30 to-blue-600/20 ring-1 ring-tele/40">
        <Radio size={18} className="text-tele" />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-bold text-slate-100">5G Emergency</div>
        <div className="text-[11px] text-slate-500">Sensor Network · MEC</div>
      </div>
    </div>
  )
}

export function Sidebar({ page, go, open, setOpen }: { page: PageId; go: (p: PageId) => void; open: boolean; setOpen: (b: boolean) => void }) {
  const { activeCritical, securityEvents } = useMonitor()
  const recentThreats = securityEvents.filter((e) => e.severity === 'high' && Date.now() / 1000 - e.ts < 300).length
  const badges = { emergency: activeCritical.length, security: recentThreats }
  const content = (
    <div className="flex h-full flex-col gap-2 p-4">
      <Brand />
      <NavList page={page} go={(p) => { go(p); setOpen(false) }} badges={badges} />
      <div className="mt-auto rounded-xl bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-500 ring-1 ring-white/5">
        Transport: <span className="text-slate-300">Wi-Fi (local)</span><br />
        5G / MEC: <span className="text-slate-400">not connected</span><br />
        <span className="text-slate-600">Prototype — not certified for life-safety use.</span>
      </div>
    </div>
  )
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-white/5 bg-ink-900/60 backdrop-blur lg:block">{content}</aside>
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/60 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside className="fixed inset-y-0 left-0 z-50 w-72 border-r border-white/10 bg-ink-900 lg:hidden" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'spring', stiffness: 300, damping: 32 }}>
              <button className="absolute right-3 top-4 p-1 text-slate-400" onClick={() => setOpen(false)} aria-label="Close menu"><X size={20} /></button>
              {content}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="hidden text-right leading-tight xl:block">
      <div className="font-mono text-sm text-slate-200">{now.toLocaleTimeString()}</div>
      <div className="text-[11px] text-slate-500">{now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
    </div>
  )
}

export function TopBar({ onMenu, alarm, go }: {
  onMenu: () => void; go: (p: PageId) => void
  alarm: { playing: boolean; unlocked: boolean; isMuted: boolean; mute: () => void; unmute: () => void; enableAudio: () => Promise<boolean>; wantSound: boolean }
}) {
  const { conn, system, nodes, activeCritical, securityEvents } = useMonitor()
  const primary = system?.primary_node ?? 'node1'
  const esp = nodes[primary]
  const mqttOk = !!system?.mqtt.connected
  const backendOk = conn === 'open'
  const lastReading = Object.values(nodes).map((n) => n.latest?.received_at ?? 0).reduce((a, b) => Math.max(a, b), 0)
  const critical = activeCritical.length > 0
  const sysTone = !backendOk ? 'red' : critical ? 'red' : esp?.online || system?.simulation.running ? 'green' : 'amber'
  const sysText = !backendOk ? 'Backend offline' : critical ? 'Emergency' : esp?.online ? 'System online' : system?.simulation.running ? 'Simulation mode' : 'Awaiting sensor'
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const notif = activeCritical.length + securityEvents.filter((e) => Date.now() / 1000 - e.ts < 300).length

  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/80 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <button className="rounded-lg p-1.5 text-slate-300 hover:bg-white/5 lg:hidden" onClick={onMenu} aria-label="Open menu"><Menu size={20} /></button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold text-slate-100 sm:text-base">5G Emergency Sensor Network</h1>
          <div className="hidden text-[11px] text-slate-500 sm:block">Last reading: {fmtAgo(lastReading || null)}</div>
        </div>
        <div className="ml-2 hidden items-center gap-1.5 md:flex">
          <Badge tone={sysTone} dot pulse={critical}>{sysText}</Badge>
          <Badge tone={esp?.online ? 'green' : 'slate'} dot>ESP32 {esp?.online ? 'connected' : esp ? 'offline' : 'not seen'}</Badge>
          <Badge tone={mqttOk ? 'green' : system?.mqtt.enabled === false ? 'slate' : 'red'} dot>MQTT {mqttOk ? 'connected' : system?.mqtt.enabled === false ? 'disabled' : 'down'}</Badge>
          <Badge tone={backendOk ? 'green' : conn === 'connecting' ? 'amber' : 'red'} dot>Backend {conn === 'open' ? 'live' : conn}</Badge>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* compact mobile status: always keep the emergency indicator visible */}
          <span className={cx('h-2.5 w-2.5 rounded-full md:hidden', critical ? 'animate-pulseRed bg-crit' : backendOk ? 'bg-safe' : 'bg-warn')} />
          {critical && (
            <button onClick={() => go('emergency')} className="flex items-center gap-1.5 rounded-full bg-crit px-3 py-1 text-xs font-bold uppercase text-white shadow-crit">
              <Siren size={14} className="animate-pulseRed" /><span className="hidden sm:inline">Emergency</span>
            </button>
          )}
          {!alarm.unlocked ? (
            <button onClick={() => alarm.enableAudio()} className="flex items-center gap-1.5 rounded-full bg-warn/15 px-3 py-1 text-xs font-semibold text-warn ring-1 ring-warn/40" title="Enable emergency audio">
              <Volume2 size={14} /><span className="hidden sm:inline">Enable audio</span>
            </button>
          ) : alarm.wantSound || alarm.isMuted ? (
            <button onClick={alarm.isMuted ? alarm.unmute : alarm.mute} className="rounded-full p-2 text-slate-300 ring-1 ring-white/10 hover:bg-white/5" title={alarm.isMuted ? 'Unmute siren' : 'Mute siren'}>
              {alarm.isMuted ? <BellOff size={16} /> : <BellRing size={16} className="text-crit" />}
            </button>
          ) : (
            <span className="hidden rounded-full p-2 text-safe sm:block" title="Emergency audio enabled"><Volume2 size={16} /></span>
          )}
          <button onClick={() => go(critical ? 'emergency' : 'security')} className="relative rounded-full p-2 text-slate-300 ring-1 ring-white/10 hover:bg-white/5" aria-label="Notifications">
            <Bell size={16} />
            {notif > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-crit px-1.5 text-[10px] font-bold text-white">{notif}</span>}
          </button>
          <Clock />
        </div>
      </div>
    </header>
  )
}
