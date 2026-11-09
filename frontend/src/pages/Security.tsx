import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Bug, FlaskConical, KeyRound, Lock, Microscope, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useMonitor } from '../hooks/useMonitor'
import { api, type SecurityEvaluation } from '../services/api'
import { Badge, Button, Card, SimBadge, Stat, cx, fmtTime } from '../components/ui'
import type { SecurityEvent } from '../types'

const ATTACKS: { id: string; label: string; desc: string }[] = [
  { id: 'replay', label: 'Replay', desc: 'Re-send an old captured frame' },
  { id: 'flood', label: 'Flood / DoS', desc: 'Burst above rate limit' },
  { id: 'spoof', label: 'Spoofed device', desc: 'Unprovisioned / mismatched node' },
  { id: 'forged_signature', label: 'Forged signature', desc: 'Wrong HMAC key' },
  { id: 'malformed', label: 'Malformed payload', desc: 'Broken JSON' },
  { id: 'sensor_tamper', label: 'Data tampering', desc: 'Impossible temperature jump' },
]

const CLASS: Record<string, string> = {
  payload_too_large: 'Resource exhaustion', malformed_payload: 'Protocol violation', topic_mismatch: 'Spoofing',
  unknown_device: 'Unauthorized device', auth_failure: 'Authentication failure', replay: 'Replay attack', flood: 'Flooding / DoS',
  implausible_jump: 'Data integrity anomaly', statistical_outlier: 'Behavioural anomaly', out_of_range: 'Data integrity anomaly',
}
const sevTone = (s: string) => (s === 'high' ? 'red' : s === 'medium' ? 'amber' : 'cyan') as 'red' | 'amber' | 'cyan'

