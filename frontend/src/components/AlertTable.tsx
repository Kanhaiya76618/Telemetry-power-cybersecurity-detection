import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { Alert } from '../types'
import { Badge, SimBadge, fmtDateTime, fmtDur, fmtNum, type Tone } from './ui'

export function sevTone(a: Alert): Tone {
  if (a.resolved_at) return 'slate'
  return a.severity === 'critical' ? 'red' : a.severity === 'warning' ? 'amber' : 'cyan'
}

export function AlertTable({ alerts, onSelect, empty = 'No alerts' }: { alerts: Alert[]; onSelect?: (a: Alert) => void; empty?: string }) {
  if (!alerts.length) return <div className="py-10 text-center text-sm text-slate-500">{empty}</div>
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-slate-500">
          <tr className="border-b border-white/5">
            {['Event', 'Device', 'Type', 'Value', 'Severity', 'Triggered', 'Ack', 'Duration', 'State'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id} onClick={() => onSelect?.(a)} className="cursor-pointer border-b border-white/[0.03] transition-colors hover:bg-white/[0.03]">
              <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{a.event_id}{a.device_event_id && <div className="text-slate-500">{a.device_event_id}</div>}</td>
              <td className="px-3 py-2.5 text-slate-300">{a.node} {a.simulated && <SimBadge />}</td>
              <td className="px-3 py-2.5 text-slate-400">{a.type === 'temp' ? 'Temperature' : a.type === 'device_offline' ? 'Device offline' : a.type}</td>
              <td className="px-3 py-2.5 font-mono text-slate-200">{a.type === 'temp' ? fmtNum(a.peak_value ?? a.value, 1, '°C') : '—'}</td>
              <td className="px-3 py-2.5"><Badge tone={a.severity === 'critical' ? 'red' : 'amber'}>{a.severity}</Badge></td>
              <td className="px-3 py-2.5 text-xs text-slate-400">{fmtDateTime(a.triggered_at)}</td>
              <td className="px-3 py-2.5 text-xs text-slate-400">{a.acknowledged_at ? new Date(a.acknowledged_at * 1000).toLocaleTimeString() : '—'}</td>
              <td className="px-3 py-2.5 font-mono text-xs text-slate-400">{fmtDur(a.duration_s)}</td>
              <td className="px-3 py-2.5"><Badge tone={sevTone(a)} dot={!a.resolved_at} pulse={!a.resolved_at && a.severity === 'critical'}>{a.state.replace('_', ' ')}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AlertDetail({ alert, onClose }: { alert: Alert | null; onClose: () => void }) {
  const rows: [string, React.ReactNode][] = alert ? [
    ['Event ID', <span className="font-mono">{alert.event_id}</span>],
    ['Device event ID', <span className="font-mono">{alert.device_event_id ?? '—'}</span>],
    ['Device', alert.node],
    ['Type', alert.type],
    ['Severity', alert.severity],
    ['Trigger value', fmtNum(alert.value, 1, '°C')],
    ['Peak value', fmtNum(alert.peak_value, 1, '°C')],
    ['Threshold', fmtNum(alert.threshold, 1)],
    ['State', alert.state],
    ['Detected by', alert.source],
    ['Simulated', alert.simulated ? 'Yes' : 'No'],
    ['Triggered', fmtDateTime(alert.triggered_at)],
    ['Acknowledged', fmtDateTime(alert.acknowledged_at)],
    ['Resolved', fmtDateTime(alert.resolved_at)],
    ['Duration', fmtDur(alert.duration_s)],
    ['Delivery status', alert.delivery_status ?? 'Not measurable'],
    ['ACK round trip', alert.rtt_ms != null ? `${alert.rtt_ms.toFixed(0)} ms (device clock)` : 'Not available'],
    ['Note', alert.note ?? '—'],
  ] : []
  return (
    <AnimatePresence>
      {alert && (
        <motion.div className="fixed inset-0 z-50 flex justify-end bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-ink-900 p-6" initial={{ x: 400 }} animate={{ x: 0 }} exit={{ x: 400 }} transition={{ type: 'spring', stiffness: 300, damping: 34 }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-100">Alert details</h3>
              <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/5" aria-label="Close"><X size={18} /></button>
            </div>
            <dl className="divide-y divide-white/5 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-slate-500">{k}</dt><dd className="text-right text-slate-200">{v}</dd></div>
              ))}
            </dl>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
