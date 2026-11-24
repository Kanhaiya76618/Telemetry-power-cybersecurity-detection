import { CheckCircle2, Circle, ListChecks } from 'lucide-react'
import { useMonitor } from '../hooks/useMonitor'
import { siren } from '../audio/RailwaySiren'
import { useSirenState } from '../hooks/useAlarm'
import { Card, cx } from './ui'

/** Plain-language checklist: what is working, and what to do when something is not. */
export function SetupGuide() {
  const { conn, system, nodes } = useMonitor()
  useSirenState()
  const primary = system?.primary_node ?? 'node1'
  const esp = nodes[primary]
  const steps = [
    { ok: conn === 'open', label: 'Dashboard connected to backend', fix: 'Start the backend: uvicorn app.main:app --port 8000' },
    { ok: !!system?.mqtt.connected, label: 'MQTT broker running', fix: 'Start Mosquitto: mosquitto -c /tmp/mosquitto-demo.conf -v' },
    { ok: !!esp?.online, label: 'ESP32 sending live data', fix: esp ? 'Put the Mac and ESP32 on the same 2.4 GHz Wi-Fi, then press RST on the ESP32.' : 'Power the ESP32 with the full firmware (or use Demo Simulation below).' },
    { ok: siren.unlocked, label: 'Emergency audio enabled', fix: 'Click "Enable audio" at the top right so the siren can play.' },
  ]
  const done = steps.filter((s) => s.ok).length
  return (
    <Card title={`System setup · ${done}/${steps.length}`} icon={<ListChecks size={14} />}>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-safe transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ul className="flex flex-col gap-2.5">
        {steps.map((s) => (
          <li key={s.label} className="flex gap-3">
            {s.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-safe" /> : <Circle size={18} className="mt-0.5 shrink-0 text-warn" />}
            <div className="min-w-0">
              <div className={cx('text-sm', s.ok ? 'text-slate-300' : 'font-medium text-slate-100')}>{s.label}</div>
              {!s.ok && <div className="mt-0.5 text-xs text-slate-400">{s.fix}</div>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
