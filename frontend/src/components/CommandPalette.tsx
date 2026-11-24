import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CornerDownLeft, FlaskConical, Play, Search, Square, Volume2, Zap, Sparkles, BellRing } from 'lucide-react'
import { api } from '../services/api'
import { siren } from '../audio/RailwaySiren'
import type { PageId } from '../types'
import { NAV } from './Shell'
import { cx } from './ui'

type Item = { id: string; label: string; hint: string; icon: typeof Search; run: () => void | Promise<unknown> }

/** ⌘K / Ctrl+K (or "/"): jump to any page or run an action from the keyboard. */
export function CommandPalette({ go }: { go: (p: PageId) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? '')
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o) }
      else if (e.key === '/' && !typing) { e.preventDefault(); setOpen(true) }
    }
    const onEvt = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('esn:palette', onEvt)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('esn:palette', onEvt) }
  }, [])
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 30) } }, [open])

  const items: Item[] = useMemo(() => [
    { id: 'demo', label: 'Start guided demo', hint: 'Action', icon: Sparkles, run: () => window.dispatchEvent(new Event('esn:demo')) },
    { id: 'audio', label: 'Enable emergency audio', hint: 'Action', icon: Volume2, run: () => siren.unlock() },
    { id: 'test', label: 'Test siren (3 seconds)', hint: 'Action', icon: BellRing, run: async () => { await siren.unlock(); siren.start(); setTimeout(() => siren.stop(), 3000) } },
    { id: 'simstart', label: 'Start simulation', hint: 'Simulation', icon: Play, run: () => api.simStart() },
    { id: 'trigger', label: 'Trigger simulated emergency', hint: 'Simulation', icon: Zap, run: () => api.simCommand('trigger') },
    { id: 'reset', label: 'Reset simulation to 28°C', hint: 'Simulation', icon: FlaskConical, run: () => api.simCommand('reset') },
    { id: 'simstop', label: 'Stop simulation', hint: 'Simulation', icon: Square, run: () => api.simStop() },
    ...NAV.map((n) => ({ id: `go-${n.id}`, label: `Go to ${n.label}`, hint: n.group, icon: n.icon, run: () => go(n.id) })),
  ], [go])

  const shown = items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase()))
  const runItem = (i: Item | undefined) => { if (!i) return; setOpen(false); Promise.resolve(i.run()).catch(() => {}) }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
          <motion.div initial={{ y: -12, scale: 0.98 }} animate={{ y: 0, scale: 1 }} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-2xl" role="dialog" aria-label="Command palette">
            <div className="flex items-center gap-3 border-b border-white/5 px-4">
              <Search size={18} className="text-slate-500" />
              <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0) }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, shown.length - 1)) }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
                  if (e.key === 'Enter') runItem(shown[sel])
                  if (e.key === 'Escape') setOpen(false)
                }}
                placeholder="Search pages and actions…" className="h-14 flex-1 bg-transparent text-base text-slate-100 placeholder:text-slate-500 focus:outline-none" aria-label="Search commands" />
              <kbd className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[11px] text-slate-400">esc</kbd>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
              {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No matches</li>}
              {shown.map((i, idx) => (
                <li key={i.id} role="option" aria-selected={idx === sel}>
                  <button onMouseEnter={() => setSel(idx)} onClick={() => runItem(i)}
                    className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm', idx === sel ? 'bg-tele/10 text-white' : 'text-slate-300')}>
                    <i.icon size={17} className={idx === sel ? 'text-tele' : 'text-slate-500'} />
                    <span className="flex-1">{i.label}</span>
                    <span className="text-[11px] text-slate-500">{i.hint}</span>
                    {idx === sel && <CornerDownLeft size={14} className="text-slate-500" />}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-4 border-t border-white/5 px-4 py-2 text-[11px] text-slate-500">
              <span>↑↓ move</span><span>↵ run</span><span>⌘K or / to open</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
