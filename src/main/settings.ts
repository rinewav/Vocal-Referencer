/* Minimal JSON settings store in userData/settings.json.
   Synchronous read at startup, debounced-enough writes (settings are tiny). */
import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'

type Settings = Record<string, unknown>

let cache: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function load(): Settings {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(settingsPath(), 'utf8'))
  } catch {
    cache = {}
  }
  return cache!
}

export function getSetting(key: string): unknown {
  return load()[key]
}

export function setSetting(key: string, value: unknown): void {
  const settings = load()
  settings[key] = value
  mkdirSync(dirname(settingsPath()), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
}

/* wipe all settings (factory reset) — clears firstRunDone/tutorialDone so the
   onboarding flow runs again on the next launch */
export function clearSettings(): void {
  cache = {}
  rmSync(settingsPath(), { force: true })
}
