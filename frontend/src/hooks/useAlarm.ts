import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { siren } from '../audio/RailwaySiren'
import type { Alert } from '../types'

/** Pure decision: the siren sounds while any critical alert is unacknowledged and not muted. */
export function shouldSound(active: Alert[], muted: Set<number>): boolean {
  return active.some((a) => a.severity === 'critical' && !a.resolved_at && !a.acknowledged_at && !muted.has(a.id))
}

export function useSirenState() {
  return useSyncExternalStore(
    (cb) => siren.subscribe(cb),
    () => `${siren.unlocked}|${siren.playing}|${siren.volume}`,
  )
}

/** Drives the singleton siren from alert state. Muting never changes the alert itself. */
export function useAlarm(activeCritical: Alert[]) {
  const [muted, setMuted] = useState<Set<number>>(new Set())
  useSirenState()
  const want = shouldSound(activeCritical, muted)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (want) setBlocked(!siren.start())
    else {
      siren.stop()
      setBlocked(false)
    }
  }, [want, siren.unlocked])

  useEffect(() => () => siren.stop(), [])

  const mute = useCallback(() => {
    setMuted((m) => new Set([...m, ...activeCritical.map((a) => a.id)]))
  }, [activeCritical])
  const unmute = useCallback(() => setMuted(new Set()), [])
  const enableAudio = useCallback(async () => {
    const ok = await siren.unlock()
    if (ok && want) setBlocked(!siren.start())
    return ok
  }, [want])

  const isMuted = activeCritical.length > 0 && activeCritical.every((a) => muted.has(a.id))
  return { playing: siren.playing, unlocked: siren.unlocked, blocked: want && blocked, isMuted, mute, unmute, enableAudio, wantSound: want }
}
