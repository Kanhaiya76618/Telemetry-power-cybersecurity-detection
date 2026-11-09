import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import type { AlertState } from '../types'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function Card({ children, className, title, icon, action }: {
  children: ReactNode; className?: string; title?: string; icon?: ReactNode; action?: ReactNode
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cx('glass rounded-2xl p-4 sm:p-5 min-w-0', className)}
    >
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            {icon}
            {title}
          </h3>
          {action}
        </header>
      )}
      {children}
    </motion.section>
  )
}

const TONE = {
  cyan: 'bg-tele/10 text-tele ring-tele/30',
  green: 'bg-safe/10 text-safe ring-safe/30',
  amber: 'bg-warn/10 text-warn ring-warn/30',
  red: 'bg-crit/15 text-crit ring-crit/40',
  slate: 'bg-slate-500/10 text-slate-400 ring-slate-500/30',
  violet: 'bg-violet-500/10 text-violet-300 ring-violet-400/30',
}
export type Tone = keyof typeof TONE

export function Badge({ tone = 'slate', children, dot, pulse, className }: {
  tone?: Tone; children: ReactNode; dot?: boolean; pulse?: boolean; className?: string
}) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1', TONE[tone], className)}>
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full bg-current', pulse && 'animate-pulseRed')} />}
      {children}
    </span>
  )
}

export const SimBadge = () => <Badge tone="violet">Simulated</Badge>

export function Button({ children, onClick, tone = 'default', disabled, className, type = 'button', title }: {
  children: ReactNode; onClick?: () => void; tone?: 'default' | 'primary' | 'danger' | 'ghost' | 'warn'
  disabled?: boolean; className?: string; type?: 'button' | 'submit'; title?: string
}) {
  const t = {
    default: 'bg-white/5 hover:bg-white/10 text-slate-200 ring-1 ring-white/10',
    primary: 'bg-tele/15 hover:bg-tele/25 text-tele ring-1 ring-tele/40',
    danger: 'bg-crit hover:bg-red-500 text-white shadow-crit',
    warn: 'bg-warn/15 hover:bg-warn/25 text-warn ring-1 ring-warn/40',
    ghost: 'hover:bg-white/5 text-slate-400 hover:text-slate-200',
  }[tone]
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx('inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-tele', t, className)}
    >
      {children}
    </motion.button>
  )
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  const color = tone ? TONE[tone].split(' ')[1] : 'text-slate-100'
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
      <div className="truncate text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={cx('mt-1 truncate font-mono text-lg font-semibold', color)}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

export const NA = () => <span className="text-slate-500">Not available</span>

export function stateTone(s: AlertState | string | undefined, online = true): Tone {
  if (!online) return 'slate'
  if (s === 'CRITICAL_UNACKNOWLEDGED' || s === 'CRITICAL_ACKNOWLEDGED') return 'red'
  if (s === 'WARNING') return 'amber'
  if (s === 'RECOVERED') return 'cyan'
  return 'green'
}
export function stateLabel(s: AlertState | string | undefined) {
  return ({
    NORMAL: 'System Normal', WARNING: 'Warning', CRITICAL_UNACKNOWLEDGED: 'Critical — Unacknowledged',
    CRITICAL_ACKNOWLEDGED: 'Critical — Acknowledged', RECOVERED: 'Recovered',
  } as Record<string, string>)[s ?? ''] ?? s ?? '—'
}

export const fmtTime = (t?: number | null) => (t ? new Date(t * 1000).toLocaleTimeString() : '—')
export const fmtDateTime = (t?: number | null) => (t ? new Date(t * 1000).toLocaleString() : '—')
export const fmtNum = (v: number | null | undefined, d = 1, unit = '') => (v === null || v === undefined ? '—' : `${v.toFixed(d)}${unit}`)
export function fmtAgo(t?: number | null) {
  if (!t) return 'never'
  const s = Math.max(0, Date.now() / 1000 - t)
  if (s < 2) return 'just now'
  if (s < 60) return `${Math.round(s)}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}
export function fmtDur(s: number | null | undefined) {
  if (s === null || s === undefined) return '—'
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`
}
