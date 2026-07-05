/* Renderer preferences (i18n Lang pattern): localStorage-backed store with a
   useSyncExternalStore hook so every consumer re-renders on change. Holds
   display/behavior prefs that only the renderer reads; engine-level state
   stays in the main process settings.json. */
import { useSyncExternalStore } from 'react'
import { applyTheme } from './theme'

export type AutoSeparate = 'off' | 'vocal' | 'full'

export interface Prefs {
  /* theme preset id (theme.ts THEMES key) */
  theme: string
  /* spectrum display tilt in dB/oct (Pro-Q style analyzer slope) */
  tiltDbPerOct: number
  /* what to run automatically when a reference lands in a project */
  autoSeparate: AutoSeparate
  /* write the loudness-correction gain into exported EQ presets */
  bakeGain: boolean
  /* monitor-only output volume in dB (0 = unity), never affects analysis */
  monitorDb: number
}

const DEFAULTS: Prefs = {
  theme: 'Nightfall',
  tiltDbPerOct: 4.5,
  autoSeparate: 'full',
  bakeGain: true,
  monitorDb: 0
}

const KEY = 'vr.prefs'

function load(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
    // one-time default-theme swap (Blush → Nightfall); explicit picks after
    // this migration stick because the flag is set
    if (saved.theme === 'Blush' && !localStorage.getItem('vr.themeMigrated')) delete saved.theme
    localStorage.setItem('vr.themeMigrated', '1')
    return { ...DEFAULTS, ...saved }
  } catch {
    return { ...DEFAULTS }
  }
}

let current: Prefs = load()
const listeners = new Set<() => void>()

export const PrefsStore = {
  get: (): Prefs => current,
  set(patch: Partial<Prefs>) {
    current = { ...current, ...patch }
    localStorage.setItem(KEY, JSON.stringify(current))
    if (patch.theme !== undefined) applyTheme(current.theme)
    listeners.forEach((fn) => fn())
  }
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current
  )
}

/* boot-time side effect: paint the persisted theme before first render */
applyTheme(current.theme)
