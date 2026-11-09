import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MonitorProvider, useMonitor } from './hooks/useMonitor'
import { useAlarm } from './hooks/useAlarm'
import { NAV, Sidebar, TopBar } from './components/Shell'
import { AudioGate, EmergencyBanner, EmergencyOverlay } from './components/Emergency'
import Overview from './pages/Overview'
import { Analytics, LiveMonitoring } from './pages/Monitoring'
import { AlertHistory, EmergencyAlerts } from './pages/Alerts'
import { DevicesPage, NetworkPage, SettingsPage } from './pages/Infra'
import SecurityPage from './pages/Security'
import type { PageId } from './types'

function usePage(): [PageId, (p: PageId) => void] {
  const read = () => (location.hash.slice(1) as PageId) || 'overview'
  const [page, setPage] = useState<PageId>(NAV.some((n) => n.id === read()) ? read() : 'overview')
  useEffect(() => {
    const f = () => NAV.some((n) => n.id === read()) && setPage(read())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return [page, (p) => { location.hash = p; setPage(p); window.scrollTo({ top: 0 }) }]
}

function Dashboard() {
  const [page, go] = usePage()
  const [menu, setMenu] = useState(false)
  const { activeCritical, settings, conn } = useMonitor()
  const alarm = useAlarm(activeCritical)
  const [gate, setGate] = useState(true)
  const [minimized, setMinimized] = useState<Set<number>>(new Set())
  const top = activeCritical.find((a) => !a.acknowledged_at && !minimized.has(a.id))

  const title = NAV.find((n) => n.id === page)?.label
  const body = {
    overview: <Overview go={go} />,
    live: <LiveMonitoring />,
    analytics: <Analytics />,
    emergency: <EmergencyAlerts alarm={alarm} />,
    history: <AlertHistory />,
    network: <NetworkPage />,
    devices: <DevicesPage />,
    security: <SecurityPage />,
    settings: <SettingsPage />,
  }[page]

  return (
    <div className="flex min-h-screen">
      <Sidebar page={page} go={go} open={menu} setOpen={setMenu} />
      <div className="flex min-w-0 flex-1 flex-col">
        <EmergencyBanner alerts={activeCritical} alarm={alarm} onOpen={() => { setMinimized(new Set()); go('emergency') }} />
        <TopBar onMenu={() => setMenu(true)} alarm={alarm} go={go} />
        {conn !== 'open' && (
          <div className="border-b border-warn/30 bg-warn/10 px-6 py-2 text-xs text-warn">
            Backend connection {conn}. Live data paused; reconnecting automatically… Readings shown may be stale.
          </div>
        )}
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="text-xl font-bold text-slate-100 sm:text-2xl">{title}</h2>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={page} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              {body}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <EmergencyOverlay alert={top} settings={settings} alarm={alarm} onView={() => go('live')}
        onMinimize={() => top && setMinimized((m) => new Set([...m, top.id]))} />
      <AudioGate open={gate && !alarm.unlocked} onEnable={async () => { await alarm.enableAudio(); setGate(false) }} onSkip={() => setGate(false)} />
    </div>
  )
}

export default function App() {
  return (
    <MonitorProvider>
      <Dashboard />
    </MonitorProvider>
  )
}