export default function SecurityPage() {
  const { security, securityEvents } = useMonitor()
  const [history, setHistory] = useState<SecurityEvent[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [evalRes, setEvalRes] = useState<SecurityEvaluation | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api.securityEvents().then(setHistory).catch(() => {}) }, [])
  const events = [...securityEvents, ...history.filter((h) => !securityEvents.find((e) => e.id === h.id))].sort((a, b) => b.id - a.id).slice(0, 200)
  const real = events.filter((e) => !e.simulated)

  const attack = async (id: string) => {
    setRunning(id); setErr(null)
    try { await api.simulateAttack(id) } catch (e) { setErr((e as Error).message) } finally { setRunning(null) }
  }
  const evaluate = async () => {
    setRunning('eval'); setErr(null)
    try { setEvalRes(await api.evaluateSecurity()) } catch (e) { setErr((e as Error).message) } finally { setRunning(null) }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl bg-gradient-to-r from-violet-500/10 via-tele/5 to-transparent p-5 ring-1 ring-violet-400/20">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-violet-300"><ShieldAlert size={14} />Problem Statement 6</div>
        <h2 className="mt-1 text-lg font-bold text-slate-100">Lightweight Cybersecurity Framework for IoT Devices</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">Every MQTT message is inspected at the edge before it can reach the alert engine. Rule-based checks run in O(1) per message with a few hundred bytes of state, and are compared against lightweight ML models below. Security alerts are kept separate from environmental alerts.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Card className="!p-3"><Stat label="Messages inspected" value={security?.inspected ?? 0} tone="cyan" /></Card>
        <Card className="!p-3"><Stat label="Blocked" value={security?.blocked ?? 0} tone={security?.blocked ? 'red' : 'green'} /></Card>
        <Card className="!p-3"><Stat label="Detection latency" value={security?.latency_us_avg != null ? `${security.latency_us_avg} µs` : '—'} hint={security?.latency_us_p95 != null ? `p95 ${security.latency_us_p95} µs` : 'avg / msg'} /></Card>
        <Card className="!p-3"><Stat label="Detector state" value={`${security?.state_bytes_est ?? 0} B`} hint={`${security?.devices_profiled ?? 0} device profile(s)`} /></Card>
        <Card className="!p-3"><Stat label="Device auth (HMAC)" value={security?.hmac_enabled ? 'Enabled' : 'Off'} tone={security?.hmac_enabled ? 'green' : 'amber'} hint="SHA-256 signature" /></Card>
        <Card className="!p-3"><Stat label="Provisioned devices" value={security?.allowed_nodes.join(', ') || '—'} hint="allow-list" /></Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Security incidents (live)" icon={<ShieldAlert size={14} />} action={<Badge tone={real.length ? 'red' : 'green'}>{real.length} real · {events.length - real.length} simulated</Badge>}>
          <div className="max-h-[420px] overflow-y-auto">
            {events.length === 0 && <div className="flex flex-col items-center gap-2 py-12 text-slate-500"><ShieldCheck className="text-safe" size={30} />No security events detected</div>}
            {events.map((e) => (
              <motion.div key={e.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/[0.04] py-2.5 text-sm">
                <span className="w-20 font-mono text-xs text-slate-500">{fmtTime(e.ts)}</span>
                <Badge tone={sevTone(e.severity)}>{e.severity}</Badge>
                <span className="font-medium text-slate-200">{CLASS[e.kind] ?? e.kind}</span>
                <span className="font-mono text-xs text-slate-500">{e.kind}</span>
                {e.blocked ? <Badge tone="red">blocked</Badge> : <Badge tone="amber">flagged</Badge>}
                {e.simulated && <SimBadge />}
                <span className="basis-full pl-[5.75rem] text-xs text-slate-400">{e.node ?? '?'} · {e.detail}</span>
              </motion.div>
            ))}
          </div>
        </Card>
        <Card title="Controlled attack simulation" icon={<Bug size={14} />}>
          <p className="mb-3 text-xs text-slate-500">Crafted attacks run through an isolated sandbox copy of the detector (same rules/config). Nothing is ingested, so no fake readings or alerts are created. Results are labelled simulated.</p>
          <div className="grid grid-cols-2 gap-2">
            {ATTACKS.map((a) => (
              <button key={a.id} onClick={() => attack(a.id)} disabled={!!running}
                className={cx('rounded-xl bg-white/[0.03] p-3 text-left ring-1 ring-white/10 transition-colors hover:bg-crit/10 hover:ring-crit/40 disabled:opacity-50', running === a.id && 'animate-pulse')}>
                <div className="text-sm font-semibold text-slate-200">{a.label}</div>
                <div className="text-[11px] text-slate-500">{a.desc}</div>
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-1.5 text-xs text-slate-400">
            <div className="flex items-center gap-2"><Lock size={12} className="text-tele" />Broker: anonymous (demo) or password + ACL config</div>
            <div className="flex items-center gap-2"><KeyRound size={12} className="text-tele" />Per-message HMAC-SHA256 device signatures</div>
          </div>
          {err && <div className="mt-2 text-xs text-crit">{err}</div>}
        </Card>
      </div>

      <Card title="Research evaluation — baseline vs rule-based vs lightweight ML" icon={<Microscope size={14} />} action={<Button tone="primary" onClick={evaluate} disabled={!!running}><FlaskConical size={15} />{running === 'eval' ? 'Running…' : 'Run benchmark'}</Button>}>
        {!evalRes && <p className="text-sm text-slate-500">Generates a labelled, controlled synthetic dataset (normal DHT11 telemetry + injected attacks), then measures accuracy, precision, recall, F1, false-positive rate, per-message latency and model size for each configuration.</p>}
        {evalRes && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs text-slate-400">
              <Badge tone="violet">{evalRes.dataset}</Badge>
              <span>{evalRes.messages} messages · {evalRes.attacks} attacks</span>
              {evalRes.ml_available === false && <Badge tone="amber">scikit-learn not installed — ML rows skipped</Badge>}
            </div>
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-slate-500"><tr className="border-b border-white/5">{['Configuration', 'Accuracy', 'Precision', 'Recall', 'F1', 'FPR', 'Latency µs/msg', 'Model size'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {evalRes.configs.map((c) => (
                    <tr key={c.name} className="border-b border-white/[0.03]">
                      <td className="px-3 py-2 text-slate-200">{c.name} <span className="text-[10px] uppercase text-slate-500">{c.kind}</span></td>
                      {[c.accuracy, c.precision, c.recall, c.f1].map((v, i) => <td key={i} className="px-3 py-2 font-mono text-slate-300">{v.toFixed(3)}</td>)}
                      <td className="px-3 py-2 font-mono text-slate-300">{c.false_positive_rate.toFixed(3)}</td>
                      <td className="px-3 py-2 font-mono text-slate-300">{c.latency_us_per_msg.toFixed(1)}</td>
                      <td className="px-3 py-2 font-mono text-slate-300">{c.model_bytes != null ? `${(c.model_bytes / 1024).toFixed(1)} KB` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={evalRes.configs} margin={{ left: -20, right: 8 }}>
                  <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
                  <XAxis dataKey="name" stroke="#475569" fontSize={11} interval={0} />
                  <YAxis domain={[0, 1]} stroke="#475569" fontSize={11} />
                  <Tooltip contentStyle={{ background: 'rgba(8,12,22,.95)', border: '1px solid rgba(34,211,238,.2)', borderRadius: 12, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="precision" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="recall" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="f1" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="false_positive_rate" name="FPR" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-slate-500">Synthetic, controlled data — results characterise the detectors on this dataset, not field performance. Energy: {evalRes.energy_consumption}.</p>
          </div>
        )}
      </Card>
    </div>
  )
}
