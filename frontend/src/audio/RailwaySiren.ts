/**
 * Railway-crossing-style warning siren, synthesised with the Web Audio API.
 *
 * Sound design: two alternating bell strikes ("ding … dong …") at a crossing-signal cadence
 * (~110 strikes/min), each strike made of a square-wave fundamental plus an inharmonic bell
 * partial with a fast attack and exponential decay, layered over a quiet two-tone horn so
 * it stays recognisable on laptop speakers. A DynamicsCompressor keeps it loud without clipping.
 *
 * Guarantees:
 *  - singleton scheduler: start() is idempotent, so there is never more than one loop
 *  - look-ahead scheduling (setInterval + AudioContext clock) → glitch-free timing
 *  - stop() ramps the master gain to zero (no click) and releases nodes
 *  - respects autoplay policy: unlock() must be called from a user gesture
 */
export class RailwaySiren {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private nextTime = 0
  private strike = 0
  private _volume = 0.8
  private listeners = new Set<() => void>()

  static readonly TONES = [784, 622] // G5 / D#5 — classic alternating crossing bell interval
  static readonly INTERVAL = 0.52 // seconds between strikes

  constructor(private Ctx: typeof AudioContext | undefined = typeof window !== 'undefined'
    ? (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
    : undefined) {}

  get playing() {
    return this.timer !== null
  }
  get unlocked() {
    return this.ctx?.state === 'running'
  }
  get supported() {
    return !!this.Ctx
  }
  get volume() {
    return this._volume
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  private emit() {
    this.listeners.forEach((f) => f())
  }

  /** Must be called from a click/tap handler (browser autoplay policy). */
  async unlock(): Promise<boolean> {
    if (!this.Ctx) return false
    try {
      if (!this.ctx) {
        this.ctx = new this.Ctx()
        this.ctx.onstatechange = () => this.emit()
      }
      if (this.ctx.state !== 'running') await this.ctx.resume()
      // short, quiet confirmation chirp
      const o = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      const t = this.ctx.currentTime
      o.frequency.value = 880
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.08 * this._volume + 0.0001, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
      o.connect(g).connect(this.ctx.destination)
      o.start(t)
      o.stop(t + 0.16)
    } catch {
      /* resume rejected */
    }
    this.emit()
    return this.unlocked
  }

  setVolume(v: number) {
    this._volume = Math.max(0, Math.min(1, v))
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.05)
    this.emit()
  }

  /** Returns true if audio is (now) playing; false if blocked by autoplay policy. */
  start(): boolean {
    if (this.timer) return true // already playing → never overlap
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return false
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -10
    comp.ratio.value = 6
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.0001, ctx.currentTime)
    master.gain.exponentialRampToValueAtTime(Math.max(this._volume, 0.0001), ctx.currentTime + 0.05)
    master.connect(comp).connect(ctx.destination)
    this.master = master
    this.nextTime = ctx.currentTime + 0.06
    this.strike = 0
    this.timer = setInterval(() => this.schedule(), 25)
    this.schedule()
    this.emit()
    return true
  }

  private schedule() {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    while (this.nextTime < ctx.currentTime + 0.25) {
      this.bell(this.nextTime, RailwaySiren.TONES[this.strike % 2])
      this.nextTime += RailwaySiren.INTERVAL
      this.strike++
    }
  }

  private bell(t: number, f: number) {
    const ctx = this.ctx!
    const out = ctx.createGain()
    out.gain.setValueAtTime(0.0001, t)
    out.gain.exponentialRampToValueAtTime(0.55, t + 0.006)
    out.gain.exponentialRampToValueAtTime(0.0001, t + RailwaySiren.INTERVAL * 0.95)
    out.connect(this.master!)

    const fund = ctx.createOscillator()
    fund.type = 'square'
    fund.frequency.setValueAtTime(f, t)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 3200
    fund.connect(lp).connect(out)

    const partial = ctx.createOscillator() // inharmonic bell overtone
    partial.type = 'sine'
    partial.frequency.setValueAtTime(f * 2.76, t)
    const pg = ctx.createGain()
    pg.gain.value = 0.35
    partial.connect(pg).connect(out)

    const horn = ctx.createOscillator() // sustained warning horn layer
    horn.type = 'sawtooth'
    horn.frequency.setValueAtTime(f / 2, t)
    const hg = ctx.createGain()
    hg.gain.setValueAtTime(0.0001, t)
    hg.gain.exponentialRampToValueAtTime(0.12, t + 0.03)
    hg.gain.exponentialRampToValueAtTime(0.0001, t + RailwaySiren.INTERVAL)
    horn.connect(hg).connect(this.master!)

    const end = t + RailwaySiren.INTERVAL
    for (const o of [fund, partial, horn]) {
      o.start(t)
      o.stop(end)
    }
  }

  stop() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    const ctx = this.ctx
    const master = this.master
    this.master = null
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime)
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.02)
      setTimeout(() => master.disconnect(), 200)
    }
    this.emit()
  }

  async dispose() {
    this.stop()
    await this.ctx?.close()
    this.ctx = null
  }
}

export const siren = new RailwaySiren()
