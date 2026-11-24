import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Circle, Loader2, Play, SkipForward, Square, Sparkles, X } from 'lucide-react'
import { api } from '../services/api'
import { useMonitor } from '../hooks/useMonitor'
import { Button, cx } from './ui'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One-click narrated demo: drives the simulator through the full emergency story,
 *  using the same backend logic as real sensor data. Open with the 'esn:demo' event. */
export function GuidedDemo() {
  const { settings, activeCritical } = useMonitor()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(-1)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const cancel = useRef(false)
  const skip = useRef(false)
  const crit = useRef(activeCritical)
  crit.current = activeCritical

  useEffect(() => {
    const h = () => setOpen(true)
    window.addEventListener('esn:demo', h)
    return () => window.removeEventListener('esn:demo', h)
  }, [])

  const t = settings ?? { warning_c: 40, critical_c: 45, recovery_c: 43, recovery_seconds: 10 }
  const normal = Math.round(t.warning_c - 12)
  const rising = +(t.warning_c - 2).toFixed(1)
  const warn = +((t.warning_c + t.critical_c) / 2).toFixed(1)
  const hot = +(t.critical_c + 1.5).toFixed(1)
  const cool = +(t.recovery_c - 3).toFixed(1)
  const set = (v: number) => () => api.simCommand('set', v)

  const steps = [
    { title: 'Normal operation', text: `The sensor reads ${normal}°C, below the ${t.warning_c}°C warning level. Everything is green.`, run: async () => { await api.simStop(); await api.simCommand('set', normal) }, wait: 6000 }, // stop = clean slate (closes old simulated alerts), set = restart at a normal value
    { title: 'Temperature rising', text: `It climbs to ${rising}°C. Still normal; watch the gauge and the graph move live.`, run: set(rising), wait: 6000 },
    { title: 'Warning', text: `At ${warn}°C it crosses ${t.warning_c}°C: the dashboard turns amber and a warning pop-up appears.`, run: set(warn), wait: 7000 },
    { title: 'Critical emergency', text: `${hot}°C crosses the ${t.critical_c}°C critical limit. The backend raises an alert, the red overlay opens and the railway siren sounds (if audio is enabled).`, run: set(hot), wait: 9000 },
    { title: 'Operator acknowledges', text: 'Acknowledging records that someone responded. The alert stays red, because it is still hot.', run: async () => { const a = crit.current.find((x) => x.simulated && !x.acknowledged_at); if (a) await api.acknowledge(a.id) }, wait: 6000 },
    { title: 'Cooling down', text: `It drops to ${cool}°C. The alarm only clears after ${t.recovery_seconds}s below ${t.recovery_c}°C, so it never flickers on and off.`, run: set(cool), wait: (t.recovery_seconds + 6) * 1000 },
    { title: 'Recovered', text: 'Back to normal. The whole incident is saved in Alert History with trigger, acknowledge and resolve times.', run: set(normal), wait: 3000 },
  ]

  const start = async () => {
    cancel.current = false
    setErr(null)
    setRunning(true)
    for (let i = 0; i < steps.length && !cancel.current; i++) {
      setStep(i)
      setProgress(0)
      try { await steps[i].run() } catch (e) { setErr((e as Error).message); break }
      const begin = Date.now()
      while (!cancel.current) {
        const p = (Date.now() - begin) / steps[i].wait
        setProgress(Math.min(1, p))
        if (p >= 1 || skip.current) { skip.current = false; break }
        await sleep(150)
      }
    }
    setRunning(false)
    if (!cancel.current) setStep(steps.length)
  }
  const stop = async () => {
    cancel.current = true
    setRunning(false)
    setStep(-1)
    try { await api.simStop() } catch { /* ignore */ }
  }
  const close = () => { if (running) stop(); setOpen(false); setStep(-1) }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }}
          className="fixed bottom-4 left-4 z-[57] w-[min(400px,calc(100vw-32px))] overflow-hidden rounded-3xl border border-violet-400/30 bg-ink-900/95 shadow-2xl backdrop-blur-xl"
          role="dialog" aria-label="Guided demo">
          <div className="flex items-center gap-2 border-b border-white/5 px-5 py-3">
            <Sparkles size={16} className="text-violet-300" />
            <span className="text-sm font-semibold text-slate-100">Guided demo</span>
            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300">simulated</span>
            <button onClick={close} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-white/5" aria-label="Close guided demo"><X size={16} /></button>
          </div>
          <div className="px-5 py-4">
            {step < 0 && <p className="text-sm text-slate-300">Walks through a full emergency in about 1 minute, with an explanation at each step. It uses the simulator, so no ESP32 is needed. Enable emergency audio first to hear the siren.</p>}
            {step >= 0 && step < steps.length && (
              <motion.div key={step} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-violet-300">Step {step + 1} of {steps.length}</div>
                <div className="mt-1 text-lg font-bold text-slate-100">{steps[step].title}</div>
                <p className="mt-1 text-sm leading-relaxed text-slate-300">{steps[step].text}</p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/5"><div className="h-full bg-violet-400 transition-[width] duration-150" style={{ width: `${progress * 100}%` }} /></div>
              </motion.div>
            )}
            {step >= steps.length && <p className="text-sm text-safe">Demo complete. Open Alert History to see the recorded incident.</p>}
            <ol className="mt-4 grid grid-cols-7 gap-1.5" aria-label="Steps">
              {steps.map((s, i) => (
                <li key={s.title} title={s.title} className="flex justify-center">
                  {i < step || step >= steps.length ? <CheckCircle2 size={16} className="text-safe" />
                    : i === step ? <Loader2 size={16} className="animate-spin text-violet-300" />
                    : <Circle size={16} className="text-slate-600" />}
                </li>
              ))}
            </ol>
            {err && <p className="mt-2 text-xs text-crit">{err}</p>}
            <div className="mt-4 flex gap-2">
              {!running
                ? <Button tone="primary" className={cx('flex-1')} onClick={start}><Play size={15} />{step >= 0 ? 'Run again' : 'Start demo'}</Button>
                : <>
                    <Button className="flex-1" onClick={() => (skip.current = true)}><SkipForward size={15} />Next step</Button>
                    <Button tone="ghost" onClick={stop}><Square size={15} />Stop</Button>
                  </>}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
