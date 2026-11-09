import { useState } from 'react'
import { FlaskConical, Minus, Play, Plus, RotateCcw, Square, Zap } from 'lucide-react'
import { api } from '../services/api'
import { useMonitor } from '../hooks/useMonitor'
import { Badge, Button, Card } from './ui'

export function SimulationPanel() {
  const { sim, settings } = useMonitor()
  const [setTo, setSetTo] = useState('38')
  const [err, setErr] = useState<string | null>(null)
  const run = async (f: () => Promise<unknown>) => {
    setErr(null)
    try { await f() } catch (e) { setErr((e as Error).message) }
  }
  const running = !!sim?.running
  return (
    <Card title="Demo Simulation" icon={<FlaskConical size={14} />} action={<Badge tone={running ? 'violet' : 'slate'} dot pulse={running}>{running ? `Running · ${sim?.node}` : 'Stopped'}</Badge>}>
      <p className="mb-3 text-xs text-slate-500">Synthetic readings on <span className="font-mono text-violet-300">{sim?.node ?? 'node1-sim'}</span>, processed by the same backend detection logic and clearly labelled as simulated.</p>
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-3xl font-bold text-violet-300">{sim ? sim.temp_c.toFixed(1) : '--'}°C</span>
        <span className="text-xs text-slate-500">target {sim?.target_c.toFixed(1) ?? '--'}°C · {sim?.humidity.toFixed(0) ?? '--'}% RH</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {running
          ? <Button onClick={() => run(api.simStop)}><Square size={15} />Stop</Button>
          : <Button tone="primary" onClick={() => run(api.simStart)}><Play size={15} />Start</Button>}
        <Button onClick={() => run(() => api.simCommand('decrease', undefined, 2))}><Minus size={15} />2°C</Button>
        <Button onClick={() => run(() => api.simCommand('increase', undefined, 2))}><Plus size={15} />2°C</Button>
        <Button tone="danger" onClick={() => run(() => api.simCommand('trigger'))}><Zap size={15} />Trigger</Button>
        <Button onClick={() => run(() => api.simCommand('reset'))}><RotateCcw size={15} />Reset</Button>
        <form className="col-span-2 flex gap-2 sm:col-span-1" onSubmit={(e) => { e.preventDefault(); run(() => api.simCommand('set', Number(setTo))) }}>
          <input aria-label="Set temperature" value={setTo} onChange={(e) => setSetTo(e.target.value)} type="number" step="0.5" min={-20} max={90}
            className="w-full min-w-0 rounded-xl bg-white/5 px-3 font-mono text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-tele" />
          <Button type="submit">Set</Button>
        </form>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[28, 38, 42, 46, 41, 30].map((t) => (
          <button key={t} onClick={() => run(() => api.simCommand('set', t))} className="rounded-lg bg-white/5 px-2 py-1 font-mono text-[11px] text-slate-400 ring-1 ring-white/10 hover:text-slate-100">{t}°</button>
        ))}
        <span className="self-center text-[11px] text-slate-600">demo steps · critical at {settings?.critical_c ?? 45}°, recovers below {settings?.recovery_c ?? 43}° after {settings?.recovery_seconds ?? 10}s</span>
      </div>
      {err && <div className="mt-2 text-xs text-crit">{err}</div>}
    </Card>
  )
}
