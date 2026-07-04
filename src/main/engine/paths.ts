/* Engine directory layout under userData.
   engine/
     runtime/        — python-build-standalone (extracted)
     models/         — separation model files
     engine.json     — install marker { version, installedAt } */
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

export const ENGINE_VERSION = 1

export function engineRoot(): string {
  return join(app.getPath('userData'), 'engine')
}

export function runtimeDir(): string {
  return join(engineRoot(), 'runtime')
}

export function modelsDir(): string {
  return join(engineRoot(), 'models')
}

export function markerPath(): string {
  return join(engineRoot(), 'engine.json')
}

/* python executable inside the extracted python-build-standalone tree */
export function pythonBin(): string {
  if (process.platform === 'win32') return join(runtimeDir(), 'python', 'python.exe')
  return join(runtimeDir(), 'python', 'bin', 'python3')
}

/* audio-separator console script installed by pip into the bundled runtime */
export function audioSeparatorBin(): string {
  if (process.platform === 'win32') return join(runtimeDir(), 'python', 'Scripts', 'audio-separator.exe')
  return join(runtimeDir(), 'python', 'bin', 'audio-separator')
}

export function hasRuntime(): boolean {
  return existsSync(pythonBin())
}
